import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { exportLog, skus, zohoItemMap, zohoItems, zohoPushLog, zohoVendorMap, zohoVendors } from "@/db/schema";
import { approvedExportLines } from "@/export/query";
import { log } from "@/lib/log";
import { ZohoError, type ZohoClient } from "./client";

/**
 * Approved lines become DRAFT purchase orders in Zoho, one per vendor. A draft is not an order: someone still reviews
 * and issues it in Zoho. This module never calls Zoho's issue, approve or submit endpoints, so the system cannot place
 * an order. Callers must apply the same gates as the CSV export (live mode, kill switch off, planner or admin role).
 */
export interface PlannedLine {
  skuId: string;
  skuName: string;
  itemId: string;
  qty: number;
  rate: number;
}

export interface PlannedPo {
  vendorId: string;
  vendorName: string;
  reference: string;
  lines: PlannedLine[];
  totalQty: number;
}

export interface BlockedLine {
  skuId: string;
  skuName: string;
  qty: number;
  reason: string;
}

export interface PushPlan {
  runId: string;
  pos: PlannedPo[];
  blocked: BlockedLine[];
}

export const referenceFor = (runId: string, vendorId: string): string => `FR-${runId.slice(0, 8)}-${vendorId.slice(-6)}`;

/** Work out what would be created, and why anything cannot be. A vendor with any blocked line is held back entirely. */
export async function planDraftPos(db: Db, runId: string): Promise<PushPlan> {
  const lines = await approvedExportLines(db, runId);
  const master = new Map((await db.select().from(skus)).map((s) => [s.skuId, s]));
  const vendorOf = new Map((await db.select().from(zohoVendorMap)).map((m) => [m.distributorId, m.vendorId]));
  const vendorName = new Map((await db.select().from(zohoVendors)).map((v) => [v.vendorId, v.name]));
  const items = new Map((await db.select().from(zohoItems)).map((i) => [i.itemId, i]));
  const bySku = new Map((await db.select().from(zohoItems)).filter((i) => i.sku).map((i) => [i.sku as string, i]));
  const override = new Map((await db.select().from(zohoItemMap)).map((m) => [m.skuId, m.itemId]));

  const groups = new Map<string, { ok: PlannedLine[]; blocked: BlockedLine[] }>();
  for (const l of lines) {
    const m = master.get(l.skuId);
    const distributorId = m?.distributorId ?? l.distributorId;
    const vendorId = vendorOf.get(distributorId);
    const group = groups.get(vendorId ?? `unmapped:${distributorId}`) ?? { ok: [], blocked: [] };
    groups.set(vendorId ?? `unmapped:${distributorId}`, group);
    const block = (reason: string) => group.blocked.push({ skuId: l.skuId, skuName: l.skuName, qty: l.quantity, reason });
    if (!vendorId) {
      block(`Distributor ${distributorId} is not mapped to a Zoho vendor.`);
      continue;
    }
    const item = override.has(l.skuId) ? items.get(override.get(l.skuId) as string) : bySku.get(l.skuId);
    if (!item) {
      block("No Zoho item matches this SKU. Map it on the Zoho page.");
      continue;
    }
    if (item.purchaseRate === null || item.purchaseRate <= 0) {
      block(`Zoho item "${item.name}" has no purchase rate.`);
      continue;
    }
    group.ok.push({ skuId: l.skuId, skuName: l.skuName, itemId: item.itemId, qty: l.quantity, rate: item.purchaseRate });
  }

  const pos: PlannedPo[] = [];
  const blocked: BlockedLine[] = [];
  for (const [key, g] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (g.blocked.length > 0) {
      blocked.push(...g.blocked, ...g.ok.map((l) => ({ skuId: l.skuId, skuName: l.skuName, qty: l.qty, reason: "Held back: another line for the same vendor is blocked, and a vendor's lines are never split." })));
      continue;
    }
    pos.push({ vendorId: key, vendorName: vendorName.get(key) ?? key, reference: referenceFor(runId, key), lines: g.ok, totalQty: g.ok.reduce((a, l) => a + l.qty, 0) });
  }
  return { runId, pos, blocked };
}

export type PushStatus = "created" | "already_created" | "failed" | "unconfirmed";

export interface PushResult {
  reference: string;
  vendorName: string;
  status: PushStatus;
  zohoPoNumber: string | null;
  error: string | null;
}

const created = z.object({ purchaseorder: z.object({ purchaseorder_id: z.string().min(1), purchaseorder_number: z.string().default("") }).passthrough() });

/** Look for a PO we may have created before a crash or timeout, by the number we gave it. */
async function findExisting(client: ZohoClient, reference: string): Promise<{ id: string; number: string } | null> {
  const body = await client.request("GET", "/purchaseorders", { query: { page: 1, per_page: 200 } });
  const list = Array.isArray(body.purchaseorders) ? (body.purchaseorders as Record<string, unknown>[]) : [];
  const hit = list.find((p) => p.purchaseorder_number === reference || p.reference_number === reference);
  return hit && typeof hit.purchaseorder_id === "string" ? { id: hit.purchaseorder_id, number: String(hit.purchaseorder_number ?? reference) } : null;
}

