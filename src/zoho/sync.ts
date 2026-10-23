import { and, desc, eq, gt, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { openPos, skus, zohoItemMap, zohoItems, zohoPurchaseOrders, zohoSyncLog, zohoVendors } from "@/db/schema";
import { log } from "@/lib/log";
import type { ZohoClient } from "./client";

const num = z.coerce.number().finite();
const itemRow = z.object({ item_id: z.string().min(1), name: z.string().default(""), sku: z.string().nullish(), purchase_rate: num.nullish().catch(null), vendor_id: z.string().nullish(), status: z.string().optional() }).passthrough();
const vendorRow = z.object({ contact_id: z.string().min(1), contact_name: z.string().default(""), status: z.string().optional() }).passthrough();
const poListRow = z.object({ purchaseorder_id: z.string().min(1), purchaseorder_number: z.string().default(""), status: z.string().default(""), vendor_id: z.string().nullish(), total: num.nullish().catch(null) }).passthrough();
const poDetail = z.object({
  delivery_date: z.string().nullish(),
  line_items: z.array(z.object({ item_id: z.string().min(1), quantity: num.default(0), quantity_received: num.default(0) }).passthrough()).default([]),
});

/** Detail calls (one per PO, because the list has no line items) are repeated at most this often per PO. */
const DETAIL_TTL_MS = 6 * 3_600_000;
/** Items and vendors change rarely, so they are re-read at most this often unless forced. */
const MASTER_TTL_MS = 6 * 3_600_000;
const RESERVE_CALLS = 10;
const CONCURRENCY = 4;

export interface SyncReport {
  ok: boolean;
  trigger: string;
  calls: number;
  items: number;
  vendors: number;
  posListed: number;
  posOpen: number;
  posDetailed: number;
  skippedForBudget: number;
  openPoRows: number;
  unmapped: { itemId: string; name: string }[];
  warnings: string[];
  error?: string;
}

export interface SyncOptions {
  trigger: "cron" | "manual" | "run" | "webhook" | "push";
  /** Re-read everything regardless of the time-to-live caches (webhook and the Sync now button). */
  force?: boolean;
  now?: Date;
}

const dayAgo = (now: Date) => new Date(now.getTime() - 24 * 3_600_000);

export async function callsSpentToday(db: Db, now: Date = new Date()): Promise<number> {
  const [row] = await db.select({ n: sql<number>`coalesce(sum(${zohoSyncLog.calls}), 0)::int` }).from(zohoSyncLog).where(gt(zohoSyncLog.at, dayAgo(now)));
  return Number(row?.n ?? 0);
}

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++] as T);
    }),
  );
}

/**
 * Pull items, vendors and purchase orders from Zoho and rebuild the open-PO rows the engine reads.
 * Incremental on purpose: Zoho allows only 1,000 to 10,000 calls a day, so open POs are re-read in detail only when new,
 * changed, stale or forced, and the daily budget is respected. A failed list call leaves the previous open POs in place.
 */
