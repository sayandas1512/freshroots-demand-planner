import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { LlmProvider } from "@/ai/types";
import type { Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { exceptions, overrides, recommendations, runHeadlines, runs, ruleConfig } from "@/db/schema";
import { DEFAULT_RULE_CONFIG } from "@/engine/config";
import { toPurchaseOrderCsv, neutraliseCell } from "@/export/csv";
import { approvedExportLines } from "@/export/query";
import { ingestCsv } from "@/ingest/ingest";
import { createConfigVersion, getActiveConfig } from "@/run/config-store";
import { applyDecision, applyExceptionAction } from "@/run/decisions";
import { STEP_ORDER, executeRun, startAndExecute, startRun } from "@/run/execute";
import { createTestDb } from "./db";
import { GOLDEN, GOLDEN_AS_OF } from "./golden-table";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await loadFixtures(db);
});
afterEach(async () => close());

const failingProvider: LlmProvider = {
  model: "test",
  explain: async () => {
    throw new Error("503 overloaded");
  },
  headline: async () => {
    throw new Error("503 overloaded");
  },
};

const goodProvider: LlmProvider = {
  model: "test",
  explain: async (facts) => ({
    reasons: facts.map((f) => ({
      sku_id: f.skuId,
      reason: `Cover is ${f.coverWeeks.toFixed(1)} weeks against ${f.action === "PAUSE" ? `a maximum of ${f.coverMax}, so pause the next order` : `a minimum of ${f.coverMin}, so reorder`}.`,
    })),
    usage: { inputTokens: 5000, outputTokens: 800 },
  }),
  headline: async () => ({ headline: ["15 SKUs reviewed.", "The lowest cover is on the urgent lines.", "Nothing goes to procurement until you approve it."], usage: { inputTokens: 400, outputTokens: 60 } }),
};

describe("executeRun (integration)", () => {
  it("runs the fixtures to 15 recommendation lines with the golden flags and template reasons", async () => {
    const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
    expect(res.status).toBe("completed");

    const recs = await db.select().from(recommendations).where(eq(recommendations.runId, res.runId));
    expect(recs).toHaveLength(15);
    for (const g of GOLDEN) {
      const rec = recs.find((r) => r.skuId === g.skuId)!;
      expect([...rec.flags].sort()).toEqual([...g.flags].sort());
      expect(rec.status).toBe("pending");
      expect(rec.explanation.length).toBeGreaterThan(20);
      expect(rec.explanationSource).toBe("template");
      expect(rec.metrics.coverWeeks).toBeGreaterThan(0);
    }
    const [run] = await db.select().from(runs).where(eq(runs.id, res.runId));
    expect(run).toMatchObject({ status: "completed", llmStatus: "skipped", llmCalls: 0, configVersion: 1 });
    expect(run?.finishedAt).not.toBeNull();
    expect(Object.keys(run?.counts.steps ?? {}).sort()).toEqual([...STEP_ORDER].sort());
    const [headline] = await db.select().from(runHeadlines).where(eq(runHeadlines.runId, res.runId));
    expect(headline?.source).toBe("template");
    expect(headline?.text.split("\n")).toHaveLength(3);
  });

  it("with the LLM failing, the run completes degraded with template explanations and headline", async () => {
    const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: failingProvider });
    expect(res.status).toBe("completed_degraded");
    const [run] = await db.select().from(runs).where(eq(runs.id, res.runId));
    expect(run).toMatchObject({ llmStatus: "failed", llmCalls: 4 });
    const recs = await db.select().from(recommendations).where(eq(recommendations.runId, res.runId));
    expect(recs).toHaveLength(15);
    expect(recs.every((r) => r.explanationSource === "template" && r.explanation.length > 0)).toBe(true);
    const [headline] = await db.select().from(runHeadlines).where(eq(runHeadlines.runId, res.runId));
    expect(headline?.source).toBe("template");
    expect(run?.counts.steps?.llm_explain?.status).toBe("degraded");
  });

  it("with a working LLM, flagged lines carry llm wording, hold lines keep templates, and cost is logged", async () => {
    const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: goodProvider });
    expect(res.status).toBe("completed");
    const recs = await db.select().from(recommendations).where(eq(recommendations.runId, res.runId));
    const flagged = recs.filter((r) => r.flags.length > 0);
    expect(flagged).toHaveLength(7);
    expect(flagged.every((r) => r.explanationSource === "llm")).toBe(true);
    expect(recs.filter((r) => r.flags.length === 0).every((r) => r.explanationSource === "template")).toBe(true);
    const [run] = await db.select().from(runs).where(eq(runs.id, res.runId));
    expect(run).toMatchObject({ llmStatus: "ok", llmCalls: 2 });
    expect(Number(run?.llmCostUsd)).toBeGreaterThan(0);
    const [headline] = await db.select().from(runHeadlines).where(eq(runHeadlines.runId, res.runId));
    expect(headline?.source).toBe("llm");
  });

  it("marks the run degraded and says why when stock data is stale", async () => {
    const res = await startAndExecute(db, { trigger: "manual", asOf: "2026-10-27" }, { provider: null });
    expect(res.status).toBe("completed_degraded");
    const [run] = await db.select().from(runs).where(eq(runs.id, res.runId));
    expect(run?.counts.notes?.join(" ")).toMatch(/Stock data is 8 days old/);
  });

  it("routes a SKU with no sales and unknown-SKU rows to exceptions without stopping the rest", async () => {
    await ingestCsv(db, "sku_master", "m.csv", "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID\nSKU016,Brand New Launch,Snacks,Low,100,case,D001\n");
    await ingestCsv(db, "sales", "s.csv", "SKU_ID,Week,Units_Sold\nSKU777,2026-W42,40\n");
    const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
    const recs = await db.select().from(recommendations).where(eq(recommendations.runId, res.runId));
    const exc = await db.select().from(exceptions).where(eq(exceptions.runId, res.runId));
    expect(recs).toHaveLength(15);
    expect(exc.map((e) => `${e.skuId}:${e.type}`).sort()).toEqual(["SKU016:new_sku", "SKU777:unknown_sku"]);
    expect(exc.every((e) => e.status === "open")).toBe(true);
  });

  it("records a failed run instead of throwing when data cannot be loaded", async () => {
    const [created] = await db.insert(runs).values({ trigger: "manual", asOfDate: GOLDEN_AS_OF }).returning();
    await db.update(ruleConfig).set({ config: { nonsense: true } });
    const out = await executeRun(db, created!.id, { provider: null });
    expect(out.status).toBe("failed");
    const [run] = await db.select().from(runs).where(eq(runs.id, created!.id));
    expect(run?.status).toBe("failed");
    expect(run?.counts.notes?.[0]).toMatch(/Run failed/);
  });
});

