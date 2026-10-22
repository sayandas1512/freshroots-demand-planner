import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { compareLines, disagreements, disagreementsCsv, ordersFromRows, summarise, type SystemLine } from "@/backtest/compare";
import { runBacktest, weekRange } from "@/backtest/replay";
import type { Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { backtestResults, recommendations, runs, weeklySales } from "@/db/schema";
import { DEFAULT_RULE_CONFIG } from "@/engine/config";
import { ingestCsv } from "@/ingest/ingest";
import { parseCsv } from "@/ingest/parse";
import { compareToRange, formatLakh } from "@/run/baseline";
import { applyDecision } from "@/run/decisions";
import { startAndExecute } from "@/run/execute";
import { loadHealth } from "@/run/health";
import { previewImpact } from "@/run/preview";
import { GOLDEN, GOLDEN_AS_OF } from "./golden-table";
import { createTestDb } from "./db";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await loadFixtures(db);
});
afterEach(async () => close());

const lines: SystemLine[] = [
  { week: "2026-W42", skuId: "A", systemAction: "REORDER_NOW", systemQty: 100 },
  { week: "2026-W42", skuId: "B", systemAction: "PAUSE", systemQty: null },
  { week: "2026-W42", skuId: "C", systemAction: "HOLD", systemQty: null },
  { week: "2026-W42", skuId: "D", systemAction: "exception:new_sku", systemQty: null },
  { week: "2026-W41", skuId: "A", systemAction: "REORDER_NOW", systemQty: 100 },
];
const ordersCsv = "SKU_ID,Week,Ordered_Qty\nA,2026-W42,120\nB,2026-W42,300\nD,2026-W42,50\n";

describe("compareLines and summaries", () => {
  const orders = ordersFromRows(parseCsv("orders", ordersCsv).rows);
  const rows = compareLines(lines, orders);
  it("compares at the level of order or not, treats a missing SKU as not ordered, and skips exceptions and unknown weeks", () => {
    const by = (week: string, sku: string) => rows.find((r) => r.week === week && r.skuId === sku)!;
    expect(by("2026-W42", "A")).toMatchObject({ raghavAction: "ORDER", agreed: true, orderedQty: 120 });
    expect(by("2026-W42", "B")).toMatchObject({ raghavAction: "ORDER", agreed: false });
    expect(by("2026-W42", "C")).toMatchObject({ raghavAction: "NO_ORDER", agreed: true, orderedQty: 0 });
    expect(by("2026-W42", "D")).toMatchObject({ raghavAction: "ORDER", agreed: null });
    expect(by("2026-W41", "A")).toMatchObject({ raghavAction: null, agreed: null });
  });
  it("summarises agreement overall and per action", () => {
    const s = summarise(rows);
    expect(s.overall).toMatchObject({ lines: 5, compared: 3, agreed: 2 });
    expect(s.overall.rate).toBeCloseTo(2 / 3, 9);
    expect(s.byAction.REORDER_NOW).toMatchObject({ lines: 2, compared: 1, agreed: 1, rate: 1 });
    expect(s.byAction.PAUSE?.rate).toBe(0);
  });
  it("without an orders file nothing is compared", () => {
    const s = summarise(compareLines(lines, null));
    expect(s.overall).toMatchObject({ compared: 0, rate: null });
  });
  it("exports disagreements as safe CSV", () => {
    const csv = disagreementsCsv(disagreements(rows));
    expect(csv.trim().split("\r\n")).toEqual(["Week,SKU_ID,System_Action,System_Qty,Raghav_Action,Ordered_Qty", "2026-W42,B,PAUSE,,ORDER,300"]);
    expect(disagreementsCsv([{ week: "w", skuId: "=cmd", systemAction: "x", systemQty: 1, raghavAction: "ORDER", orderedQty: 1, agreed: false }])).toContain("'=cmd");
  });
});

