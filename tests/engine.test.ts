import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_CONFIG, diffConfig, ruleConfigSchema } from "@/engine/config";
import { compareResults, evaluateAll } from "@/engine/evaluate";
import { addDays, isoWeekOf, lastCompleteWeek, lastCompleteWeeks, weekStart } from "@/engine/weeks";
import { config, flat, singleSku } from "./helpers";

const one = (opts: Parameters<typeof singleSku>[0], cfg = config()) => {
  const r = evaluateAll(singleSku(opts), cfg);
  return { line: r.lines[0], exception: r.exceptions[0], result: r };
};

describe("weeks", () => {
  it("computes ISO weeks and the last complete week from any weekday", () => {
    expect(isoWeekOf("2026-10-19")).toBe("2026-W43");
    expect(isoWeekOf("2027-01-01")).toBe("2026-W53");
    expect(isoWeekOf("2025-12-29")).toBe("2026-W01");
    expect(weekStart("2026-W43")).toBe("2026-10-19");
    expect(lastCompleteWeek("2026-10-19")).toBe("2026-W42"); // Monday: the new week has not started
    expect(lastCompleteWeek("2026-10-22")).toBe("2026-W42"); // Thursday
    expect(lastCompleteWeek("2026-10-25")).toBe("2026-W42"); // Sunday: W43 not yet over
    expect(lastCompleteWeek("2026-10-26")).toBe("2026-W43");
  });
  it("returns the last N weeks oldest first, across a year boundary", () => {
    expect(lastCompleteWeeks("2026-10-19", 12)[0]).toBe("2026-W31");
    expect(lastCompleteWeeks("2026-10-19", 12)[11]).toBe("2026-W42");
    expect(lastCompleteWeeks("2027-01-11", 3)).toEqual(["2026-W52", "2026-W53", "2027-W01"]);
  });
  it("rejects invalid dates and weeks", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow();
    expect(() => weekStart("2026-W54")).toThrow();
  });
});

describe("rule 1: high demand", () => {
  // older 8 weeks 75, recent 4 weeks 100: avg12 = 83.33, ratio = 1.20 exactly
  const withRecent = (recent: number) => [...flat(75, 8), ...flat(recent, 4)];
  it("does not flag a ratio of exactly 1.20", () => {
    const { line } = one({ units: withRecent(100), stock: 700 });
    expect(line?.metrics.ratio).toBeCloseTo(1.2, 9);
    expect(line?.flags).toEqual([]);
    expect(line?.action).toBe("HOLD");
  });
  it("flags a ratio above 1.20 and orders 1.5x the standard quantity (rounded)", () => {
    const { line } = one({ units: withRecent(101), stock: 700, std: 101 });
    expect(line?.flags).toEqual(["HIGH_DEMAND"]);
    expect(line?.action).toBe("REORDER_1_5X");
    expect(line?.qty).toBe(152);
    expect(line?.ruleFired).toBe("high_demand");
    expect(line?.metrics.urgent).toBe(false);
  });
});

describe("rule 2 and 3: cover windows (general SKUs)", () => {
  it("cover exactly 6 weeks is not a stockout; just below is", () => {
    expect(one({ units: flat(100), stock: 600 }).line?.flags).toEqual([]);
    const low = one({ units: flat(100), stock: 599 }).line;
    expect(low?.flags).toEqual(["STOCKOUT_RISK"]);
    expect(low?.action).toBe("REORDER_NOW");
    expect(low?.qty).toBe(100);
  });
  it("cover exactly 14 weeks is not overstock; just above is", () => {
    expect(one({ units: flat(100), stock: 1400 }).line?.flags).toEqual([]);
    const high = one({ units: flat(100), stock: 1401 }).line;
    expect(high?.flags).toEqual(["OVERSTOCK_RISK"]);
    expect(high?.action).toBe("PAUSE");
    expect(high?.qty).toBeNull();
  });
  it("holds when cover is inside the window", () => {
    const { line } = one({ units: flat(100), stock: 1000 });
    expect(line?.action).toBe("HOLD");
    expect(line?.ruleFired).toBe("hold");
  });
});

describe("rule 5: perishable windows replace rules 2 and 3", () => {
  it("cover exactly 3 and exactly 4 weeks are inside the window", () => {
    expect(one({ units: flat(100), stock: 300, perishable: true }).line?.flags).toEqual([]);
    expect(one({ units: flat(100), stock: 400, perishable: true }).line?.flags).toEqual([]);
  });
  it("flags outside the perishable window with perishable rule names", () => {
    expect(one({ units: flat(100), stock: 299, perishable: true }).line?.ruleFired).toBe("stockout_risk.perishable");
    expect(one({ units: flat(100), stock: 401, perishable: true }).line?.ruleFired).toBe("overstock_risk.perishable");
  });
  it("5 weeks of cover is a stockout for a general SKU but overstock for a perishable SKU", () => {
    expect(one({ units: flat(100), stock: 500 }).line?.flags).toEqual(["STOCKOUT_RISK"]);
    expect(one({ units: flat(100), stock: 500, perishable: true }).line?.flags).toEqual(["OVERSTOCK_RISK"]);
  });
  it("records the thresholds actually used", () => {
    const m = one({ units: flat(100), stock: 350, perishable: true }).line!.metrics;
    expect([m.coverMin, m.coverMax]).toEqual([3, 4]);
  });
});

