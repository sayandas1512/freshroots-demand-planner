import { describe, expect, it } from "vitest";
import { BASELINE_WEEKS, festivalUpliftCheck, monthOfWeek, type CategoryWeek } from "@/backtest/festival";
import { addDays, isoWeekOf, weekStart } from "@/engine/weeks";

/** Weekly totals for one category from `from` for `n` weeks, with a festival lift in the given months. */
function series(category: string, from: string, n: number, base: number, lifted: Record<string, number> = {}): CategoryWeek[] {
  return Array.from({ length: n }, (_, i) => {
    const week = isoWeekOf(addDays(weekStart(from), 7 * i));
    return { category, week, units: Math.round(base * (lifted[monthOfWeek(week)] ?? 1)) };
  });
}

describe("monthOfWeek", () => {
  it("uses the Thursday of the ISO week", () => {
    expect(monthOfWeek("2026-W40")).toBe("2026-10"); // Mon 28 Sep, Thu 1 Oct
    expect(monthOfWeek("2026-W44")).toBe("2026-10"); // Mon 26 Oct, Thu 29 Oct
    expect(monthOfWeek("2026-W45")).toBe("2026-11"); // Mon 2 Nov
  });
});

describe("festivalUpliftCheck", () => {
  it("measures the uplift against the 12 weeks before the month, per category", () => {
    const data = [...series("Snacks", "2024-W40", 80, 100, { "2025-03": 1.4 }), ...series("Staples", "2024-W40", 80, 200, { "2025-03": 1.1 })];
    const r = festivalUpliftCheck({ data, festivalMonths: ["2025-03"], asOf: "2026-10-19", configuredUplift: 0.25 });
    expect(r.configuredPct).toBe(25);
    expect(r.skipped).toEqual([]);
    const snacks = r.rows.find((x) => x.category === "Snacks")!;
    const staples = r.rows.find((x) => x.category === "Staples")!;
    expect(snacks.upliftPct).toBeCloseTo(40, 0);
    expect(staples.upliftPct).toBeCloseTo(10, 0);
    expect(snacks.festivalWeeks).toBeGreaterThanOrEqual(4);
    expect(snacks.baselineIncludesFestival).toBe(false);
  });

  it("says so when there is not enough history, instead of guessing", () => {
    const data = series("Snacks", "2025-W08", 20, 100);
    const r = festivalUpliftCheck({ data, festivalMonths: ["2025-03", "2024-10"], asOf: "2026-10-19", configuredUplift: 0.25 });
    expect(r.rows).toEqual([]);
    expect(r.skipped.map((s) => s.month)).toEqual(["2024-10", "2025-03"]);
    expect(r.skipped[0]?.reason).toMatch(/No sales history that far back/);
    expect(r.skipped[1]?.reason).toMatch(new RegExp(`of the ${BASELINE_WEEKS} weeks before the month`));
  });

  it("skips months that are not over, and warns when the baseline includes an earlier festival month", () => {
    const data = series("Snacks", "2025-W20", 70, 100, { "2025-10": 1.3, "2025-11": 1.3 });
    const r = festivalUpliftCheck({ data, festivalMonths: ["2025-10", "2025-11", "2026-10"], asOf: "2026-10-19", configuredUplift: 0.25 });
    expect(r.rows.map((x) => x.month)).toEqual(["2025-10", "2025-11"]);
    expect(r.rows.find((x) => x.month === "2025-11")?.baselineIncludesFestival).toBe(true);
    expect(r.rows.find((x) => x.month === "2025-11")!.upliftPct).toBeLessThan(r.rows.find((x) => x.month === "2025-10")!.upliftPct);
    expect(r.skipped.some((s) => s.month === "2026-10")).toBe(false);
  });

  it("returns nothing for empty data", () => {
    expect(festivalUpliftCheck({ data: [], festivalMonths: ["2025-03"], asOf: "2026-10-19", configuredUplift: 0.25 })).toMatchObject({ rows: [], skipped: [{ month: "2025-03" }] });
  });
});
