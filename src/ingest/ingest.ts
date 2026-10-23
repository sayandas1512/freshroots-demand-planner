import { count, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { distributors, festivalMonths, ingestReports, inventorySnapshots, openPos, skus, weeklySales, weeklySalesByDistributor } from "@/db/schema";
import { log } from "@/lib/log";
import { getActiveConfig } from "@/run/config-store";
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
  warnings?: RowIssue[];
}

type Parsed<K extends IngestKind> = { row: number; value: RowFor<K> }[];

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

async function upsertSkus(tx: Tx, rows: RowFor<"sku_master">[], present: ReadonlySet<string>): Promise<Applied> {
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
            // Optional columns that were not in the file keep their stored values.
            leadTimeWeeks: present.has("leadTimeWeeks") ? sql`excluded.lead_time_weeks` : skus.leadTimeWeeks,
            moq: present.has("moq") ? sql`excluded.moq` : skus.moq,
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

/**
 * Sales rows with a Distributor_ID are distributor-level figures; the SKU aggregate in weekly_sales is derived from them.
 * Rows without one are SKU aggregates. If an aggregate arrives for a SKU and week that already has distributor rows,
 * the distributor rows win and any difference is reported so someone can reconcile it.
 */
async function upsertSales(tx: Tx, rows: Parsed<"sales">): Promise<Applied> {
  const warnings: RowIssue[] = [];
  const out: { inserted: boolean }[] = [];
  const byDistributor = rows.filter((r) => r.value.distributorId !== null);
  const aggregates = rows.filter((r) => r.value.distributorId === null);

  for (const part of chunks(byDistributor)) {
    out.push(
      ...(await tx
        .insert(weeklySalesByDistributor)
        .values(part.map((r) => ({ skuId: r.value.skuId, distributorId: r.value.distributorId as string, week: r.value.week, units: r.value.units })))
        .onConflictDoUpdate({ target: [weeklySalesByDistributor.skuId, weeklySalesByDistributor.distributorId, weeklySalesByDistributor.week], set: { units: sql`excluded.units` } })
        .returning({ inserted: wasInserted })),
    );
  }

  const skuIds = [...new Set(rows.map((r) => r.value.skuId))];
  const sums = new Map<string, number>();
  for (const part of chunks(skuIds)) {
    for (const r of await tx.select().from(weeklySalesByDistributor).where(inArray(weeklySalesByDistributor.skuId, part))) {
      const key = `${r.skuId}|${r.week}`;
      sums.set(key, (sums.get(key) ?? 0) + r.units);
    }
  }

  const derived = new Map<string, { skuId: string; week: string; units: number }>();
  for (const r of byDistributor) {
    const key = `${r.value.skuId}|${r.value.week}`;
    derived.set(key, { skuId: r.value.skuId, week: r.value.week, units: sums.get(key) as number });
  }
  const direct: Parsed<"sales"> = [];
  for (const r of aggregates) {
    const key = `${r.value.skuId}|${r.value.week}`;
    const fromDistributors = sums.get(key);
    if (fromDistributors === undefined) direct.push(r);
    else if (fromDistributors !== r.value.units) {
      warnings.push({ row: r.row, reason: `Aggregate ${r.value.units} for ${r.value.skuId} in ${r.value.week} differs from the sum of its distributor rows (${fromDistributors}). The distributor rows were kept.`, raw: { SKU_ID: r.value.skuId, Week: r.value.week } });
    }
  }

  const aggregateRows = [...derived.values(), ...direct.map((r) => ({ skuId: r.value.skuId, week: r.value.week, units: r.value.units }))];
  for (const part of chunks(aggregateRows)) {
    const done = await tx
      .insert(weeklySales)
      .values(part)
      .onConflictDoUpdate({ target: [weeklySales.skuId, weeklySales.week], set: { units: sql`excluded.units` } })
      .returning({ inserted: wasInserted });
    // Only directly uploaded aggregates count towards the report; derived ones are bookkeeping.
    if (byDistributor.length === 0) out.push(...done);
  }
  return { ...tally(out), warnings };
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
  const [previous] = await tx.select({ n: count() }).from(openPos).where(eq(openPos.source, "csv"));
  await tx.delete(openPos).where(eq(openPos.source, "csv"));
  for (const part of chunks(rows)) await tx.insert(openPos).values(part.map((r) => ({ ...r, source: "csv" })));
  return { inserted: rows.length, replaced: previous?.n ?? 0 };
}

async function apply<K extends IngestKind>(tx: Tx, kind: K, parsed: Parsed<K>, present: ReadonlySet<string>): Promise<Applied> {
  const rows = parsed.map((r) => r.value);
  switch (kind) {
    case "distributors":
      return upsertDistributors(tx, rows as RowFor<"distributors">[]);
    case "sku_master":
      return upsertSkus(tx, rows as RowFor<"sku_master">[], present);
    case "festival_calendar":
      return upsertFestival(tx, rows as RowFor<"festival_calendar">[]);
    case "sales":
      return upsertSales(tx, parsed as unknown as Parsed<"sales">);
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
export async function ingestCsv(db: Db, kind: IngestKind, fileName: string, text: string, userId: string | null = null): Promise<IngestReport> {
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

  if (kind === "distributors") {
    const expected = (await getActiveConfig(db)).config.expected_regions.map((r) => r.toLowerCase());
    for (const { row, value } of parsed.rows as Parsed<"distributors">) {
      const region = value.region.toLowerCase();
      if (expected.length > 0 && !expected.some((e) => region === e || region.includes(e))) {
        warnings.push({ row, reason: `Distributor ${value.distributorId} is in "${value.region}", outside the expected regions (${expected.join(", ")}). Check the extract.`, raw: { Distributor_ID: value.distributorId, Region: value.region } });
      }
    }
  }

  const applied = await db.transaction((tx) => apply(tx, kind, parsed.rows, new Set(parsed.columnsPresent)));

  const report: IngestReport = {
    ...base,
    accepted: parsed.rows.length,
    inserted: applied.inserted,
    replaced: applied.replaced,
    rejected: parsed.rejects.length,
    rejects: parsed.rejects.slice(0, LIMITS.maxRejectsReported),
    rejectsTruncated: parsed.rejects.length > LIMITS.maxRejectsReported,
    warnings: [...warnings, ...(applied.warnings ?? [])].slice(0, LIMITS.maxRejectsReported),
  };

  log("info", "file ingested", { kind, fileName: fileName.slice(0, 120), accepted: report.accepted, rejected: report.rejected, replaced: report.replaced, userId });
  await db.insert(ingestReports).values({
    kind,
    fileName: fileName.slice(0, 200),
    userId,
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