describe("startRun (idempotency and locking)", () => {
  it("returns the existing run for the same date and trigger within 10 minutes", async () => {
    const t0 = new Date("2026-10-19T02:00:00Z");
    const a = await startRun(db, { trigger: "manual", asOf: GOLDEN_AS_OF, now: t0 });
    await db.update(runs).set({ status: "completed" }).where(eq(runs.id, a.runId));
    const b = await startRun(db, { trigger: "manual", asOf: GOLDEN_AS_OF, now: new Date(t0.getTime() + 9 * 60_000) });
    expect(b).toEqual({ runId: a.runId, created: false, reason: "existing" });
    const c = await startRun(db, { trigger: "manual", asOf: GOLDEN_AS_OF, now: new Date(t0.getTime() + 11 * 60_000) });
    expect(c.created).toBe(true);
  });

  it("never lets two runs overlap, even concurrently", async () => {
    const [x, y] = await Promise.all([startRun(db, { trigger: "manual", asOf: "2026-10-19" }), startRun(db, { trigger: "cron", asOf: "2026-10-20" })]);
    expect([x.created, y.created].filter(Boolean)).toHaveLength(1);
    const winner = x.created ? x : y;
    const loser = x.created ? y : x;
    expect(loser).toMatchObject({ runId: winner.runId, reason: "in_progress" });
    expect((await db.select().from(runs)).filter((r) => r.status === "running")).toHaveLength(1);
  });

  it("does not return a failed run as the idempotent result, and clears runs stuck in running", async () => {
    const t0 = new Date("2026-10-19T02:00:00Z");
    const a = await startRun(db, { trigger: "manual", asOf: GOLDEN_AS_OF, now: t0 });
    await db.update(runs).set({ status: "failed" }).where(eq(runs.id, a.runId));
    expect((await startRun(db, { trigger: "manual", asOf: GOLDEN_AS_OF, now: new Date(t0.getTime() + 60_000) })).created).toBe(true);
    const later = await startRun(db, { trigger: "manual", asOf: "2026-10-21", now: new Date(t0.getTime() + 45 * 60_000) });
    expect(later.created).toBe(true);
    expect((await db.select().from(runs).where(eq(runs.status, "failed"))).length).toBe(2);
  });
});

describe("rule config versions", () => {
  it("is append-only: activating a version deactivates the others, and runs record the version", async () => {
    const v2 = await createConfigVersion(db, { ...DEFAULT_RULE_CONFIG, festival_uplift_mode: "both_windows" }, "Raghav prefers both windows");
    expect(v2.version).toBe(2);
    const all = await db.select().from(ruleConfig);
    expect(all.filter((c) => c.isActive).map((c) => c.version)).toEqual([2]);
    expect((await getActiveConfig(db)).config.festival_uplift_mode).toBe("both_windows");
    const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
    const [run] = await db.select().from(runs).where(eq(runs.id, res.runId));
    expect(run?.configVersion).toBe(2);
    await expect(createConfigVersion(db, { ...DEFAULT_RULE_CONFIG, cover_min_weeks: 99 }, "bad")).rejects.toThrow();
  });
});

