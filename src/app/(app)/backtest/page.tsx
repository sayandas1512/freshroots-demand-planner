import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { inventorySnapshots, weeklySales } from "@/db/schema";
import { BacktestClient } from "./BacktestClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backtest · Freshroots" };

export default async function BacktestPage() {
  const db = await getDb();
  const weeks = (await db.selectDistinct({ week: weeklySales.week }).from(weeklySales).orderBy(weeklySales.week)).map((r) => r.week);
  const [snap] = await db.select({ n: sql<number>`count(distinct ${inventorySnapshots.asOfDate})::int`, first: sql<string | null>`min(${inventorySnapshots.asOfDate})` }).from(inventorySnapshots);
  return <BacktestClient weeks={weeks} snapshotDates={Number(snap?.n ?? 0)} firstSnapshot={snap?.first ?? null} />;
}
