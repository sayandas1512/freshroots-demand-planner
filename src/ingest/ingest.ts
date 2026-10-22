import { count, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { distributors, festivalMonths, ingestReports, inventorySnapshots, openPos, skus, weeklySales } from "@/db/schema";
import { LIMITS, type IngestKind } from "./mapping";
import { parseCsv, type RowIssue } from "./parse";
import type { RowFor } from "./schemas";

export interface IngestReport {
  kind: IngestKind;
  fileName: string;
  totalRows: number;
  accepted: number;
  inserted: number;
  replaced: number;
  rejected: number;
  rejects: RowIssue[];
  rejectsTruncated: boolean;
  warnings: RowIssue[];
  fileError?: string;
}

const CHUNK = 500;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** `xmax = 0` is true for a freshly inserted row and false when ON CONFLICT updated an existing one. */
const wasInserted = sql<boolean>`(xmax = 0)`;

interface Applied {
  inserted: number;
  replaced: number;
}

function tally(rows: { inserted: boolean }[]): Applied {
  const inserted = rows.filter((r) => r.inserted).length;
  return { inserted, replaced: rows.length - inserted };
}

async function upsertDistributors(tx: Tx, rows: RowFor<"distributors">[]): Promise<Applied> {
  const out: { inserted: boolean }[] = [];
  for (const part of chunks(rows)) {
    out.push(
      ...(await tx
        .insert(distributors)
        .values(part)
        .onConflictDoUpdate({
          target: distributors.distributorId,
          set: { name: sql`excluded.name`, region: sql`excluded.region`, status: sql`excluded.status` },
        })
        .returning({ inserted: wasInserted })),
    );
  }
  return tally(out);
}

async function upsertSkus(tx: Tx, rows: RowFor<"sku_master">[]): Promise<Applied> {
  const out: { inserted: boolean }[] = [];
  for (const part of chunks(rows)) {
    out.push(
      ...(await tx
        .insert(skus)
        .values(part)
        .onConflictDoUpdate({
          target: skus.skuId,
          set: {
            name: sql`excluded.name`,
            category: sql`excluded.category`,
            perishability: sql`excluded.perishability`,
            standardReorderQty: sql`excluded.standard_reorder_qty`,
            unit: sql`excluded.unit`,
            distributorId: sql`excluded.distributor_id`,
          },
        })
        .returning({ inserted: wasInserted })),
    );
  }
  return tally(out);
}

async function upsertFestival(tx: Tx, rows: RowFor<"festival_calendar">[]): Promise<Applied> {
  const out: { inserted: boolean }[] = [];
  for (const part of chunks(rows)) {
    out.push(
      ...(await tx
        .insert(festivalMonths)
        .values(part.map((r) => ({ yearMonth: r.yearMonth, isFestival: r.isFestival })))
        .onConflictDoUpdate({ target: festivalMonths.yearMonth, set: { isFestival: sql`excluded.is_festival` } })
        .returning({ inserted: wasInserted })),
    );
  }
  return tally(out);
}

async function upsertSales(tx: Tx, rows: RowFor<"sales">[]): Promise<Applied> {
  const out: { inserted: boolean }[] = [];
  for (const part of chunks(rows)) {
    out.push(
      ...(await tx
        .insert(weeklySales)
        .values(part)
        .onConflictDoUpdate({ target: [weeklySales.skuId, weeklySales.week], set: { units: sql`excluded.units` } })
        .returning({ inserted: wasInserted })),
    );
  }
  return tally(out);
}

async function upsertInventory(tx: Tx, rows: RowFor<"inventory">[]): Promise<Applied> {
  const out: { inserted: boolean }[] = [];
  for (const part of chunks(rows)) {
    out.push(
      ...(await tx
        .insert(inventorySnapshots)
        .values(part)
        .onConflictDoUpdate({
          target: [inventorySnapshots.skuId, inventorySnapshots.location, inventorySnapshots.asOfDate],
          set: { unitsOnHand: sql`excluded.units_on_hand` },
        })
        .returning({ inserted: wasInserted })),
    );
  }
  return tally(out);
}

/** The Zoho export is a complete list of open POs, so each upload replaces the previous list. */
async function replaceOpenPos(tx: Tx, rows: RowFor<"open_pos">[]): Promise<Applied> {
  const [previous] = await tx.select({ n: count() }).from(openPos);
  await tx.delete(openPos);
  for (const part of chunks(rows)) await tx.insert(openPos).values(part);
  return { inserted: rows.length, replaced: previous?.n ?? 0 };
}

async function apply<K extends IngestKind>(tx: Tx, kind: K, rows: RowFor<K>[]): Promise<Applied> {
  switch (kind) {
    case "distributors":
      return upsertDistributors(tx, rows as RowFor<"distributors">[]);
    case "sku_master":
      return upsertSkus(tx, rows as RowFor<"sku_master">[]);
    case "festival_calendar":
      return upsertFestival(tx, rows as RowFor<"festival_calendar">[]);
    case "sales":
      return upsertSales(tx, rows as RowFor<"sales">[]);
    case "inventory":
      return upsertInventory(tx, rows as RowFor<"inventory">[]);
    case "open_pos":
      return replaceOpenPos(tx, rows as RowFor<"open_pos">[]);
    default:
      throw new Error(`Unsupported kind: ${String(kind)}`);
  }
}

const TRACKS_SKU: ReadonlySet<IngestKind> = new Set(["sales", "inventory", "open_pos"]);

/**
 * Validate, then apply one CSV in a single transaction. Idempotent: loading the same file twice leaves the
 * same data and reports every row as replaced the second time. Bad rows never stop the good ones.
 */
export async function ingestCsv(db: Db, kind: IngestKind, fileName: string, text: string): Promise<IngestReport> {
  const parsed = parseCsv(kind, text);
  const base = { kind, fileName, totalRows: parsed.totalRows };

  if (parsed.fileError) {
    return { ...base, accepted: 0, inserted: 0, replaced: 0, rejected: 0, rejects: [], rejectsTruncated: false, warnings: [], fileError: parsed.fileError };
  }

  const warnings: RowIssue[] = [];
  if (TRACKS_SKU.has(kind)) {
    const known = new Set((await db.select({ id: skus.skuId }).from(skus)).map((r) => r.id));
    for (const { row, value } of parsed.rows) {
      const skuId = (value as { skuId: string }).skuId;
      if (!known.has(skuId)) {
        warnings.push({ row, reason: `SKU ${skuId} is not in the SKU master. It will be routed to Raghav as unknown_sku.`, raw: { SKU_ID: skuId } });
      }
    }
  }

  const applied = await db.transaction((tx) => apply(tx, kind, parsed.rows.map((r) => r.value)));

  const report: IngestReport = {
    ...base,
    accepted: parsed.rows.length,
    inserted: applied.inserted,
    replaced: applied.replaced,
    rejected: parsed.rejects.length,
    rejects: parsed.rejects.slice(0, LIMITS.maxRejectsReported),
    rejectsTruncated: parsed.rejects.length > LIMITS.maxRejectsReported,
    warnings: warnings.slice(0, LIMITS.maxRejectsReported),
  };

  await db.insert(ingestReports).values({
    kind,
    fileName: fileName.slice(0, 200),
    accepted: report.accepted,
    rejected: report.rejected,
    replaced: report.replaced,
    detail: { totalRows: report.totalRows, rejects: report.rejects.slice(0, 200), warnings: report.warnings.slice(0, 50) },
  });
  return report;
}

export async function latestReports(db: Db): Promise<{ kind: string; fileName: string; accepted: number; rejected: number; replaced: number; at: Date }[]> {
  const rows = await db.select().from(ingestReports).orderBy(sql`${ingestReports.at} desc`).limit(100);
  const seen = new Set<string>();
  const out: { kind: string; fileName: string; accepted: number; rejected: number; replaced: number; at: Date }[] = [];
  for (const r of rows) {
    if (seen.has(r.kind)) continue;
    seen.add(r.kind);
    out.push({ kind: r.kind, fileName: r.fileName, accepted: r.accepted, rejected: r.rejected, replaced: r.replaced, at: r.at });
  }
  return out;
}

export async function dataFreshness(db: Db): Promise<{ latestSalesWeek: string | null; salesRows: number; latestInventoryDate: string | null; skuCount: number }> {
  const [sales] = await db.select({ week: sql<string | null>`max(${weeklySales.week})`, n: count() }).from(weeklySales);
  const [inv] = await db.select({ d: sql<string | null>`max(${inventorySnapshots.asOfDate})` }).from(inventorySnapshots);
  const [skuCount] = await db.select({ n: count() }).from(skus);
  return { latestSalesWeek: sales?.week ?? null, salesRows: sales?.n ?? 0, latestInventoryDate: inv?.d ?? null, skuCount: skuCount?.n ?? 0 };
}

