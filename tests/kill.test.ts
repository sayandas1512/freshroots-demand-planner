import { describe, expect, it } from "vitest";
import { executeKillCheck, percentWorse, type KillInput, type Level } from "@/kill/check";

const HIGH = 3_400_000;

function input(over: Partial<KillInput> = {}): KillInput {
  return {
    thresholds: { indicatorKillPct: 20, indicatorWarnPct: 10, indicatorConsecutiveChecks: 2, overrideKillRate: 0.5, overrideKillRuns: 4, rubberOverrideRate: 0.02, rubberMedianSeconds: 5, rubberRuns: 4 },
    baselineHighInr: HIGH,
    quarter: null,
    month: null,
    weekly: { baseline: { stockout: 10, overstockValue: 1_000_000 }, recent: [], history: [] },
    liveRuns: [],
    allRuns: [],
    ...over,
  };
}
const weeks = (stockout: number, overstock: number) => ["2027-W10", "2027-W11", "2027-W12", "2027-W13"].map((week) => ({ week, stockout, overstockValue: overstock }));
const byId = (r: ReturnType<typeof executeKillCheck>, id: string) => r.criteria.find((c) => c.id === id)!;
const run = (overrideRate: number | null, medianSeconds: number | null = 30) => ({ overrideRate, medianSeconds });

describe("criterion 1: quarterly and monthly loss", () => {
  it("kills only when a full quarter is above the baseline high; exactly at the high is fine", () => {
    expect(byId(executeKillCheck(input({ quarter: { period: "2027-Q2", outcomeInr: HIGH, lastYearInr: null } })), "quarter_loss").status).toBe("ok");
    const r = executeKillCheck(input({ quarter: { period: "2027-Q2", outcomeInr: HIGH + 1, lastYearInr: 3_000_000 } }));
    expect(byId(r, "quarter_loss")).toMatchObject({ status: "kill" });
    expect(byId(r, "quarter_loss").detail).toContain("Same quarter last year: ₹30.0 lakh");
    expect(r.tripped).toBe(true);
  });
  it("has no data without a full live quarter or a baseline range", () => {
    expect(byId(executeKillCheck(input()), "quarter_loss").status).toBe("no_data");
    expect(byId(executeKillCheck(input({ baselineHighInr: null })), "quarter_loss").status).toBe("no_data");
  });
  it("warns (never kills) when one month is above a third of the high", () => {
    const over = executeKillCheck(input({ month: { period: "2027-04", outcomeInr: Math.floor(HIGH / 3) + 1 } }));
    expect(byId(over, "month_loss").status).toBe("warn");
    expect(over.tripped).toBe(false);
    expect(byId(executeKillCheck(input({ month: { period: "2027-04", outcomeInr: Math.floor(HIGH / 3) } })), "month_loss").status).toBe("ok");
  });
});

describe("criterion 2: weekly indicators", () => {
  it("percentWorse handles a zero baseline", () => {
    expect(percentWorse(12, 10)).toBeCloseTo(20, 9);
    expect(percentWorse(0, 0)).toBe(0);
    expect(percentWorse(3, 0)).toBe(100);
    expect(percentWorse(8, 10)).toBeCloseTo(-20, 9);
  });
  it("is ok at or below the warn threshold, warns above 10%, and a first breach above 20% only warns", () => {
    const at = executeKillCheck(input({ weekly: { baseline: { stockout: 10, overstockValue: 1e6 }, recent: weeks(11, 1e6), history: [] } }));
    expect(byId(at, "indicator_stockout").status).toBe("ok"); // exactly 10% worse
    const warn = executeKillCheck(input({ weekly: { baseline: { stockout: 10, overstockValue: 1e6 }, recent: weeks(11.5, 1e6), history: [] } }));
    expect(byId(warn, "indicator_stockout").status).toBe("warn");
    const first = executeKillCheck(input({ weekly: { baseline: { stockout: 10, overstockValue: 1e6 }, recent: weeks(12.5, 1e6), history: [] } }));
    expect(byId(first, "indicator_stockout").status).toBe("warn");
    expect(first.levels.stockout).toBe("kill");
    expect(first.tripped).toBe(false);
  });
  it("exactly 20% worse is not a kill-level breach", () => {
    const r = executeKillCheck(input({ weekly: { baseline: { stockout: 10, overstockValue: 1e6 }, recent: weeks(12, 1e6), history: [] } }));
    expect(r.levels.stockout).toBe("warn");
  });
  it("kills at the second consecutive check, counted on different weeks", () => {
    const hist = (level: Level) => [{ latestWeek: "2027-W11", stockout: level, overstock: "none" as Level }];
    const w = (history: ReturnType<typeof hist>) => ({ baseline: { stockout: 10, overstockValue: 1e6 }, recent: weeks(13, 1e6), history });
    expect(executeKillCheck(input({ weekly: w(hist("kill")) })).kill.map((c) => c.id)).toEqual(["indicator_stockout"]);
    expect(executeKillCheck(input({ weekly: w(hist("warn")) })).tripped).toBe(false);
    // the previous check was on the same week as this one: it is the same data, not a second check
    expect(executeKillCheck(input({ weekly: w([{ latestWeek: "2027-W13", stockout: "kill", overstock: "none" }]) })).tripped).toBe(false);
  });
  it("overstock value is tested on its own", () => {
    const r = executeKillCheck(input({ weekly: { baseline: { stockout: 10, overstockValue: 1e6 }, recent: weeks(10, 1.3e6), history: [{ latestWeek: "2027-W09", stockout: "none", overstock: "kill" }] } }));
    expect(r.kill.map((c) => c.id)).toEqual(["indicator_overstock"]);
  });
  it("needs a frozen baseline and 4 live weeks", () => {
    expect(byId(executeKillCheck(input({ weekly: { baseline: null, recent: weeks(99, 1), history: [] } })), "indicator_stockout").status).toBe("no_data");
    expect(byId(executeKillCheck(input({ weekly: { baseline: { stockout: 1, overstockValue: 1 }, recent: weeks(99, 1).slice(0, 3), history: [] } })), "indicator_stockout").status).toBe("no_data");
  });
});

