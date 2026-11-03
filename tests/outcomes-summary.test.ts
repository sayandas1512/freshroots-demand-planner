import { describe, expect, it } from "vitest";
import { executeKillCheck, type KillInput } from "@/kill/check";
import { indicatorView, lossSplit, weekSeries } from "@/outcomes/summary";

describe("indicatorView agrees with the kill check", () => {
  const base = [11, 12, 10, 11, 12, 11, 10, 13]; // average 11.25
  const baseOverstock = [1_000_000, 1_010_000, 990_000, 1_000_000, 1_020_000, 1_000_000, 980_000, 1_000_000];

  it("is no data until there are four live weeks and a baseline", () => {
    expect(indicatorView(base, [11, 12, 10], 10, 20).level).toBe("no_data");
    expect(indicatorView([], [11, 12, 10, 11], 10, 20).level).toBe("no_data");
    expect(indicatorView(base, [], 10, 20).recentAvg).toBeNull();
  });

  it.each([
    [[11, 11, 11, 11], "none"],
    [[12.6, 12.6, 12.6, 12.6], "warn"], // 12% worse
    [[14, 14, 14, 14], "kill"], // 24% worse
  ])("%j is %s, like the kill check", (live, level) => {
    const v = indicatorView(base, live, 10, 20);
    expect(v.level).toBe(level);
    const input: KillInput = {
      thresholds: { indicatorKillPct: 20, indicatorWarnPct: 10, indicatorConsecutiveChecks: 2, overrideKillRate: 0.5, overrideKillRuns: 4, rubberOverrideRate: 0.02, rubberMedianSeconds: 5, rubberRuns: 4 },
      baselineHighInr: null,
      quarter: null,
      month: null,
      weekly: { baseline: { stockout: v.baselineAvg as number, overstockValue: baseOverstock.reduce((a, b) => a + b, 0) / 8 }, recent: live.map((s, i) => ({ week: `2026-W4${i}`, stockout: s, overstockValue: 1_000_000 })), history: [] },
      liveRuns: [],
      allRuns: [],
    };
    expect(executeKillCheck(input).levels.stockout).toBe(level);
  });

  it("uses only the last four live weeks", () => {
    const v = indicatorView(base, [30, 30, 11, 11, 11, 11], 10, 20);
    expect(v.recentAvg).toBe(11);
    expect(v.changePct).toBeCloseTo(-2.2, 0);
  });
});

describe("weekSeries", () => {
  const frozen = [{ week: "2026-W39", n: 1 }, { week: "2026-W40", n: 2 }, { week: "2026-W41", n: 3 }];
  const weekly = [{ week: "2026-W43", n: 5 }, { week: "2026-W41", n: 3 }, { week: "2026-W42", n: 4 }, { week: "2026-W40", n: 2 }];

  it("puts baseline weeks first and only live weeks from the measurement start after them", () => {
    const s = weekSeries(frozen, weekly, "2026-10-12", (r) => r.n); // 2026-10-12 is in ISO week 42
    expect(s.map((p) => `${p.kind}:${p.week}`)).toEqual(["baseline:2026-W39", "baseline:2026-W40", "baseline:2026-W41", "live:2026-W42", "live:2026-W43"]);
  });
});

describe("lossSplit", () => {
  it("adds up stockout loss and write-offs across months", () => {
    expect(lossSplit([{ stockoutLoss: 100, writeoff: 40 }, { stockoutLoss: 50, writeoff: 10 }])).toEqual({ stockoutLoss: 150, writeoff: 50, total: 200 });
    expect(lossSplit([]).total).toBe(0);
  });
});