describe("decisions, override log and export", () => {
  async function runWithLines() {
    const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
    const recs = await db.select().from(recommendations).where(eq(recommendations.runId, res.runId));
    const by = (sku: string) => recs.find((r) => r.skuId === sku)!;
    return { runId: res.runId, by };
  }

  it("approve, edit and reject set the final state; edit and reject write the override log with reasons", async () => {
    const { runId, by } = await runWithLines();
    const approved = await applyDecision(db, by("SKU003").id, { action: "approve" });
    expect(approved).toMatchObject({ status: "approved", finalQty: 500 });
    const edited = await applyDecision(db, by("SKU004").id, { action: "edit", qty: 300, reason: "Festival promo planned" });
    expect(edited).toMatchObject({ status: "edited", finalQty: 300, decidedNote: "Festival promo planned" });
    const rejected = await applyDecision(db, by("SKU011").id, { action: "reject", reason: "Distributor already holds stock" });
    expect(rejected).toMatchObject({ status: "rejected", finalQty: null });

    const log = await db.select().from(overrides);
    expect(log.map((o) => [o.field, o.fromValue, o.toValue, o.reason]).sort()).toEqual(
      [
        ["qty", "240", "300", "Festival promo planned"],
        ["status", "REORDER_NOW 600", "rejected", "Distributor already holds stock"],
      ].sort(),
    );

    const lines = await approvedExportLines(db, runId);
    expect(lines.map((l) => [l.skuId, l.quantity])).toEqual([
      ["SKU003", 500],
      ["SKU004", 300],
    ]);
  });

  it("undo restores pending and is itself logged", async () => {
    const { by } = await runWithLines();
    await applyDecision(db, by("SKU003").id, { action: "reject", reason: "Wrong pack size" });
    const undone = await applyDecision(db, by("SKU003").id, { action: "undo" });
    expect(undone).toMatchObject({ status: "pending", finalQty: null, decidedAt: null });
    expect(await db.select().from(overrides).where(eq(overrides.toValue, "pending"))).toHaveLength(1);
  });

  it("exports only approved and edited lines that have a quantity; approving a PAUSE line adds nothing", async () => {
    const { runId, by } = await runWithLines();
    await applyDecision(db, by("SKU006").id, { action: "approve" }); // PAUSE: no quantity
    await applyDecision(db, by("SKU002").id, { action: "approve" }); // HOLD
    await applyDecision(db, by("SKU013").id, { action: "reject", reason: "Supplier on strike" });
    expect(await approvedExportLines(db, runId)).toEqual([]);
    await applyDecision(db, by("SKU006").id, { action: "edit", qty: 50, reason: "Small top-up for a festival order" });
    expect((await approvedExportLines(db, runId)).map((l) => l.skuId)).toEqual(["SKU006"]);
  });

  it("builds the purchase-order CSV with the agreed columns and neutralises formula injection", async () => {
    const { runId, by } = await runWithLines();
    await applyDecision(db, by("SKU003").id, { action: "approve" });
    const csv = toPurchaseOrderCsv(await approvedExportLines(db, runId));
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toBe("SKU_ID,SKU_Name,Quantity,Unit,Distributor_ID,Run_ID,Approved_At");
    expect(row).toMatch(/^SKU003,Poha Thick 500g,500,case,D001,[0-9a-f-]{36},\d{4}-\d{2}-\d{2}T/);

    expect(neutraliseCell("=1+1")).toBe("'=1+1");
    expect(neutraliseCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(neutraliseCell("-2")).toBe("'-2");
    expect(neutraliseCell("@x")).toBe("'@x");
    expect(neutraliseCell("Poha")).toBe("Poha");
    const hostile = toPurchaseOrderCsv([{ skuId: "A", skuName: '=HYPERLINK("http://x"),y', quantity: 5, unit: "case", distributorId: "D1", runId: "r", approvedAt: new Date(0) }]);
    expect(hostile).toContain(`"'=HYPERLINK(""http://x""),y"`);
  });

  it("handles and reopens exceptions with a required note", async () => {
    await ingestCsv(db, "sku_master", "m.csv", "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID\nSKU016,Brand New Launch,Snacks,Low,100,case,D001\n");
    const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
    const [exc] = await db.select().from(exceptions).where(and(eq(exceptions.runId, res.runId), eq(exceptions.skuId, "SKU016")));
    const handled = await applyExceptionAction(db, exc!.id, { action: "handle", note: "Launch buy set by sales head" });
    expect(handled).toMatchObject({ status: "handled", handledNote: "Launch buy set by sales head" });
    expect(await applyExceptionAction(db, exc!.id, { action: "reopen" })).toMatchObject({ status: "open", handledNote: null });
  });
});