describe("criterion 3: overrides", () => {
  it("kills when every one of 4 consecutive runs is above 50%", () => {
    expect(executeKillCheck(input({ liveRuns: [run(0.6), run(0.7), run(0.51), run(0.9)] })).kill.map((c) => c.id)).toEqual(["overrides"]);
  });
  it("does not kill at exactly 50%, with one run below, or with a run where nothing was decided", () => {
    expect(byId(executeKillCheck(input({ liveRuns: [run(0.5), run(0.7), run(0.7), run(0.7)] })), "overrides").status).toBe("ok");
    expect(byId(executeKillCheck(input({ liveRuns: [run(0.7), run(0.7), run(0.4), run(0.7)] })), "overrides").status).toBe("ok");
    expect(byId(executeKillCheck(input({ liveRuns: [run(0.7), run(null), run(0.7), run(0.7)] })), "overrides").status).toBe("ok");
  });
  it("only looks at the newest 4 runs, and needs 4", () => {
    expect(byId(executeKillCheck(input({ liveRuns: [run(0.6), run(0.6), run(0.6), run(0.6), run(0.1)] })), "overrides").status).toBe("kill");
    expect(byId(executeKillCheck(input({ liveRuns: [run(0.9), run(0.9), run(0.9)] })), "overrides").status).toBe("no_data");
  });
});

describe("criterion 4: rubber stamping", () => {
  const fast = run(0.01, 3);
  it("warns when low overrides and fast decisions hold on all 4 runs, and never kills", () => {
    const r = executeKillCheck(input({ allRuns: [fast, fast, fast, fast] }));
    expect(byId(r, "rubber_stamp").status).toBe("warn");
    expect(r.tripped).toBe(false);
  });
  it("either condition alone does not warn", () => {
    expect(byId(executeKillCheck(input({ allRuns: [run(0.01, 30), run(0.01, 30), run(0.01, 30), run(0.01, 30)] })), "rubber_stamp").status).toBe("ok");
    expect(byId(executeKillCheck(input({ allRuns: [run(0.2, 3), run(0.2, 3), run(0.2, 3), run(0.2, 3)] })), "rubber_stamp").status).toBe("ok");
    expect(byId(executeKillCheck(input({ allRuns: [fast, fast, fast, run(0.01, 30)] })), "rubber_stamp").status).toBe("ok");
  });
  it("boundaries are strict: 2% and 5 seconds are not below the thresholds", () => {
    expect(byId(executeKillCheck(input({ allRuns: [run(0.02, 3), fast, fast, fast] })), "rubber_stamp").status).toBe("ok");
    expect(byId(executeKillCheck(input({ allRuns: [run(0.01, 5), fast, fast, fast] })), "rubber_stamp").status).toBe("ok");
  });
  it("needs timing data and 4 runs", () => {
    expect(byId(executeKillCheck(input({ allRuns: [fast, fast, fast, run(0.01, null)] })), "rubber_stamp").status).toBe("no_data");
    expect(byId(executeKillCheck(input({ allRuns: [fast, fast] })), "rubber_stamp").status).toBe("no_data");
  });
});