export async function pushDraftPos(db: Db, client: ZohoClient, input: { runId: string; userId: string | null; today: string }): Promise<{ results: PushResult[]; plan: PushPlan }> {
  const plan = await planDraftPos(db, input.runId);
  const results: PushResult[] = [];
  const startCalls = client.calls;

  for (const po of plan.pos) {
    const base = { reference: po.reference, vendorName: po.vendorName };
    const lines = po.lines.map((l) => ({ skuId: l.skuId, itemId: l.itemId, qty: l.qty, rate: l.rate }));
    const inserted = await db.insert(zohoPushLog).values({ runId: input.runId, vendorId: po.vendorId, reference: po.reference, status: "pending", lines, userId: input.userId }).onConflictDoNothing().returning({ id: zohoPushLog.id });
    const [row] = await db.select().from(zohoPushLog).where(eq(zohoPushLog.reference, po.reference)).limit(1);
    if (!row) continue;

    if (inserted.length === 0) {
      // We have tried this PO before (or someone is trying it right now).
      if (row.status === "created") {
        results.push({ ...base, status: "already_created", zohoPoNumber: row.zohoPoNumber, error: null });
        continue;
      }
      const recent = row.at.getTime() > Date.now() - 60_000;
      if (row.status === "pending" && recent) {
        results.push({ ...base, status: "unconfirmed", zohoPoNumber: null, error: "Another push for this vendor is in progress. Nothing was created by this request." });
        continue;
      }
      if (row.status === "pending" || row.status === "unconfirmed") {
        // A previous attempt may have reached Zoho. Look before creating anything again.
        try {
          const existing = await findExisting(client, po.reference);
          if (existing) {
            await db.update(zohoPushLog).set({ status: "created", zohoPoId: existing.id, zohoPoNumber: existing.number, error: null }).where(eq(zohoPushLog.id, row.id));
            results.push({ ...base, status: "already_created", zohoPoNumber: existing.number, error: null });
            continue;
          }
        } catch {
          results.push({ ...base, status: "unconfirmed", zohoPoNumber: null, error: "Could not check Zoho for an earlier attempt, so nothing was created. Check Zoho, then retry." });
          continue;
        }
        results.push({ ...base, status: "unconfirmed", zohoPoNumber: null, error: "An earlier attempt may or may not have reached Zoho and it is not in the latest 200 purchase orders. Check Zoho, then confirm a retry." });
        continue;
      }
      // status "failed": a retry is allowed.
    }

    await db.update(zohoPushLog).set({ status: "pending", error: null, at: new Date(), userId: input.userId }).where(eq(zohoPushLog.id, row.id));
    try {
      const body = await client.request("POST", "/purchaseorders", {
        body: {
          purchaseorder_number: po.reference,
          reference_number: po.reference,
          vendor_id: po.vendorId,
          date: input.today,
          notes: `Draft from the Freshroots demand planner, run ${input.runId}. Lines were approved by the planner. Review before issuing.`,
          line_items: po.lines.map((l) => ({ item_id: l.itemId, quantity: l.qty, purchase_rate: l.rate })),
        },
      });
      const parsed = created.parse(body);
      await db.update(zohoPushLog).set({ status: "created", zohoPoId: parsed.purchaseorder.purchaseorder_id, zohoPoNumber: parsed.purchaseorder.purchaseorder_number || po.reference, error: null }).where(eq(zohoPushLog.id, row.id));
      results.push({ ...base, status: "created", zohoPoNumber: parsed.purchaseorder.purchaseorder_number || po.reference, error: null });
    } catch (err) {
      const definite = err instanceof ZohoError && err.status >= 400 && err.status < 500;
      const message = err instanceof Error ? err.message : "unknown error";
      const status: PushStatus = definite ? "failed" : "unconfirmed";
      await db.update(zohoPushLog).set({ status, error: message.slice(0, 500) }).where(eq(zohoPushLog.id, row.id));
      log("error", "zoho draft PO failed", { runId: input.runId, reference: po.reference, status, error: message });
      results.push({ ...base, status, zohoPoNumber: null, error: message });
    }
  }

  const created_ = results.filter((r) => r.status === "created");
  if (created_.length > 0) {
    const qty = plan.pos.filter((p) => created_.some((r) => r.reference === p.reference)).reduce((a, p) => a + p.totalQty, 0);
    await db.insert(exportLog).values({ runId: input.runId, userId: input.userId, lineCount: created_.length, totalQty: qty, kind: "zoho_draft" });
  }
  log("info", "zoho drafts pushed", { runId: input.runId, created: created_.length, calls: client.calls - startCalls });
  return { results, plan };
}

/** A person has checked Zoho and confirmed the PO is not there: allow the push to try again. */
export async function allowRetry(db: Db, reference: string): Promise<boolean> {
  const rows = await db
    .update(zohoPushLog)
    .set({ status: "failed", error: "Confirmed not created in Zoho; retry allowed." })
    .where(and(eq(zohoPushLog.reference, reference), inArray(zohoPushLog.status, ["unconfirmed", "pending"])))
    .returning({ id: zohoPushLog.id });
  return rows.length > 0;
}
