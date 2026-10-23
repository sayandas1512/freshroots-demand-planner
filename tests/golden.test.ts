import { describe, expect, it } from "vitest";
import { evaluateAll } from "@/engine/evaluate";
import { GOLDEN, GOLDEN_AS_OF, roundHalfEven } from "./golden-table";
import { config, fixtureEngineData } from "./helpers";

describe("golden table (brief section 7), 2026-10-19, cover_demand", () => {
  const data = fixtureEngineData(GOLDEN_AS_OF);
  const result = evaluateAll(data, config());

  it("produces 15 lines and no exceptions", () => {
    expect(result.lines).toHaveLength(15);
    expect(result.exceptions).toEqual([]);
  });

  for (const row of GOLDEN) {
    it(`${row.skuId} matches the table`, () => {
      const line = result.lines.find((l) => l.skuId === row.skuId);
      expect(line).toBeDefined();
      const m = line!.metrics;
      expect(m.perishable).toBe(row.perishable);
      expect(roundHalfEven(m.avgBaseline, 1)).toBe(row.avg12);
      expect(roundHalfEven(m.avgRecent, 1)).toBe(row.recent4);
      expect(roundHalfEven(m.ratio, 2)).toBe(row.ratio);
      expect(m.stockOnHand).toBe(row.stock);
      expect(roundHalfEven(m.coverWeeks, 1)).toBe(row.cover);
      expect([...line!.flags].sort()).toEqual([...row.flags].sort());
    });
  }

  it("no-uplift case: SKU002 becomes OVERSTOCK_RISK at 14.3 weeks", () => {
    const festivalOff = { ...data, festivalMonths: new Set<string>() };
    const line = evaluateAll(festivalOff, config()).lines.find((l) => l.skuId === "SKU002")!;
    expect(roundHalfEven(line.metrics.coverWeeks, 1)).toBe(14.3);
    expect(line.flags).toEqual(["OVERSTOCK_RISK"]);
    expect(line.action).toBe("PAUSE");
  });

  it("SKU001 is urgent: HIGH_DEMAND + STOCKOUT_RISK -> REORDER_1_5X at 1.5x the standard quantity", () => {
    // SKU001's ratio is 1.2145, only just above the 1.20 threshold, so rule 1 depends on the window definition.
    // Here the 4-week window sits inside the 12-week window (W31 to W42). Excluding those 4 weeks from the baseline
    // would push the ratio far higher; widening the baseline would pull it under 1.20 and drop the flag.
    const line = result.lines.find((l) => l.skuId === "SKU001")!;
    expect(line.action).toBe("REORDER_1_5X");
    expect(line.qty).toBe(750);
    expect(line.metrics.urgent).toBe(true);
    expect(line.ruleFired).toBe("high_demand+stockout_risk.general");
  });

  it("assigns the documented action and rule for the other flagged lines", () => {
    const by = (id: string) => result.lines.find((l) => l.skuId === id)!;
    expect(by("SKU003").ruleFired).toBe("stockout_risk.general");
    expect(by("SKU003").action).toBe("REORDER_NOW");
    expect(by("SKU003").qty).toBe(300);
    expect(by("SKU004").ruleFired).toBe("stockout_risk.perishable");
    expect(by("SKU006").ruleFired).toBe("overstock_risk.general");
    expect(by("SKU006").action).toBe("PAUSE");
    expect(by("SKU006").qty).toBeNull();
    expect(by("SKU007").ruleFired).toBe("overstock_risk.perishable");
    expect(by("SKU002").ruleFired).toBe("hold");
  });
});
