import type { Db } from "@/db/client";
import { festivalMonths, inventorySnapshots, skus, weeklySales, weeklySalesByDistributor } from "@/db/schema";
import type { EngineData, SkuMaster } from "@/engine/types";
import { lastCompleteWeek } from "@/engine/weeks";

/**
 * Everything the engine could ever read, loaded once. A backtest over many weeks slices this in memory instead of
 * re-querying three years of sales for every replayed week.
 */
export interface History {
  skus: SkuMaster[];
  sales: { skuId: string; week: string; units: number }[];
  inventory: { skuId: string; location: string; asOfDate: string; units: number }[];
  festival: Set<string>;
  distributorSales: { skuId: string; distributorId: string; week: string; units: number }[] | null;
}

export async function loadHistory(db: Db, opts: { includeDistributors: boolean; upToWeek?: string }): Promise<History> {
  const skuRows = await db.select().from(skus).orderBy(skus.skuId);
  const sales = await db.select().from(weeklySales);
  const inv = await db.select().from(inventorySnapshots);
  const fest = await db.select().from(festivalMonths);
  const dist = opts.includeDistributors ? await db.select().from(weeklySalesByDistributor) : null;
  const keep = (week: string) => opts.upToWeek === undefined || week <= opts.upToWeek;
  return {
    skus: skuRows.map((r) => ({ skuId: r.skuId, name: r.name, category: r.category, perishability: r.perishability, standardReorderQty: r.standardReorderQty, unit: r.unit, distributorId: r.distributorId, leadTimeWeeks: r.leadTimeWeeks, moq: r.moq })),
    sales: sales.filter((r) => keep(r.week)).map((r) => ({ skuId: r.skuId, week: r.week, units: r.units })),
    inventory: inv.map((r) => ({ skuId: r.skuId, location: r.location, asOfDate: r.asOfDate, units: r.unitsOnHand })),
    festival: new Set(fest.filter((f) => f.isFestival).map((f) => f.yearMonth)),
    distributorSales: dist ? dist.filter((r) => keep(r.week)).map((r) => ({ skuId: r.skuId, distributorId: r.distributorId, week: r.week, units: r.units })) : null,
  };
}

/** The engine's view of the world on `asOf`: sales up to the last complete week, the newest snapshots dated on or before asOf. */
export function engineDataAt(history: History, asOf: string): { data: EngineData; latestInventoryDate: string | null } {
  const lastWeek = lastCompleteWeek(asOf);
  const sales = new Map<string, Map<string, number>>();
  for (const r of history.sales) {
    if (r.week > lastWeek) continue;
    const weeks = sales.get(r.skuId) ?? new Map<string, number>();
    weeks.set(r.week, r.units);
    sales.set(r.skuId, weeks);
  }
  const latest = new Map<string, { date: string; units: number }>();
  let newest: string | null = null;
  for (const r of history.inventory) {
    if (r.asOfDate > asOf) continue;
    const key = `${r.skuId}|${r.location}`;
    const prev = latest.get(key);
    if (!prev || r.asOfDate > prev.date) latest.set(key, { date: r.asOfDate, units: r.units });
    if (newest === null || r.asOfDate > newest) newest = r.asOfDate;
  }
  const stock = new Map<string, number>();
  for (const [key, v] of latest) {
    const skuId = key.slice(0, key.indexOf("|"));
    stock.set(skuId, (stock.get(skuId) ?? 0) + v.units);
  }
  let distributorSales: Map<string, Map<string, Map<string, number>>> | undefined;
  if (history.distributorSales) {
    distributorSales = new Map();
    for (const r of history.distributorSales) {
      if (r.week > lastWeek) continue;
      const bySku = distributorSales.get(r.skuId) ?? new Map<string, Map<string, number>>();
      const byWeek = bySku.get(r.distributorId) ?? new Map<string, number>();
      byWeek.set(r.week, r.units);
      bySku.set(r.distributorId, byWeek);
      distributorSales.set(r.skuId, bySku);
    }
  }
  return { data: { asOf, skus: history.skus, sales, stock, openPo: new Map(), festivalMonths: history.festival, distributorSales }, latestInventoryDate: newest };
}
