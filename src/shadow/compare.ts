import { and, inArray, ne } from "drizzle-orm";
import { compareLines, summarise, type BacktestRow, type BacktestSummary, type OrdersByWeek, type SystemLine } from "@/backtest/compare";
import type { Db } from "@/db/client";
import { exceptions, recommendations, runs, skus } from "@/db/schema";
import { ordersFromShadowRows } from "./orders";

export { ordersFromShadowRows };

export interface ShadowRow extends BacktestRow {
  skuName: string;
  /** The system's reason for the line it chose, or the exception detail. */
  reason: string;
  runId: string | null;
}

export interface ShadowResult {
  periods: string[];
  rows: ShadowRow[];
  summary: BacktestSummary;
  notes: string[];
}

const isReorder = (action: string) => action === "REORDER_NOW" || action === "REORDER_1_5X";

/**
 * Compare the system's shadow runs with Raghav's own monthly forecast or orders. For a month, the system "orders" a SKU
 * if any completed run in that month recommended a reorder (largest quantity wins); otherwise its latest run's line is
 * used. Comparison is order or not, using the same code as the backtest.
 */
export async function shadowComparison(db: Db, orders: OrdersByWeek): Promise<ShadowResult> {
  const periods = [...orders.keys()].sort();
  const notes: string[] = [];
  const names = new Map((await db.select({ id: skus.skuId, name: skus.name }).from(skus)).map((s) => [s.id, s.name]));
  const lines: SystemLine[] = [];
  const meta = new Map<string, { reason: string; runId: string | null }>();

  for (const period of periods) {
    const monthRuns = (await db.select().from(runs).where(and(ne(runs.trigger, "backtest"), inArray(runs.status, ["completed", "completed_degraded"])))).filter((r) => r.asOfDate.slice(0, 7) === period).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    if (monthRuns.length === 0) {
      notes.push(`${period}: no completed runs in that month, so nothing to compare.`);
      continue;
    }
    const ids = monthRuns.map((r) => r.id);
    const recs = await db.select().from(recommendations).where(inArray(recommendations.runId, ids));
    const excs = await db.select().from(exceptions).where(inArray(exceptions.runId, ids));
    const order = new Map(ids.map((id, i) => [id, i]));
    const bySku = new Map<string, { action: string; qty: number | null; reason: string; runId: string | null; rank: number }>();
    for (const r of recs) {
      const rank = order.get(r.runId) as number;
      const cand = { action: r.action as string, qty: r.qty, reason: r.explanation, runId: r.runId, rank };
      const cur = bySku.get(r.skuId);
      const better = !cur || (isReorder(cand.action) && !isReorder(cur.action)) || (isReorder(cand.action) === isReorder(cur.action) && (isReorder(cand.action) ? (cand.qty ?? 0) > (cur.qty ?? 0) : cand.rank > cur.rank));
      if (better) bySku.set(r.skuId, cand);
    }
    for (const e of excs) {
      const rank = order.get(e.runId) as number;
      const cur = bySku.get(e.skuId);
      if (!cur || (!isReorder(cur.action) && rank > cur.rank)) bySku.set(e.skuId, { action: `exception:${e.type}`, qty: null, reason: e.detail, runId: e.runId, rank });
    }
    for (const [skuId, v] of [...bySku].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push({ week: period, skuId, systemAction: v.action, systemQty: v.qty });
      meta.set(`${period}|${skuId}`, { reason: v.reason, runId: v.runId });
    }
  }

  const rows: ShadowRow[] = compareLines(lines, orders).map((r) => ({ ...r, skuName: names.get(r.skuId) ?? r.skuId, reason: meta.get(`${r.week}|${r.skuId}`)?.reason ?? "", runId: meta.get(`${r.week}|${r.skuId}`)?.runId ?? null }));
  return { periods, rows, summary: summarise(rows), notes };
}

