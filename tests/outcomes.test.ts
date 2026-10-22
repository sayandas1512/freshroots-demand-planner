import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { outcomesWeekly, recommendations } from "@/db/schema";
import { gatherKillInput, decisionStats, quarterLabel, quarterMonths } from "@/kill/gather";
import { executeKillCheck } from "@/kill/check";
import { ingestWeeklyCsv, methodChanges, monthlyEntrySchema, upsertMonthly, upsertWeekly, loadOutcomes } from "@/outcomes/store";
import { applyDecision } from "@/run/decisions";
import { startAndExecute } from "@/run/execute";
import { createTestDb } from "./db";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await loadFixtures(db);
});
afterEach(async () => close());

describe("weekly outcomes", () => {
  it("upserts by week, and a CSV reports saved and rejected rows with reasons", async () => {
    await upsertWeekly(db, [{ week: "2026-W40", stockoutIncidents: 5, overstockValueInr: 100 }], "Manual entry", null);
    const report = await ingestWeeklyCsv(db, "report.csv", "Week,Stockout_Incidents,Overstock_Value_INR\n2026-W40,7,200\n2026-W41,3,300\n2026-W99,1,1\n2026-W42,-1,5\n2026-W41,9,9\n", null);
    expect(report).toMatchObject({ saved: 2, rejected: 3 });
    expect(report.rejects.map((r) => r.row)).toEqual([4, 5, 6]);
    const rows = await db.select().from(outcomesWeekly).orderBy(outcomesWeekly.week);
    expect(rows.map((r) => [r.week, r.stockoutIncidents])).toEqual([["2026-W40", 7], ["2026-W41", 3]]);
    expect((await ingestWeeklyCsv(db, "x.csv", "Week,Stock\n1,2\n", null)).fileError).toMatch(/Missing required column/);
  });
});

describe("monthly outcomes and the method warning", () => {
  const entry = (period: string, methodNote: string) => ({ period, stockoutLossInr: 1_000_000, writeoffInr: 500_000, methodNote });
  it("requires a method note", () => {
    expect(monthlyEntrySchema.safeParse(entry("2026-11", "abc")).success).toBe(false);
    expect(monthlyEntrySchema.safeParse(entry("2026-13", "Lost units x margin")).success).toBe(false);
    expect(monthlyEntrySchema.safeParse(entry("2026-11", "Lost units x margin")).success).toBe(true);
  });
  it("warns when the method differs from the previous period's, ignoring case and spacing", async () => {
    expect((await upsertMonthly(db, entry("2026-10", "Lost units x margin"), null)).methodChanged).toBeNull();
    expect((await upsertMonthly(db, entry("2026-11", "  lost   UNITS x margin "), null)).methodChanged).toBeNull();
    const changed = await upsertMonthly(db, entry("2026-12", "Finance estimate of lost sales"), null);
    expect(changed.methodChanged).toEqual({ previous: "2026-11", previousNote: "  lost   UNITS x margin " });
    const o = await loadOutcomes(db);
    expect(o.methodChanges.map((c) => c.period)).toEqual(["2026-12"]);
    expect(methodChanges([{ period: "2026-01", methodNote: "a method" }])).toEqual([]);
  });
});

describe("quarters", () => {
  it("builds quarter months and labels", () => {
    expect(quarterMonths("2026-10-01")).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(quarterMonths("2027-01-01")).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(quarterLabel("2027-04-01")).toBe("2027-Q2");
  });
});

describe("decision timing and the rubber-stamp warning", () => {
  async function fastRun(asOf: string, overrides: number) {
    const res = await startAndExecute(db, { trigger: "manual", asOf }, { provider: null });
    const recs = await db.select().from(recommendations).where(eq(recommendations.runId, res.runId));
    const t0 = new Date("2026-10-19T08:00:00Z");
    let i = 0;
    for (const r of recs) {
      await db.update(recommendations).set({ firstViewedAt: t0 }).where(eq(recommendations.id, r.id));
      const at = new Date(t0.getTime() + 2000); // decided 2 seconds after first view
      if (i < overrides) await applyDecision(db, r.id, { action: "reject", reason: "Not needed this week" }, null, at);
      else await applyDecision(db, r.id, { action: "approve" }, null, at);
      i += 1;
    }
  }

  it("computes median seconds and override rate, and warns after 4 fast, rubber-stamped runs", async () => {
    for (const d of ["2026-10-19", "2026-10-20", "2026-10-21"]) await fastRun(d, 0);
    expect((await decisionStats(db, 4)).runs).toBe(3);
    expect(executeKillCheck(await gatherKillInput(db)).criteria.find((c) => c.id === "rubber_stamp")?.status).toBe("no_data");
    await fastRun("2026-10-22", 0);
    const stats = await decisionStats(db, 4);
    expect(stats).toMatchObject({ runs: 4, decided: 60, overrideRate: 0 });
    expect(stats.medianSeconds).toBe(2);
    const result = executeKillCheck(await gatherKillInput(db));
    expect(result.criteria.find((c) => c.id === "rubber_stamp")?.status).toBe("warn");
    expect(result.tripped).toBe(false);
  });

  it("does not warn when the planner overrides some lines, even if every decision is fast", async () => {
    for (const d of ["2026-10-19", "2026-10-20", "2026-10-21"]) await fastRun(d, 0);
    await fastRun("2026-10-22", 3);
    expect(executeKillCheck(await gatherKillInput(db)).criteria.find((c) => c.id === "rubber_stamp")?.status).toBe("ok");
  });
});
