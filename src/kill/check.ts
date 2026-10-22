import type { OperatingMode } from "@/engine/config";

/**
 * The kill test, as one pure function. Thresholds are starting proposals that the sponsor must confirm
 * (see ASSUMPTIONS.md). Nothing here touches the database: `gatherKillInput` builds the input.
 *
 * 1. Quarterly loss (stockout loss + write-offs) above the baseline's high figure, after a full quarter in live mode.
 *    A month above one third of that figure is a warning only.
 * 2. Weekly indicators (stockout incidents, overstock value): 4-week average more than `killPct` worse than the frozen
 *    8-week baseline at `consecutiveChecks` consecutive checks kills; more than `warnPct` warns.
 * 3. Override rate above `overrideKillRate` across `overrideKillRuns` consecutive completed runs kills.
 * 4. Rubber stamping (very low override rate and very fast decisions across `rubberRuns` runs) warns, never kills.
 * In shadow mode criteria 1 to 3 are not evaluated; criterion 4 still is.
 */

export type CriterionStatus = "ok" | "warn" | "kill" | "no_data" | "not_evaluated";
export type Level = "none" | "warn" | "kill";

export interface Criterion {
  id: "quarter_loss" | "month_loss" | "indicator_stockout" | "indicator_overstock" | "overrides" | "rubber_stamp";
  label: string;
  status: CriterionStatus;
  value: string | null;
  threshold: string;
  detail: string;
}

export interface RunStat {
  /** (edited + rejected) / decided lines. Null when nothing was decided. */
  overrideRate: number | null;
  /** Median seconds from first view to decision. Null when no timing was captured. */
  medianSeconds: number | null;
}

export interface KillInput {
  mode: OperatingMode;
  thresholds: {
    indicatorKillPct: number;
    indicatorWarnPct: number;
    indicatorConsecutiveChecks: number;
    overrideKillRate: number;
    overrideKillRuns: number;
    rubberOverrideRate: number;
    rubberMedianSeconds: number;
    rubberRuns: number;
  };
  /** Upper end of the quarterly baseline range, in INR. */
  baselineHighInr: number | null;
  /** Latest full quarter that began in live mode, with all three months entered. */
  quarter: { period: string; outcomeInr: number; lastYearInr: number | null } | null;
  /** Latest month entered since go-live. */
  month: { period: string; outcomeInr: number } | null;
  weekly: {
    baseline: { stockout: number; overstockValue: number } | null;
    /** Live weeks, oldest first. */
    recent: { week: string; stockout: number; overstockValue: number }[];
    /** Earlier checks on different weeks, newest first. */
    history: { latestWeek: string; stockout: Level; overstock: Level }[];
  };
  /** Completed runs in live mode, newest first. */
  liveRuns: RunStat[];
  /** Completed runs, any mode, newest first. */
  allRuns: RunStat[];
}

export interface KillResult {
  criteria: Criterion[];
  kill: Criterion[];
  warnings: Criterion[];
  tripped: boolean;
  latestWeek: string | null;
  levels: { stockout: Level; overstock: Level };
}

const lakh = (inr: number) => `₹${(inr / 100_000).toFixed(1)} lakh`;
const pct = (v: number) => `${v.toFixed(1)}%`;

function skip(id: Criterion["id"], label: string, threshold: string, status: Criterion["status"], detail: string): Criterion {
  return { id, label, status, value: null, threshold, detail };
}

/** How much worse (higher) the average is than the baseline, in percent. A zero baseline with any incidents counts as 100%. */
export function percentWorse(average: number, baseline: number): number {
  if (baseline === 0) return average > 0 ? 100 : 0;
  return ((average - baseline) / baseline) * 100;
}

function levelFor(worse: number, killPct: number, warnPct: number): Level {
  return worse > killPct ? "kill" : worse > warnPct ? "warn" : "none";
}

