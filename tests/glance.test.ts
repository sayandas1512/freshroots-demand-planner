import { describe, expect, it } from "vitest";
import { changeWords, niceScale } from "@/components/charts/scale";
import { actionMix, coverColumns, decisionMix, zoneOf } from "@/components/review/glance";
import type { ReviewRow } from "@/run/review-types";

function row(over: Partial<ReviewRow> & { cover?: number; min?: number; max?: number }): ReviewRow {
  const { cover = 8, min = 6, max = 14, ...rest } = over;
  return {
    id: "1", skuId: "SKU", name: "Name", category: "c", unit: "Units", distributorId: "D", action: "HOLD", flags: [], ruleFired: "hold", qty: null, explanation: "", source: "template", status: "pending", finalQty: null, decidedNote: null,
    metrics: { coverWeeks: cover, coverMin: min, coverMax: max } as ReviewRow["metrics"],
    ...rest,
  } as ReviewRow;
}

describe("review glance maths", () => {
  const rows = [
    row({ skuId: "A", name: "A", action: "REORDER_1_5X", cover: 3.4, status: "approved" }),
    row({ skuId: "B", name: "B", action: "REORDER_NOW", cover: 1.8, min: 3, max: 4, status: "rejected" }),
    row({ skuId: "C", name: "C", action: "PAUSE", cover: 22.2 }),
    row({ skuId: "D", name: "D", action: "HOLD", cover: 11.5 }),
    row({ skuId: "E", name: "E", action: "HOLD", cover: 9 }),
  ];

  it("counts lines by action and adds the open exceptions", () => {
    expect(actionMix(rows, 2).map((c) => [c.key, c.value])).toEqual([["REORDER_1_5X", 1], ["REORDER_NOW", 1], ["PAUSE", 1], ["HOLD", 2], ["EXCEPTION", 2]]);
  });

  it("counts decisions in a fixed order", () => {
    expect(decisionMix(rows).map((c) => [c.key, c.value])).toEqual([["pending", 3], ["approved", 1], ["edited", 0], ["rejected", 1]]);
  });

  it("puts each SKU in a cover bucket and judges it against its own limits", () => {
    expect(zoneOf(rows[1] as ReviewRow)).toBe("low"); // 1.8 against a minimum of 3
    expect(zoneOf(rows[3] as ReviewRow)).toBe("ok");
    expect(zoneOf(rows[2] as ReviewRow)).toBe("high");
    const cols = coverColumns(rows);
    expect(cols.map((c) => c.label)).toEqual(["< 2", "2–4", "4–6", "6–10", "10–14", "14+"]);
    expect(cols[0]?.zones.low.names).toEqual(["B"]);
    expect(cols[1]?.zones.low.names).toEqual(["A"]);
    expect(cols[3]?.zones.ok.names).toEqual(["E"]);
    expect(cols[4]?.zones.ok.names).toEqual(["D"]);
    expect(cols[5]?.zones.high.names).toEqual(["C"]);
    expect(cols.reduce((a, c) => a + c.zones.low.count + c.zones.ok.count + c.zones.high.count, 0)).toBe(rows.length); // every SKU lands in exactly one bucket
  });
});

describe("niceScale", () => {
  it("rounds an axis up to a clean step", () => {
    expect(niceScale(16.4)).toMatchObject({ max: 20, step: 5 });
    expect(niceScale(1_420_000, 3).ticks).toEqual([0, 500_000, 1_000_000, 1_500_000]);
    expect(niceScale(0).ticks.length).toBeGreaterThan(1); // nothing to plot still gives an axis
    expect(niceScale(7).ticks).toEqual([0, 2, 4, 6, 8]);
  });
});

describe("changeWords", () => {
  it("says better for a negative change and worse for a positive one", () => {
    expect(changeWords(-9.64)).toEqual({ amount: "9.6%", direction: "better" });
    expect(changeWords(12.04)).toEqual({ amount: "12.0%", direction: "worse" });
  });
  it("calls a change that rounds to zero level", () => {
    expect(changeWords(0.02).direction).toBe("level");
    expect(changeWords(-0.04).direction).toBe("level");
  });
});
