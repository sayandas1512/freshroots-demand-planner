import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { backtestResults, runs } from "@/db/schema";
import { evaluateAll } from "@/engine/evaluate";
import { isoWeekOf, weekStart, WEEK_PATTERN, addDays } from "@/engine/weeks";
import { getActiveConfig } from "@/run/config-store";
import { loadEngineData } from "@/run/load";
import { compareLines, summarise, type BacktestRow, type BacktestSummary, type OrdersByWeek, type SystemLine } from "./compare";

export const MAX_BACKTEST_WEEKS = 26;

export interface BacktestOutcome {
  runId: string;
  weeks: string[];
  rows: BacktestRow[];
  summary: BacktestSummary;
  hasOrders: boolean;
  notes: string[];
}

export function weekRange(from: string, to: string): string[] {
  if (!WEEK_PATTERN.test(from) || !WEEK_PATTERN.test(to)) throw new Error("Weeks must look like 2026-W42");
  if (from > to) throw new Error("The first week must not be after the last week");
  const out: string[] = [];
  for (let start = weekStart(from); isoWeekOf(start) <= to; start = addDays(start, 7)) {
    out.push(isoWeekOf(start));
    if (out.length > MAX_BACKTEST_WEEKS) throw new Error(`Replay at most ${MAX_BACKTEST_WEEKS} weeks at a time`);
  }
  return out;
}

/** The planner runs on the Monday after week w, when week w is complete. That is the run date for the replay. */
export function replayAsOf(week: string): string {
  return addDays(weekStart(week), 7);
}

/**
 * Replay week w as the planner would have run it once w was complete: sales up to and including w, the newest stock
 * snapshot dated on or before the Monday after w, and no open POs (their history is not kept).
 * Nothing dated after that point is ever read.
 */
export async function runBacktest(db: Db, input: { from: string; to: string; orders: OrdersByWeek | null }): Promise<BacktestOutcome> {
  const weeks = weekRange(input.from, input.to);
  const { version, config } = await getActiveConfig(db);
  const [run] = await db
    .insert(runs)
    .values({ trigger: "backtest", asOfDate: replayAsOf(input.to), configVersion: version, counts: { from: input.from, to: input.to } })
    .returning({ id: runs.id });
  if (!run) throw new Error("Could not create backtest run");

  const lines: SystemLine[] = [];
  const notes: string[] = [];
  for (const week of weeks) {
    const asOf = replayAsOf(week);
    const { data, latestInventoryDate } = await loadEngineData(db, asOf, { includeOpenPos: false, includeDistributors: config.enable_distributor_exceptions });
    const result = evaluateAll(data, config);
    for (const l of result.lines) lines.push({ week, skuId: l.skuId, systemAction: l.action, systemQty: l.qty });
    for (const e of result.exceptions) lines.push({ week, skuId: e.skuId, systemAction: `exception:${e.type}`, systemQty: null });
    if (latestInventoryDate === null) notes.push(`${week}: no stock snapshot on or before ${asOf}, so every SKU is a missing_stock exception.`);
    else if (result.lines.length === 0 && result.exceptions.length > 0) notes.push(`${week}: no SKU had enough history to judge.`);
  }

  const rows = compareLines(lines, input.orders);
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(backtestResults).values(
      rows.slice(i, i + 500).map((r) => ({ runId: run.id, week: r.week, skuId: r.skuId, systemAction: r.systemAction, systemQty: r.systemQty, raghavAction: r.raghavAction, orderedQty: r.orderedQty, agreed: r.agreed })),
    );
  }
  const summary = summarise(rows);
  await db
    .update(runs)
    .set({ status: "completed", finishedAt: new Date(), counts: { from: input.from, to: input.to, lines: rows.length, notes, agreementRate: summary.overall.rate } })
    .where(eq(runs.id, run.id));
  return { runId: run.id, weeks, rows, summary, hasOrders: input.orders !== null, notes };
}
