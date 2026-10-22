import { and, eq, lte, max } from "drizzle-orm";
import type { Db } from "@/db/client";
import { festivalMonths, inventorySnapshots, openPos, skus, weeklySales } from "@/db/schema";
import type { EngineData, SkuMaster } from "@/engine/types";
import { lastCompleteWeek } from "@/engine/weeks";

export interface LoadedData {
  data: EngineData;
  /** Newest inventory snapshot date on or before asOf, or null when there is none. */
  latestInventoryDate: string | null;
}

/**
 * Join SKU master, sales, stock, open POs and the festival calendar for a run date.
 * Only data that existed on `asOf` is read, which is what makes backtesting honest.
 */
export async function loadEngineData(db: Db, asOf: string, opts: { includeOpenPos: boolean } = { includeOpenPos: true }): Promise<LoadedData> {
  const skuRows = await db.select().from(skus).orderBy(skus.skuId);
  const masters: SkuMaster[] = skuRows.map((r) => ({
    skuId: r.skuId,
    name: r.name,
    category: r.category,
    perishability: r.perishability,
    standardReorderQty: r.standardReorderQty,
    unit: r.unit,
    distributorId: r.distributorId,
  }));

  const salesRows = await db.select().from(weeklySales).where(lte(weeklySales.week, lastCompleteWeek(asOf)));
  const sales = new Map<string, Map<string, number>>();
  for (const r of salesRows) {
    const weeks = sales.get(r.skuId) ?? new Map<string, number>();
    weeks.set(r.week, r.units);
    sales.set(r.skuId, weeks);
  }

  // Latest snapshot per (sku, location), then summed across locations.
  const invRows = await db.select().from(inventorySnapshots).where(lte(inventorySnapshots.asOfDate, asOf));
  const latest = new Map<string, { date: string; units: number }>();
  for (const r of invRows) {
    const key = `${r.skuId}|${r.location}`;
    const prev = latest.get(key);
    if (!prev || r.asOfDate > prev.date) latest.set(key, { date: r.asOfDate, units: r.unitsOnHand });
  }
  const stock = new Map<string, number>();
  for (const [key, v] of latest) {
    const skuId = key.slice(0, key.indexOf("|"));
    stock.set(skuId, (stock.get(skuId) ?? 0) + v.units);
  }
  const [newest] = await db.select({ d: max(inventorySnapshots.asOfDate) }).from(inventorySnapshots).where(lte(inventorySnapshots.asOfDate, asOf));

  const poMap = new Map<string, number>();
  if (opts.includeOpenPos) {
    for (const r of await db.select().from(openPos)) poMap.set(r.skuId, (poMap.get(r.skuId) ?? 0) + r.qty);
  }

  const festival = await db.select().from(festivalMonths).where(and(eq(festivalMonths.isFestival, true)));

  return {
    data: { asOf, skus: masters, sales, stock, openPo: poMap, festivalMonths: new Set(festival.map((f) => f.yearMonth)) },
    latestInventoryDate: newest?.d ?? null,
  };
}