export async function syncZoho(db: Db, client: ZohoClient, opts: SyncOptions): Promise<SyncReport> {
  const now = opts.now ?? new Date();
  const report: SyncReport = { ok: false, trigger: opts.trigger, calls: 0, items: 0, vendors: 0, posListed: 0, posOpen: 0, posDetailed: 0, skippedForBudget: 0, openPoRows: 0, unmapped: [], warnings: [] };
  const started = Date.now();
  try {
    const spent = await callsSpentToday(db, now);
    let budget = client.cfg.dailyBudget - spent - RESERVE_CALLS;
    if (budget < 3) throw new Error(`Daily Zoho call budget used (${spent} of ${client.cfg.dailyBudget} in 24 hours). Keeping the last synced data.`);
    const startCalls = client.calls;
    const used = () => client.calls - startCalls;

    // 1. items and vendors, at most every few hours
    const [lastItems] = await db.select({ at: max(zohoItems.syncedAt) }).from(zohoItems);
    if (opts.force || !lastItems?.at || now.getTime() - lastItems.at.getTime() > MASTER_TTL_MS) {
      const rawItems = await client.paginate("/items", "items");
      for (const r of rawItems) {
        const p = itemRow.safeParse(r);
        if (!p.success) {
          report.warnings.push("Skipped an item Zoho returned in an unexpected shape.");
          continue;
        }
        const v = p.data;
        await db
          .insert(zohoItems)
          .values({ itemId: v.item_id, sku: v.sku?.trim() || null, name: v.name, purchaseRate: v.purchase_rate ?? null, vendorId: v.vendor_id ?? null, active: v.status !== "inactive", syncedAt: now })
          .onConflictDoUpdate({ target: zohoItems.itemId, set: { sku: v.sku?.trim() || null, name: v.name, purchaseRate: v.purchase_rate ?? null, vendorId: v.vendor_id ?? null, active: v.status !== "inactive", syncedAt: now } });
        report.items += 1;
      }
      const rawVendors = await client.paginate("/contacts", "contacts", { contact_type: "vendor", filter_by: "Status.Active" });
      for (const r of rawVendors) {
        const p = vendorRow.safeParse(r);
        if (!p.success) continue;
        await db
          .insert(zohoVendors)
          .values({ vendorId: p.data.contact_id, name: p.data.contact_name, active: true, syncedAt: now })
          .onConflictDoUpdate({ target: zohoVendors.vendorId, set: { name: p.data.contact_name, active: true, syncedAt: now } });
        report.vendors += 1;
      }
    }

    // 2. the PO list (cheap), then detail for open POs that need it
    const list = await client.paginate("/purchaseorders", "purchaseorders");
    const cached = new Map((await db.select().from(zohoPurchaseOrders)).map((r) => [r.poId, r]));
    const open = new Set(client.cfg.openStatuses);
    const needDetail: string[] = [];
    for (const raw of list) {
      const p = poListRow.safeParse(raw);
      if (!p.success) continue;
      const v = p.data;
      const status = v.status.trim().toLowerCase().replaceAll(" ", "_");
      report.posListed += 1;
      const before = cached.get(v.purchaseorder_id);
      await db
        .insert(zohoPurchaseOrders)
        .values({ poId: v.purchaseorder_id, number: v.purchaseorder_number, vendorId: v.vendor_id ?? null, status, total: v.total ?? null, listSyncedAt: now })
        .onConflictDoUpdate({ target: zohoPurchaseOrders.poId, set: { number: v.purchaseorder_number, vendorId: v.vendor_id ?? null, status, total: v.total ?? null, listSyncedAt: now } });
      if (!open.has(status)) continue;
      report.posOpen += 1;
      const changed = before !== undefined && (before.status !== status || before.total !== (v.total ?? null));
      const stale = !before?.detailSyncedAt || now.getTime() - before.detailSyncedAt.getTime() > DETAIL_TTL_MS;
      if (opts.force || !before?.lines || changed || stale) needDetail.push(v.purchaseorder_id);
    }

    budget -= used();
    const allowed = Math.max(0, budget);
    if (needDetail.length > allowed) {
      report.skippedForBudget = needDetail.length - allowed;
      report.warnings.push(`${report.skippedForBudget} open purchase orders were not re-read to stay inside the daily Zoho call budget; their last known quantities are used.`);
      needDetail.length = allowed;
    }
    await pool(needDetail, CONCURRENCY, async (id) => {
      try {
        const body = await client.request("GET", `/purchaseorders/${id}`);
        const po = poDetail.safeParse(body.purchaseorder ?? body.purchase_order);
        if (!po.success) throw new Error("unexpected purchase order shape");
        await db
          .update(zohoPurchaseOrders)
          .set({ lines: po.data.line_items.map((l) => ({ itemId: l.item_id, quantity: l.quantity, received: l.quantity_received })), deliveryDate: po.data.delivery_date ?? null, detailSyncedAt: now })
          .where(eq(zohoPurchaseOrders.poId, id));
        report.posDetailed += 1;
      } catch (err) {
        report.warnings.push(`Could not read purchase order ${id}: ${err instanceof Error ? err.message : "error"}. Its last known quantities are used.`);
      }
    });

    // 3. rebuild the open-PO rows the engine reads
    const rebuilt = await rebuildOpenPos(db, client.cfg.openStatuses);
    report.openPoRows = rebuilt.rows;
    report.unmapped = rebuilt.unmapped;
    if (rebuilt.unmapped.length > 0) report.warnings.push(`${rebuilt.unmapped.length} Zoho items on open purchase orders are not matched to a SKU. Map them on the Zoho page.`);

    report.calls = used();
    report.ok = true;
  } catch (err) {
    report.error = err instanceof Error ? err.message : "unknown error";
    report.calls = client.calls;
    log("error", "zoho sync failed", { trigger: opts.trigger, error: report.error });
  }

  await db.insert(zohoSyncLog).values({
    trigger: opts.trigger,
    ok: report.ok,
    calls: report.calls,
    error: report.error ?? null,
    detail: { items: report.items, vendors: report.vendors, posListed: report.posListed, posOpen: report.posOpen, posDetailed: report.posDetailed, openPoRows: report.openPoRows, unmapped: report.unmapped.length, skippedForBudget: report.skippedForBudget, warnings: report.warnings.slice(0, 10), ms: Date.now() - started },
  });
  log("info", "zoho sync", { trigger: opts.trigger, ok: report.ok, calls: report.calls, posOpen: report.posOpen, openPoRows: report.openPoRows });
  return report;
}

