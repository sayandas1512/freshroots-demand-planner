import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { appState, baseline, baselineWeekly, killChecks, outcomesMonthly, outcomesWeekly, recommendations, runs } from "@/db/schema";
import { isoWeekOf } from "@/engine/weeks";
import { getActiveConfig } from "@/run/config-store";
import type { KillInput, Level, RunStat } from "./check";

export async function getLiveSince(db: Db): Promise<string | null> {
  const [row] = await db.select().from(appState).where(eq(appState.key, "live_since")).limit(1);
  return typeof row?.value.date === "string" ? row.value.date : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function quarterMonths(start: string): string[] {
  const [y, m] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  return [0, 1, 2].map((i) => `${y + Math.floor((m - 1 + i) / 12)}-${String(((m - 1 + i) % 12) + 1).padStart(2, "0")}`);
}

export function quarterLabel(start: string): string {
  return `${start.slice(0, 4)}-Q${Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1}`;
}

/** Per-run stats for the newest completed runs: override rate and median seconds per decision. */
export async function recentRunStats(db: Db, limit: number): Promise<(RunStat & { runId: string; startedAt: Date })[]> {
  const rows = await db
    .select({ id: runs.id, startedAt: runs.startedAt })
    .from(runs)
    .where(and(ne(runs.trigger, "backtest"), inArray(runs.status, ["completed", "completed_degraded"])))
    .orderBy(desc(runs.startedAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const lines = await db
    .select({ runId: recommendations.runId, status: recommendations.status, viewed: recommendations.firstViewedAt, decided: recommendations.decidedAt })
    .from(recommendations)
    .where(inArray(recommendations.runId, rows.map((r) => r.id)));
  return rows.map((r) => {
    const mine = lines.filter((l) => l.runId === r.id);
    const decided = mine.filter((l) => l.status !== "pending");
    const overridden = decided.filter((l) => l.status === "edited" || l.status === "rejected").length;
    const seconds = decided.filter((l) => l.viewed && l.decided).map((l) => Math.max(0, ((l.decided as Date).getTime() - (l.viewed as Date).getTime()) / 1000));
    return { runId: r.id, startedAt: r.startedAt, overrideRate: decided.length === 0 ? null : overridden / decided.length, medianSeconds: median(seconds) };
  });
}

/** Build the input for `executeKillCheck` from the database. */
export async function gatherKillInput(db: Db): Promise<KillInput> {
  const { config } = await getActiveConfig(db);
  const liveSince = await getLiveSince(db);
  const isLive = config.mode === "live" && liveSince !== null;

  const [range] = await db.select().from(baseline).where(sql`${baseline.stockoutLossInrHigh} is not null`).limit(1);
  const baselineHighInr = range && range.stockoutLossInrHigh !== null && range.writeoffInrHigh !== null ? range.stockoutLossInrHigh + range.writeoffInrHigh : null;

  const monthly = await db.select().from(outcomesMonthly);
  const byPeriod = new Map(monthly.map((m) => [m.period, m.stockoutLossInr + m.writeoffInr]));
  const since = liveSince ?? "9999-12-31";
  const liveMonths = [...byPeriod.keys()].filter((p) => `${p}-01` >= since).sort();
  const month = liveMonths.length > 0 ? { period: liveMonths.at(-1) as string, outcomeInr: byPeriod.get(liveMonths.at(-1) as string) as number } : null;

  let quarter: KillInput["quarter"] = null;
  const starts = [...new Set([...byPeriod.keys()].map((p) => `${p.slice(0, 4)}-${String(Math.floor((Number(p.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`))].sort();
  for (const start of starts.reverse()) {
    if (start < since) continue;
    const months = quarterMonths(start);
    if (!months.every((m) => byPeriod.has(m))) continue;
    const prevStart = `${Number(start.slice(0, 4)) - 1}${start.slice(4)}`;
    const prev = quarterMonths(prevStart);
    quarter = {
      period: quarterLabel(start),
      outcomeInr: months.reduce((a, m) => a + (byPeriod.get(m) as number), 0),
      lastYearInr: prev.every((m) => byPeriod.has(m)) ? prev.reduce((a, m) => a + (byPeriod.get(m) as number), 0) : null,
    };
    break;
  }

  const baseRows = await db.select().from(baselineWeekly);
  const weeklyBaseline = baseRows.length === 0 ? null : { stockout: baseRows.reduce((a, r) => a + r.stockoutIncidents, 0) / baseRows.length, overstockValue: baseRows.reduce((a, r) => a + r.overstockValueInr, 0) / baseRows.length };
  const liveWeekFloor = isLive ? isoWeekOf(liveSince) : "9999-W99";
  const weeklyRows = (await db.select().from(outcomesWeekly)).filter((w) => w.week >= liveWeekFloor).sort((a, b) => a.week.localeCompare(b.week));

  const checks = await db.select().from(killChecks).orderBy(desc(killChecks.at)).limit(60);
  const seen = new Set<string>();
  const history: { latestWeek: string; stockout: Level; overstock: Level }[] = [];
  for (const c of checks) {
    if (!c.latestWeek || seen.has(c.latestWeek)) continue;
    seen.add(c.latestWeek);
    history.push({ latestWeek: c.latestWeek, stockout: (c.levels.stockout ?? "none") as Level, overstock: (c.levels.overstock ?? "none") as Level });
  }

  // A run nobody has decided anything on yet says nothing about overrides, so it is left out of both run-based tests.
  const stats = (await recentRunStats(db, 40)).filter((s) => s.overrideRate !== null);
  const liveRuns = isLive ? stats.filter((s) => s.startedAt >= new Date(`${liveSince}T00:00:00Z`)) : [];

  return {
    mode: isLive ? "live" : "shadow",
    thresholds: {
      indicatorKillPct: config.indicator_kill_pct,
      indicatorWarnPct: config.indicator_warn_pct,
      indicatorConsecutiveChecks: config.indicator_consecutive_checks,
      overrideKillRate: config.override_kill_rate,
      overrideKillRuns: config.override_kill_runs,
      rubberOverrideRate: config.rubber_override_rate,
      rubberMedianSeconds: config.rubber_median_seconds,
      rubberRuns: config.rubber_runs,
    },
    baselineHighInr,
    quarter,
    month,
    weekly: { baseline: weeklyBaseline, recent: weeklyRows.map((w) => ({ week: w.week, stockout: w.stockoutIncidents, overstockValue: w.overstockValueInr })), history },
    liveRuns,
    allRuns: stats,
  };
}