describe("weekRange", () => {
  it("lists weeks inclusively, across a year end, and rejects bad input", () => {
    expect(weekRange("2026-W39", "2026-W42")).toEqual(["2026-W39", "2026-W40", "2026-W41", "2026-W42"]);
    expect(weekRange("2026-W52", "2027-W02")).toEqual(["2026-W52", "2026-W53", "2027-W01", "2027-W02"]);
    expect(() => weekRange("2026-W42", "2026-W39")).toThrow(/not be after/);
    expect(() => weekRange("2026-W01", "2026-W40")).toThrow(/at most 26/);
    expect(() => weekRange("2026-42", "2026-W42")).toThrow();
  });
});

describe("runBacktest", () => {
  it("replaying W42 (run as of Monday 2026-10-19) matches the golden run, and earlier weeks without a snapshot say so", async () => {
    const out = await runBacktest(db, { from: "2026-W41", to: "2026-W42", orders: null });
    const w42 = out.rows.filter((r) => r.week === "2026-W42");
    expect(w42).toHaveLength(15);
    for (const g of GOLDEN) {
      const row = w42.find((r) => r.skuId === g.skuId)!;
      expect(row.systemAction.startsWith("exception")).toBe(false);
    }
    expect(w42.find((r) => r.skuId === "SKU001")).toMatchObject({ systemAction: "REORDER_1_5X", systemQty: 900 });
    expect(out.rows.filter((r) => r.week === "2026-W41").every((r) => r.systemAction === "exception:missing_stock")).toBe(true);
    expect(out.notes[0]).toMatch(/2026-W41: no stock snapshot on or before 2026-10-12/);
    expect(out.hasOrders).toBe(false);
    const [run] = await db.select().from(runs).where(eq(runs.id, out.runId));
    expect(run).toMatchObject({ trigger: "backtest", status: "completed" });
    expect(await db.select().from(backtestResults).where(eq(backtestResults.runId, out.runId))).toHaveLength(30);
  });

  it("never uses data from after the week being replayed", async () => {
    // W40 is replayed as of Monday 2026-10-12: sales through W40 and stock dated on or before that day.
    await ingestCsv(db, "inventory", "old.csv", "SKU_ID,Location,Units_On_Hand,As_Of_Date\nSKU003,Pune Central Warehouse,820,2026-10-05\n");
    const before = await runBacktest(db, { from: "2026-W40", to: "2026-W40", orders: null });
    const rowBefore = before.rows.find((r) => r.skuId === "SKU003")!;
    expect(rowBefore.systemAction).not.toMatch(/^exception/);

    // Rewrite the future: later sales (W41, W42) and a later stock snapshot (2026-10-13).
    await db.update(weeklySales).set({ units: 99999 }).where(eq(weeklySales.week, "2026-W41"));
    await db.update(weeklySales).set({ units: 99999 }).where(eq(weeklySales.week, "2026-W42"));
    await ingestCsv(db, "inventory", "new.csv", "SKU_ID,Location,Units_On_Hand,As_Of_Date\nSKU003,Pune Central Warehouse,1,2026-10-13\n");

    const after = await runBacktest(db, { from: "2026-W40", to: "2026-W40", orders: null });
    expect(after.rows.find((r) => r.skuId === "SKU003")).toEqual(rowBefore);
  });

  it("compares with an orders file and stores the result per line", async () => {
    const orders = ordersFromRows(parseCsv("orders", "SKU_ID,Week,Ordered_Qty\nSKU001,2026-W42,900\nSKU003,2026-W42,0\n").rows);
    const out = await runBacktest(db, { from: "2026-W42", to: "2026-W42", orders });
    expect(out.hasOrders).toBe(true);
    const sku1 = out.rows.find((r) => r.skuId === "SKU001")!;
    const sku3 = out.rows.find((r) => r.skuId === "SKU003")!;
    expect(sku1).toMatchObject({ agreed: true, orderedQty: 900 });
    expect(sku3).toMatchObject({ agreed: false, raghavAction: "NO_ORDER" });
    const stored = await db.select().from(backtestResults).where(eq(backtestResults.runId, out.runId));
    expect(stored.find((r) => r.skuId === "SKU003")).toMatchObject({ agreed: false, systemQty: 500, orderedQty: 0 });
  });
});