/** SKU for a Zoho item: the manual mapping first, otherwise the Zoho item whose `sku` equals one of our SKU_IDs. */
export async function skuForItems(db: Db): Promise<Map<string, string>> {
  const known = new Set((await db.select({ id: skus.skuId }).from(skus)).map((s) => s.id));
  const out = new Map<string, string>();
  for (const i of await db.select().from(zohoItems)) if (i.sku && known.has(i.sku)) out.set(i.itemId, i.sku);
  for (const m of await db.select().from(zohoItemMap)) if (known.has(m.skuId)) out.set(m.itemId, m.skuId);
  return out;
}

export async function rebuildOpenPos(db: Db, openStatuses: readonly string[]): Promise<{ rows: number; unmapped: { itemId: string; name: string }[] }> {
  const map = await skuForItems(db);
  const names = new Map((await db.select({ id: zohoItems.itemId, name: zohoItems.name }).from(zohoItems)).map((i) => [i.id, i.name]));
  const pos = (await db.select().from(zohoPurchaseOrders)).filter((p) => openStatuses.includes(p.status) && p.lines);
  const rows: { skuId: string; qty: number; expectedDate: string | null; source: string }[] = [];
  const unmapped = new Map<string, string>();
  for (const po of pos) {
    for (const line of po.lines ?? []) {
      const open = Math.round(line.quantity - line.received);
      if (open <= 0) continue;
      const skuId = map.get(line.itemId);
      if (!skuId) {
        unmapped.set(line.itemId, names.get(line.itemId) ?? "");
        continue;
      }
      rows.push({ skuId, qty: open, expectedDate: po.deliveryDate && /^\d{4}-\d{2}-\d{2}$/.test(po.deliveryDate) ? po.deliveryDate : null, source: "zoho" });
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(openPos).where(eq(openPos.source, "zoho"));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(openPos).values(rows.slice(i, i + 500));
  });
  return { rows: rows.length, unmapped: [...unmapped].map(([itemId, name]) => ({ itemId, name })) };
}

export async function lastSync(db: Db): Promise<{ at: Date; ok: boolean; error: string | null; trigger: string; calls: number } | null> {
  const [row] = await db.select().from(zohoSyncLog).where(and(sql`${zohoSyncLog.trigger} <> 'push'`)).orderBy(desc(zohoSyncLog.at)).limit(1);
  return row ? { at: row.at, ok: row.ok, error: row.error, trigger: row.trigger, calls: row.calls } : null;
}
