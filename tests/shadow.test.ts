import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { evaluateAll } from "@/engine/evaluate";
import { parseCsv } from "@/ingest/parse";
import { engineDataAt, loadHistory } from "@/run/history";
import { loadEngineData } from "@/run/load";
import { startAndExecute } from "@/run/execute";
import { getActiveConfig } from "@/run/config-store";
import { ordersFromShadowRows, shadowComparison } from "@/shadow/compare";
import { createTestDb } from "./db";
import { GOLDEN_AS_OF } from "./golden-table";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await loadFixtures(db);
});
afterEach(async () => close());

const orders = (csv: string) => ordersFromShadowRows(parseCsv("shadow_orders", csv).rows);

describe("shadow comparison with Raghav's own orders", () => {
  it("compares the month's system recommendation with his, with the system's reason for each disagreement", async () => {
    await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
    const csv = ["SKU_ID,Period,Qty", "SKU001,2026-10,900", "SKU003,2026-10,0", "SKU006,2026-10,200", "SKU002,2026-10,0", "SKU001,2026-12,10"].join("\n");
    const r = await shadowComparison(db, orders(csv));
    expect(r.periods).toEqual(["2026-10", "2026-12"]);
    expect(r.notes).toEqual(["2026-12: no completed runs in that month, so nothing to compare."]);
    const by = (sku: string) => r.rows.find((x) => x.skuId === sku)!;
    expect(by("SKU001")).toMatchObject({ agreed: true, systemAction: "REORDER_1_5X", orderedQty: 900, skuName: "Masala Peanuts 200g" });
    expect(by("SKU003")).toMatchObject({ agreed: false, raghavAction: "NO_ORDER" });
    expect(by("SKU003").reason).toMatch(/reorder the standard 500 units/);
    expect(by("SKU006")).toMatchObject({ agreed: false, systemAction: "PAUSE" });
    expect(by("SKU006").reason).toMatch(/pause the next order/);
    expect(by("SKU002")).toMatchObject({ agreed: true, systemAction: "HOLD" });
    // SKUs not in his file for a month that has rows are treated as not ordered
    expect(by("SKU004")).toMatchObject({ raghavAction: "NO_ORDER", agreed: false });
    expect(r.summary.overall.compared).toBe(15);
  });

  it("counts the system as ordering when any run in the month recommended a reorder", async () => {
    await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
    await startAndExecute(db, { trigger: "manual", asOf: "2026-10-26" }, { provider: null }); // W43 missing: everything is an exception
    const r = await shadowComparison(db, orders("SKU_ID,Period,Qty\nSKU003,2026-10,500\nSKU006,2026-10,0\n"));
    const by = (sku: string) => r.rows.find((x) => x.skuId === sku)!;
    expect(by("SKU003")).toMatchObject({ systemAction: "REORDER_NOW", agreed: true });
    // no reorder in any run: the latest run decides, and the second run could not judge SKU006 at all
    expect(by("SKU006")).toMatchObject({ systemAction: "exception:short_history", agreed: null });
  });

  it("rejects a bad file with reasons", () => {
    const p = parseCsv("shadow_orders", "SKU_ID,Period,Qty\nSKU001,2026-13,5\nSKU001,2026-10,x\nSKU001,2026-10,5\n");
    expect(p.rejects).toHaveLength(2);
    expect(p.rows).toHaveLength(1);
  });
});

describe("in-memory history slicing equals the database loader", () => {
  it("gives the engine the same data, for several run dates, so backtests at scale stay honest", async () => {
    const { config } = await getActiveConfig(db);
    const history = await loadHistory(db, { includeDistributors: false });
    for (const asOf of [GOLDEN_AS_OF, "2026-10-12", "2026-09-28"]) {
      const fromDb = await loadEngineData(db, asOf, { includeOpenPos: false });
      const sliced = engineDataAt(history, asOf);
      expect(sliced.latestInventoryDate).toBe(fromDb.latestInventoryDate);
      expect(evaluateAll(sliced.data, config)).toEqual(evaluateAll(fromDb.data, config));
    }
  });
});