describe("precedence", () => {
  const spiking = [...flat(100, 8), ...flat(140, 4)]; // avg 113.3, ratio 1.235
  it("HIGH_DEMAND + STOCKOUT_RISK -> REORDER_1_5X, urgent", () => {
    const { line } = one({ units: spiking, stock: 300, std: 200 });
    expect(line?.flags).toEqual(["STOCKOUT_RISK", "HIGH_DEMAND"]);
    expect(line?.action).toBe("REORDER_1_5X");
    expect(line?.qty).toBe(300);
    expect(line?.metrics.urgent).toBe(true);
    expect(line?.ruleFired).toBe("high_demand+stockout_risk.general");
  });
  it("HIGH_DEMAND + OVERSTOCK_RISK is routed as conflicting_signals, never recommended", () => {
    const { line, exception } = one({ units: spiking, stock: 2000 });
    expect(line).toBeUndefined();
    expect(exception?.type).toBe("conflicting_signals");
  });
});

describe("rule 4: festival uplift modes", () => {
  const spiking = [...flat(100, 8), ...flat(140, 4)];
  it("is not applied outside festival months", () => {
    expect(one({ units: flat(100), stock: 700, festival: false }).line?.flags).toEqual([]);
  });
  it("cover_demand scales demand for cover only; the trend ratio uses raw actuals", () => {
    const { line } = one({ units: flat(100), stock: 700, festival: true });
    expect(line?.metrics.demandPerWeek).toBeCloseTo(125, 9);
    expect(line?.metrics.coverWeeks).toBeCloseTo(5.6, 9);
    expect(line?.flags).toEqual(["STOCKOUT_RISK"]);
    expect(one({ units: spiking, stock: 1000, festival: true }).line?.metrics.ratio).toBeCloseTo(140 / 113.3333333, 5);
  });
  it("both_windows keeps the ratio and scales cover", () => {
    const cfg = config({ festival_uplift_mode: "both_windows" });
    const { line } = one({ units: spiking, stock: 1000, festival: true }, cfg);
    expect(line?.metrics.ratio).toBeCloseTo(140 / 113.3333333, 5);
    expect(line?.metrics.coverWeeks).toBeCloseTo(1000 / (113.3333333 * 1.25), 5);
  });
  it("baseline_only lowers the ratio, which can remove HIGH_DEMAND", () => {
    const cfg = config({ festival_uplift_mode: "baseline_only" });
    const { line } = one({ units: spiking, stock: 1000, festival: true }, cfg);
    expect(line?.metrics.ratio).toBeCloseTo(140 / (113.3333333 * 1.25), 5);
    expect(line?.flags).not.toContain("HIGH_DEMAND");
    expect(one({ units: spiking, stock: 1000, festival: true }).line?.flags).toContain("HIGH_DEMAND");
  });
  it("the uplift percentage is configurable", () => {
    const { line } = one({ units: flat(100), stock: 700, festival: true }, config({ festival_uplift: 0 }));
    expect(line?.metrics.coverWeeks).toBeCloseTo(7, 9);
  });
});

describe("open purchase orders", () => {
  it("are shown but not counted by default", () => {
    const { line } = one({ units: flat(100), stock: 500, openPo: 200 });
    expect(line?.metrics.openPoQty).toBe(200);
    expect(line?.metrics.stockUsed).toBe(500);
    expect(line?.flags).toEqual(["STOCKOUT_RISK"]);
  });
  it("are counted when include_open_po_in_stock is true", () => {
    const { line } = one({ units: flat(100), stock: 500, openPo: 200 }, config({ include_open_po_in_stock: true }));
    expect(line?.metrics.stockUsed).toBe(700);
    expect(line?.metrics.openPoQty).toBe(200);
    expect(line?.flags).toEqual([]);
  });
});

