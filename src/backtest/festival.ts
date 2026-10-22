import { addDays, isoWeekOf, weekStart } from "@/engine/weeks";

/**
 * Read-only check of the configured festival uplift against history. For every past festival month and each category:
 * average weekly demand over the festival weeks against the average of the 12 weeks before the month. It never
 * changes configuration.
 */
export interface CategoryWeek {
  category: string;
  week: string;
  units: number;
}

export interface UpliftRow {
  month: string;
  category: string;
  festivalAvg: number;
  baselineAvg: number;
  upliftPct: number;
  festivalWeeks: number;
  /** True when some of the 12 baseline weeks were themselves in a festival month, which understates the uplift. */
  baselineIncludesFestival: boolean;
}

export interface UpliftSkip {
  month: string;
  reason: string;
}

export interface UpliftCheck {
  rows: UpliftRow[];
  skipped: UpliftSkip[];
  configuredPct: number;
}

/** A week belongs to the month its Thursday falls in (the ISO rule), so every week has exactly one month. */
export function monthOfWeek(week: string): string {
  return addDays(weekStart(week), 3).slice(0, 7);
}

export const BASELINE_WEEKS = 12;

export function festivalUpliftCheck(input: { data: readonly CategoryWeek[]; festivalMonths: readonly string[]; asOf: string; configuredUplift: number }): UpliftCheck {
  const totals = new Map<string, Map<string, number>>(); // category -> week -> units
  const weeksPresent = new Set<string>();
  for (const r of input.data) {
    const byWeek = totals.get(r.category) ?? new Map<string, number>();
    byWeek.set(r.week, (byWeek.get(r.week) ?? 0) + r.units);
    totals.set(r.category, byWeek);
    weeksPresent.add(r.week);
  }
  const allWeeks = [...weeksPresent].sort();
  const lastWeek = allWeeks.at(-1);
  const festival = new Set(input.festivalMonths);
  const rows: UpliftRow[] = [];
  const skipped: UpliftSkip[] = [];
  const currentMonth = input.asOf.slice(0, 7);

  for (const month of [...festival].sort()) {
    if (month >= currentMonth) continue; // only months that are over
    const monthWeeks = allWeeks.filter((w) => monthOfWeek(w) === month);
    if (monthWeeks.length < 3) {
      skipped.push({ month, reason: allWeeks.length === 0 || month < monthOfWeek(allWeeks[0] as string) ? "No sales history that far back." : "Fewer than 3 weeks of sales in that month." });
      continue;
    }
    const first = monthWeeks[0] as string;
    const before: string[] = [];
    for (let w = isoWeekOf(addDays(weekStart(first), -7)); before.length < BASELINE_WEEKS; w = isoWeekOf(addDays(weekStart(w), -7))) {
      before.unshift(w);
      if (w < (allWeeks[0] as string)) break;
    }
    const usable = before.filter((w) => weeksPresent.has(w));
    if (usable.length < BASELINE_WEEKS) {
      skipped.push({ month, reason: `Only ${usable.length} of the 12 weeks before the month have sales data.` });
      continue;
    }
    if (lastWeek !== undefined && (monthWeeks.at(-1) as string) > lastWeek) {
      skipped.push({ month, reason: "The month is not fully covered by sales data yet." });
      continue;
    }
    const baselineIncludesFestival = before.some((w) => festival.has(monthOfWeek(w)));
    for (const [category, byWeek] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
      const mean = (weeks: readonly string[]) => weeks.reduce((a, w) => a + (byWeek.get(w) ?? 0), 0) / weeks.length;
      const baselineAvg = mean(before);
      if (baselineAvg === 0) continue;
      const festivalAvg = mean(monthWeeks);
      rows.push({ month, category, festivalAvg, baselineAvg, upliftPct: (festivalAvg / baselineAvg - 1) * 100, festivalWeeks: monthWeeks.length, baselineIncludesFestival });
    }
  }
  return { rows, skipped, configuredPct: input.configuredUplift * 100 };
}
