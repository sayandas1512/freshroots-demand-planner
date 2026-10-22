import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { festivalMonths, inventorySnapshots, skus, weeklySales } from "@/db/schema";
import { festivalUpliftCheck } from "@/backtest/festival";
import { getActiveConfig } from "@/run/config-store";
import { todayIst } from "@/lib/dates";
import { BacktestClient } from "./BacktestClient";
import { FestivalCheck } from "./FestivalCheck";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backtest · Freshroots" };

export default async function BacktestPage() {
  const db = await getDb();
  const weeks = (await db.selectDistinct({ week: weeklySales.week }).from(weeklySales).orderBy(weeklySales.week)).map((r) => r.week);
  const [snap] = await db.select({ n: sql<number>`count(distinct ${inventorySnapshots.asOfDate})::int`, first: sql<string | null>`min(${inventorySnapshots.asOfDate})` }).from(inventorySnapshots);
  const byCategory = await db
    .select({ category: skus.category, week: weeklySales.week, units: sql<number>`sum(${weeklySales.units})::int` })
    .from(weeklySales)
    .innerJoin(skus, sql`${skus.skuId} = ${weeklySales.skuId}`)
    .groupBy(skus.category, weeklySales.week);
  const festival = (await db.select().from(festivalMonths)).filter((f) => f.isFestival).map((f) => f.yearMonth);
  const { config } = await getActiveConfig(db);
  const check = festivalUpliftCheck({ data: byCategory.map((r) => ({ category: r.category, week: r.week, units: Number(r.units) })), festivalMonths: festival, asOf: todayIst(), configuredUplift: config.festival_uplift });
  return (
    <>
      <BacktestClient weeks={weeks} snapshotDates={Number(snap?.n ?? 0)} firstSnapshot={snap?.first ?? null} />
      <FestivalCheck check={check} weeksOfHistory={weeks.length} />
    </>
  );
}