export function executeKillCheck(input: KillInput): KillResult {
  const t = input.thresholds;
  const shadow = input.mode === "shadow";
  const criteria: Criterion[] = [];
  const high = input.baselineHighInr;
  const SHADOW_NOTE = "Not evaluated in shadow mode.";

  // 1a. quarterly loss
  const qThreshold = high === null ? "no baseline range" : `above ${lakh(high)}`;
  if (shadow) criteria.push(skip("quarter_loss", "Quarterly loss", qThreshold, "not_evaluated", SHADOW_NOTE));
  else if (high === null) criteria.push(skip("quarter_loss", "Quarterly loss", qThreshold, "no_data", "No baseline range is set."));
  else if (!input.quarter) criteria.push(skip("quarter_loss", "Quarterly loss", qThreshold, "no_data", "No full quarter in live mode with all three months entered yet."));
  else {
    const over = input.quarter.outcomeInr > high;
    const lastYear = input.quarter.lastYearInr === null ? "No figure for the same quarter last year." : `Same quarter last year: ${lakh(input.quarter.lastYearInr)} (festival quarters and supplier problems can move losses on their own).`;
    criteria.push({ id: "quarter_loss", label: "Quarterly loss", status: over ? "kill" : "ok", value: `${lakh(input.quarter.outcomeInr)} in ${input.quarter.period}`, threshold: qThreshold, detail: lastYear });
  }

  // 1b. monthly loss, warning only
  const mThreshold = high === null ? "no baseline range" : `above ${lakh(high / 3)}`;
  if (shadow) criteria.push(skip("month_loss", "Monthly loss", mThreshold, "not_evaluated", SHADOW_NOTE));
  else if (high === null || !input.month) criteria.push(skip("month_loss", "Monthly loss", mThreshold, "no_data", "No month entered since go-live."));
  else {
    criteria.push({ id: "month_loss", label: "Monthly loss", status: input.month.outcomeInr > high / 3 ? "warn" : "ok", value: `${lakh(input.month.outcomeInr)} in ${input.month.period}`, threshold: mThreshold, detail: "A warning only: one month does not trip the switch." });
  }

  // 2. weekly indicators
  const w = input.weekly;
  const last4 = w.recent.slice(-4);
  const latestWeek = last4.at(-1)?.week ?? null;
  const levels: KillResult["levels"] = { stockout: "none", overstock: "none" };
  const indicator = (id: "indicator_stockout" | "indicator_overstock", label: string, pick: (r: (typeof w.recent)[number]) => number, base: number | undefined, key: "stockout" | "overstock") => {
    const threshold = `more than ${t.indicatorKillPct}% worse at ${t.indicatorConsecutiveChecks} consecutive checks (warn at ${t.indicatorWarnPct}%)`;
    if (shadow) return skip(id, label, threshold, "not_evaluated", SHADOW_NOTE);
    if (base === undefined) return skip(id, label, threshold, "no_data", "The weekly baseline has not been frozen yet.");
    if (last4.length < 4) return skip(id, label, threshold, "no_data", `Needs 4 live weeks of outcomes; ${last4.length} entered.`);
    const avg = last4.reduce((a, r) => a + pick(r), 0) / 4;
    const worse = percentWorse(avg, base);
    const level = levelFor(worse, t.indicatorKillPct, t.indicatorWarnPct);
    levels[key] = level;
    const prior = w.history.filter((h) => h.latestWeek !== latestWeek);
    let streak = 0;
    for (const h of prior) {
      if (h[key] === "kill") streak += 1;
      else break;
    }
    const needed = t.indicatorConsecutiveChecks - 1;
    const status: CriterionStatus = level === "kill" ? (streak >= needed ? "kill" : "warn") : level === "warn" ? "warn" : "ok";
    const detail = level === "kill" ? `Breach at this check; ${streak + 1} of ${t.indicatorConsecutiveChecks} consecutive checks.` : `4-week average ${avg.toFixed(1)} against a baseline of ${base.toFixed(1)}.`;
    return { id, label, status, value: `${pct(worse)} worse (${avg.toFixed(1)} vs ${base.toFixed(1)})`, threshold, detail };
  };
  criteria.push(indicator("indicator_stockout", "Weekly stockout incidents", (r) => r.stockout, w.baseline?.stockout, "stockout"));
  criteria.push(indicator("indicator_overstock", "Weekly overstock value", (r) => r.overstockValue, w.baseline?.overstockValue, "overstock"));

  // 3. overrides
  const oThreshold = `above ${(t.overrideKillRate * 100).toFixed(0)}% across ${t.overrideKillRuns} consecutive runs`;
  if (shadow) criteria.push(skip("overrides", "Override rate", oThreshold, "not_evaluated", SHADOW_NOTE));
  else if (input.liveRuns.length < t.overrideKillRuns) criteria.push(skip("overrides", "Override rate", oThreshold, "no_data", `Needs ${t.overrideKillRuns} completed live runs; ${input.liveRuns.length} so far.`));
  else {
    const window = input.liveRuns.slice(0, t.overrideKillRuns);
    const allOver = window.every((r) => r.overrideRate !== null && r.overrideRate > t.overrideKillRate);
    const latest = window[0]?.overrideRate ?? null;
    criteria.push({ id: "overrides", label: "Override rate", status: allOver ? "kill" : "ok", value: latest === null ? "nothing decided in the latest run" : `${pct(latest * 100)} in the latest run`, threshold: oThreshold, detail: "Exceptions are not counted. Override rate is (edited + rejected) over decided lines." });
  }

  // 4. rubber stamping (warning only, also checked in shadow)
  const rThreshold = `override rate below ${(t.rubberOverrideRate * 100).toFixed(0)}% and median under ${t.rubberMedianSeconds}s across ${t.rubberRuns} runs`;
  if (input.allRuns.length < t.rubberRuns) criteria.push(skip("rubber_stamp", "Rubber-stamp warning", rThreshold, "no_data", `Needs ${t.rubberRuns} completed runs; ${input.allRuns.length} so far.`));
  else {
    const window = input.allRuns.slice(0, t.rubberRuns);
    const measured = window.every((r) => r.overrideRate !== null && r.medianSeconds !== null);
    const hit = measured && window.every((r) => (r.overrideRate as number) < t.rubberOverrideRate && (r.medianSeconds as number) < t.rubberMedianSeconds);
    const median = window[0]?.medianSeconds;
    criteria.push({ id: "rubber_stamp", label: "Rubber-stamp warning", status: !measured ? "no_data" : hit ? "warn" : "ok", value: median === null || median === undefined ? "no timing yet" : `${median.toFixed(1)}s median in the latest run`, threshold: rThreshold, detail: "Both conditions must hold on every run in the window. This never trips the kill switch." });
  }

  const kill = criteria.filter((c) => c.status === "kill");
  const warnings = criteria.filter((c) => c.status === "warn");
  return { criteria, kill, warnings, tripped: kill.length > 0, latestWeek, levels };
}
