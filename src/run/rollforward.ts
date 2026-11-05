import { desc, eq, max, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { inventorySnapshots, weeklySales, weeklySalesByDistributor } from "@/db/schema";
import { addDays, isoWeekOf, lastCompleteWeek, weekStart } from "@/engine/weeks";

/** A new week copies the one this many weeks earlier, so the seasonal shape of the sample data carries forward. */
const SOURCE_OFFSET_WEEKS = 3;

export interface RollForwardReport {
  stockDate: string | null;
  weeksAdded: string[];
}

/** A small, repeatable wobble of up to ±3% so copied weeks do not look identical. Not random: the same input always gives the same output. */
function wobble(units: number, key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 7919;
  return Math.max(0, Math.round(units * (1 + ((h % 7) - 3) / 100)));
}

/**
 * Keeps the demonstration data current. Copies the latest stock snapshot to today and adds any complete weeks of
 * sales that are missing since the last one, each copied from three weeks earlier with a small wobble. It only adds
 * rows and never changes or removes one. It is for the open-access demonstration, where nothing is real; a real
 * deployment leaves OPEN_ACCESS off so the stale-data checks keep doing their job.
 */
export async function rollForwardDemoData(db: Db, today: string): Promise<RollForwardReport> {
  const report: RollForwardReport = { stockDate: null, weeksAdded: [] };

  const [latestStock] = await db.select({ d: max(inventorySnapshots.asOfDate) }).from(inventorySnapshots);
  if (latestStock?.d && latestStock.d < today) {
    await db.execute(sql`
      insert into inventory_snapshots (sku_id, location, units_on_hand, as_of_date)
      select sku_id, location, units_on_hand, ${today}::date from inventory_snapshots where as_of_date = ${latestStock.d}::date
      on conflict do nothing`);
    report.stockDate = today;
  }

  const [latestSales] = await db.select({ w: weeklySales.week }).from(weeklySales).orderBy(desc(weeklySales.week)).limit(1);
  if (!latestSales) return report;
  const target = lastCompleteWeek(today);
  for (let w = isoWeekOf(addDays(weekStart(latestSales.w), 7)); w <= target; w = isoWeekOf(addDays(weekStart(w), 7))) {
    const source = isoWeekOf(addDays(weekStart(w), -7 * SOURCE_OFFSET_WEEKS));
    const byDistributor = await db.select().from(weeklySalesByDistributor).where(eq(weeklySalesByDistributor.week, source));
    if (byDistributor.length > 0) {
      const rows = byDistributor.map((r) => ({ skuId: r.skuId, distributorId: r.distributorId, week: w, units: wobble(r.units, `${r.skuId}|${r.distributorId}|${w}`) }));
      await db.insert(weeklySalesByDistributor).values(rows).onConflictDoNothing();
      const totals = new Map<string, number>();
      for (const r of rows) totals.set(r.skuId, (totals.get(r.skuId) ?? 0) + r.units);
      await db.insert(weeklySales).values([...totals].map(([skuId, units]) => ({ skuId, week: w, units }))).onConflictDoNothing();
    } else {
      const rows = (await db.select().from(weeklySales).where(eq(weeklySales.week, source))).map((r) => ({ skuId: r.skuId, week: w, units: wobble(r.units, `${r.skuId}|${w}`) }));
      if (rows.length === 0) break;
      await db.insert(weeklySales).values(rows).onConflictDoNothing();
    }
    report.weeksAdded.push(w);
  }
  return report;
}