describe("exceptions", () => {
  it("new_sku: in the master with no sales history", () => {
    const data = singleSku({ units: flat(100), stock: 600 });
    const empty = { ...data, sales: new Map<string, Map<string, number>>() };
    expect(evaluateAll(empty, config()).exceptions[0]?.type).toBe("new_sku");
  });
  it("short_history: fewer than 12 weeks", () => {
    expect(one({ units: flat(100, 11), stock: 600 }).exception?.type).toBe("short_history");
  });
  it("missing_stock: no inventory snapshot", () => {
    expect(one({ units: flat(100), stock: undefined }).exception?.type).toBe("missing_stock");
  });
  it("zero_demand: 12-week average is 0", () => {
    expect(one({ units: flat(0), stock: 600 }).exception?.type).toBe("zero_demand");
  });
  it("anomalous_jump: up or down by more than the factor, but not at exactly the factor", () => {
    const base = flat(100, 11);
    expect(one({ units: [...base, 250], stock: 700 }).exception?.type).toBe("anomalous_jump");
    expect(one({ units: [...base, 40], stock: 700 }).exception?.type).toBe("anomalous_jump");
    expect(one({ units: [...base, 200], stock: 700 }).exception).toBeUndefined();
    expect(one({ units: [...base, 50], stock: 700 }).exception).toBeUndefined();
  });
  it("anomalous_jump: a sale after four zero weeks is a jump", () => {
    expect(one({ units: [...flat(100, 7), 0, 0, 0, 0, 30], stock: 700 }).exception?.type).toBe("anomalous_jump");
  });
  it("unknown_sku: sales or stock for an SKU outside the master", () => {
    const data = singleSku({ units: flat(100), stock: 600 });
    const withUnknown = {
      ...data,
      sales: new Map([...data.sales, ["GHOST", new Map([["2026-W20", 5]])]]),
      stock: new Map([...data.stock, ["GHOST2", 10]]),
    };
    const types = evaluateAll(withUnknown, config()).exceptions.map((e) => `${e.skuId}:${e.type}`);
    expect(types).toEqual(["GHOST:unknown_sku", "GHOST2:unknown_sku"]);
  });
  it("one failing SKU becomes a processing_error exception and the others still run", () => {
    const good = singleSku({ units: flat(100), stock: 600 });
    const poisoned: Map<string, number> = new Map();
    poisoned.get = () => {
      throw new Error("corrupt row");
    };
    poisoned.set("2026-W20", 1);
    const data = {
      ...good,
      skus: [...good.skus, { ...good.skus[0]!, skuId: "BAD" }],
      sales: new Map([...good.sales, ["BAD", poisoned]]),
    };
    const result = evaluateAll(data, config());
    expect(result.lines).toHaveLength(1);
    expect(result.exceptions[0]).toMatchObject({ skuId: "BAD", type: "processing_error" });
  });
  it("ignores sales dated after the run (no look-ahead)", () => {
    const data = singleSku({ units: flat(100), stock: 600 });
    const withFuture = new Map(data.sales.get("S1")!);
    withFuture.set("2026-W30", 9999);
    const result = evaluateAll({ ...data, sales: new Map([["S1", withFuture]]) }, config());
    expect(result.lines[0]?.metrics.avgBaseline).toBe(100);
  });
});

describe("rule config", () => {
  it("accepts the defaults and rejects inconsistent or unknown settings", () => {
    expect(ruleConfigSchema.safeParse(DEFAULT_RULE_CONFIG).success).toBe(true);
    expect(ruleConfigSchema.safeParse({ ...DEFAULT_RULE_CONFIG, cover_min_weeks: 20 }).success).toBe(false);
    expect(ruleConfigSchema.safeParse({ ...DEFAULT_RULE_CONFIG, recent_weeks: 12 }).success).toBe(false);
    expect(ruleConfigSchema.safeParse({ ...DEFAULT_RULE_CONFIG, perishable_min_weeks: 5 }).success).toBe(false);
    expect(ruleConfigSchema.safeParse({ ...DEFAULT_RULE_CONFIG, surprise: 1 }).success).toBe(false);
    expect(ruleConfigSchema.safeParse({ ...DEFAULT_RULE_CONFIG, festival_uplift_mode: "nope" }).success).toBe(false);
  });
  it("diffs two configs by label", () => {
    const diff = diffConfig(DEFAULT_RULE_CONFIG, config({ cover_min_weeks: 5, festival_uplift_mode: "both_windows" }));
    expect(diff.map((d) => d.key)).toEqual(["cover_min_weeks", "festival_uplift_mode"]);
  });
});

describe("compareResults", () => {
  it("lists lines whose action or quantity changes between configs", () => {
    const data = singleSku({ units: flat(100), stock: 700, festival: true });
    const a = evaluateAll(data, config());
    const b = evaluateAll(data, config({ festival_uplift: 0 }));
    expect(compareResults(a, b)).toEqual([{ skuId: "S1", before: "REORDER_NOW 100", after: "HOLD" }]);
    expect(compareResults(a, a)).toEqual([]);
  });
});
