import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, matches, visibleRows } from "@/components/review/filters";
import type { ReviewRow } from "@/run/review-types";
import type { Action, Flag, LineMetrics } from "@/engine/types";

function row(skuId: string, action: Action, flags: Flag[], cover: number, over: Partial<ReviewRow> = {}, perishable = false, urgent = false): ReviewRow {
  const metrics = { coverWeeks: cover, perishable, urgent } as LineMetrics;
  return { id: skuId, skuId, name: skuId, category: "", unit: "case", distributorId: "D1", action, flags, ruleFired: "x", qty: 1, metrics, explanation: "", source: "template", status: "pending", finalQty: null, decidedNote: null, ...over };
}

const rows = [
  row("A", "HOLD", [], 9),
  row("B", "PAUSE", ["OVERSTOCK_RISK"], 20),
  row("C", "REORDER_NOW", ["STOCKOUT_RISK"], 3),
  row("D", "REORDER_1_5X", ["STOCKOUT_RISK", "HIGH_DEMAND"], 2, {}, false, true),
  row("E", "REORDER_NOW", ["STOCKOUT_RISK"], 1.8, { status: "approved" }, true),
];

describe("review filters and sort", () => {
  it("sorts by priority: urgent, then action severity, then lowest cover", () => {
    expect(visibleRows(rows, DEFAULT_FILTERS, "priority").map((r) => r.skuId)).toEqual(["D", "E", "C", "B", "A"]);
  });
  it("sorts by cover, sku and status", () => {
    expect(visibleRows(rows, DEFAULT_FILTERS, "cover").map((r) => r.skuId)).toEqual(["E", "D", "C", "A", "B"]);
    expect(visibleRows(rows, DEFAULT_FILTERS, "sku").map((r) => r.skuId)).toEqual(["A", "B", "C", "D", "E"]);
    expect(visibleRows(rows, DEFAULT_FILTERS, "status")[4]?.skuId).toBe("E");
  });
  it("filters by action, flag, perishability and status", () => {
    expect(visibleRows(rows, { ...DEFAULT_FILTERS, action: "REORDER_NOW" }, "sku").map((r) => r.skuId)).toEqual(["C", "E"]);
    expect(visibleRows(rows, { ...DEFAULT_FILTERS, flag: "HIGH_DEMAND" }, "sku").map((r) => r.skuId)).toEqual(["D"]);
    expect(visibleRows(rows, { ...DEFAULT_FILTERS, flag: "HOLD" }, "sku").map((r) => r.skuId)).toEqual(["A"]);
    expect(visibleRows(rows, { ...DEFAULT_FILTERS, perishable: "yes" }, "sku").map((r) => r.skuId)).toEqual(["E"]);
    expect(visibleRows(rows, { ...DEFAULT_FILTERS, perishable: "no" }, "sku")).toHaveLength(4);
    expect(visibleRows(rows, { ...DEFAULT_FILTERS, status: "approved" }, "sku").map((r) => r.skuId)).toEqual(["E"]);
    expect(matches(rows[0]!, DEFAULT_FILTERS)).toBe(true);
  });
});
