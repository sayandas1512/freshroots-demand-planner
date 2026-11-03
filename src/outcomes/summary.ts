import { isoWeekOf } from "@/engine/weeks";
import { levelFor, percentWorse, type Level } from "@/kill/check";

/** The kill check judges the average of the last four live weeks against the frozen baseline average. */
export const RECENT_WEEKS = 4;

export interface IndicatorView {
  baselineAvg: number | null;
  recentAvg: number | null;
  /** Percent worse than the baseline (positive is worse; both measures are "lower is better"). Null until it can be judged. */
  changePct: number | null;
  level: Level | "no_data";
  liveWeeks: number;
}

/**
 * The same arithmetic as the kill check (src/kill/check.ts), for the charts: baseline average, average of the last four
 * live weeks, how much worse that is, and whether it is past the warning or stopping line.
 */
export function indicatorView(baseline: readonly number[], live: readonly number[], warnPct: number, killPct: number): IndicatorView {
  const baselineAvg = baseline.length === 0 ? null : baseline.reduce((a, v) => a + v, 0) / baseline.length;
  const last = live.slice(-RECENT_WEEKS);
  if (baselineAvg === null || last.length < RECENT_WEEKS) return { baselineAvg, recentAvg: last.length === 0 ? null : last.reduce((a, v) => a + v, 0) / last.length, changePct: null, level: "no_data", liveWeeks: live.length };
  const recentAvg = last.reduce((a, v) => a + v, 0) / RECENT_WEEKS;
  const changePct = percentWorse(recentAvg, baselineAvg);
  return { baselineAvg, recentAvg, changePct, level: levelFor(changePct, killPct, warnPct), liveWeeks: live.length };
}

export interface WeekPoint {
  week: string;
  value: number;
  kind: "baseline" | "live";
}

/** Baseline weeks, then live weeks (those from the measurement start on), oldest first, each as one measure. */
export function weekSeries<T extends { week: string }>(frozen: readonly T[], weekly: readonly T[], since: string, pick: (row: T) => number): WeekPoint[] {
  const floor = isoWeekOf(since);
  const base = [...frozen].sort((a, b) => a.week.localeCompare(b.week)).map((r) => ({ week: r.week, value: pick(r), kind: "baseline" as const }));
  const live = weekly.filter((r) => r.week >= floor).sort((a, b) => a.week.localeCompare(b.week)).map((r) => ({ week: r.week, value: pick(r), kind: "live" as const }));
  return [...base, ...live];
}

export function lossSplit(monthly: readonly { stockoutLoss: number; writeoff: number }[]): { stockoutLoss: number; writeoff: number; total: number } {
  const stockoutLoss = monthly.reduce((a, m) => a + m.stockoutLoss, 0);
  const writeoff = monthly.reduce((a, m) => a + m.writeoff, 0);
  return { stockoutLoss, writeoff, total: stockoutLoss + writeoff };
}