describe("previewImpact (Settings)", () => {
  it("shows which lines would change without saving anything", async () => {
    await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
    const noUplift = await previewImpact(db, { ...DEFAULT_RULE_CONFIG, festival_uplift: 0 });
    expect(noUplift.asOf).toBe(GOLDEN_AS_OF);
    expect(noUplift.changed).toEqual([{ skuId: "SKU002", before: "HOLD", after: "PAUSE" }]);

    const both = await previewImpact(db, { ...DEFAULT_RULE_CONFIG, festival_uplift_mode: "both_windows" });
    expect(both.changed).toEqual([]);

    const baselineOnly = await previewImpact(db, { ...DEFAULT_RULE_CONFIG, festival_uplift_mode: "baseline_only" });
    expect(baselineOnly.changed).toEqual([{ skuId: "SKU001", before: "REORDER_1_5X 900", after: "REORDER_NOW 600" }]);
    expect(baselineOnly.totalSkus).toBe(15);
    expect((await db.select().from(runs)).length).toBe(1);
  });
});

describe("baseline comparison", () => {
  it("reports below, within and above the brief's range", () => {
    expect(compareToRange(1_500_000, 1_800_000, 2_200_000)).toEqual({ verdict: "below", pctFromMidpoint: -25 });
    expect(compareToRange(2_000_000, 1_800_000, 2_200_000).verdict).toBe("within");
    expect(compareToRange(2_600_000, 1_800_000, 2_200_000)).toEqual({ verdict: "above", pctFromMidpoint: 30 });
    expect(formatLakh(1_800_000)).toBe("₹18.0 lakh");
  });
});

describe("loadHealth", () => {
  it("computes override rate, template fallback, flags by rule and a searchable override log", async () => {
    const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
    const recs = await db.select().from(recommendations).where(eq(recommendations.runId, res.runId));
    const id = (sku: string) => recs.find((r) => r.skuId === sku)!.id;
    await applyDecision(db, id("SKU004"), { action: "edit", qty: 300, reason: "Festival promo planned" });
    await applyDecision(db, id("SKU011"), { action: "reject", reason: "Distributor holds a pallet" });
    await applyDecision(db, id("SKU003"), { action: "approve" });

    const h = await loadHealth(db, "");
    expect(h.totals.runs).toBe(1);
    expect(h.totals.lines).toBe(15);
    expect(h.totals.overrideRate).toBeCloseTo(2 / 15, 9);
    expect(h.totals.overrideRateDecided).toBeCloseTo(2 / 3, 9);
    expect(h.totals.templateRate).toBe(1);
    expect(h.flagsByRule.find((r) => r.rule === "stockout_risk.perishable")?.count).toBe(2);
    expect(h.overrideLog).toHaveLength(2);
    expect(h.baseline[0]).toMatchObject({ period: "brief-quarterly-range", stockoutLossInr: 1_800_000, stockoutLossInrHigh: 2_200_000 });
    expect(h.alerts).toEqual([]);

    expect((await loadHealth(db, "pallet")).overrideLog.map((o) => o.skuId)).toEqual(["SKU011"]);
    expect((await loadHealth(db, "sku004")).overrideLog).toHaveLength(1);
    expect((await loadHealth(db, "no such text")).overrideLog).toHaveLength(0);
    expect((await loadHealth(db, "100%_")).overrideLog).toHaveLength(0);
  });

  it("surfaces degraded and failed runs as alerts", async () => {
    await startAndExecute(db, { trigger: "manual", asOf: "2026-10-27" }, { provider: null });
    const h = await loadHealth(db, "");
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0]?.status).toBe("completed_degraded");
  });
});
