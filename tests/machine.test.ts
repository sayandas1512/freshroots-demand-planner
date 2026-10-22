import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import type { LlmProvider } from "@/ai/types";
import type { Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { exceptions, recommendations, runHeadlines, runs } from "@/db/schema";
import { ingestCsv } from "@/ingest/ingest";
import { advanceRun, findStuckRuns, LINES_PER_INVOCATION, runToCompletion, type RunStep } from "@/run/machine";
import { startRun } from "@/run/execute";
import { generateSynthetic } from "@/synthetic/generate";
import { createTestDb } from "./db";
import { GOLDEN, GOLDEN_AS_OF } from "./golden-table";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => close());

class Crash extends Error {}

/** Valid wording for any line: it names only numbers that are in the facts. */
function provider(calls: { explain: number; headline: number } = { explain: 0, headline: 0 }): LlmProvider {
  return {
    model: "test",
    explain: async (facts) => {
      calls.explain += 1;
      return {
        reasons: facts.map((f) => ({ sku_id: f.skuId, reason: `Cover is ${f.coverWeeks.toFixed(1)} weeks against a ${f.action === "PAUSE" ? `maximum of ${f.coverMax}, so pause the next order` : `minimum of ${f.coverMin}, so reorder`}.` })),
        usage: { inputTokens: 100, outputTokens: 20 },
      };
    },
    headline: async () => {
      calls.headline += 1;
      return { headline: ["The sheet is ready.", "The lowest cover lines are listed first.", "Nothing goes to procurement until you approve it."], usage: { inputTokens: 50, outputTokens: 10 } };
    },
  };
}

async function loadSample() {
  await loadFixtures(db);
  return (await startRun(db, { trigger: "manual", asOf: GOLDEN_AS_OF })).runId;
}

async function sheetCounts(runId: string) {
  const [recs] = await db.select({ n: count() }).from(recommendations).where(eq(recommendations.runId, runId));
  const [excs] = await db.select({ n: count() }).from(exceptions).where(eq(exceptions.runId, runId));
  return { lines: Number(recs?.n ?? 0), exceptions: Number(excs?.n ?? 0) };
}

describe("the run is a state machine saved in the runs row", () => {
  it("moves prepare, explain, headline, finalize one bounded step at a time", async () => {
    const runId = await loadSample();
    const steps: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const r = await advanceRun(db, runId, { provider: provider() });
      const [row] = await db.select().from(runs).where(eq(runs.id, runId));
      steps.push(`${r.outcome}:${row?.step}`);
      if (r.outcome === "finished") break;
    }
    expect(steps).toEqual(["progress:explain", "progress:headline", "progress:finalize", "finished:done"]);
    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row).toMatchObject({ status: "completed", step: "done", llmStatus: "ok", attempts: 0 });
    expect(row?.leaseUntil).toBeNull();
    expect(await sheetCounts(runId)).toEqual({ lines: 15, exceptions: 0 });
  });

  it("a finished run is left alone when advanced again", async () => {
    const runId = await loadSample();
    await runToCompletion(db, runId, { provider: null });
    expect((await advanceRun(db, runId, { provider: null })).outcome).toBe("finished");
    expect(await sheetCounts(runId)).toEqual({ lines: 15, exceptions: 0 });
  });
});

describe("leases", () => {
  it("only one invocation works on a run at a time", async () => {
    const runId = await loadSample();
    const [a, b] = await Promise.all([advanceRun(db, runId, { provider: null }), advanceRun(db, runId, { provider: null })]);
    expect([a.outcome, b.outcome].sort()).toEqual(["busy", "progress"]);
  });
  it("an expired lease can be taken over, a live one cannot", async () => {
    const runId = await loadSample();
    await db.update(runs).set({ leaseUntil: new Date(Date.now() + 60_000) }).where(eq(runs.id, runId));
    expect((await advanceRun(db, runId, { provider: null })).outcome).toBe("busy");
    await db.update(runs).set({ leaseUntil: new Date(Date.now() - 1000) }).where(eq(runs.id, runId));
    expect((await advanceRun(db, runId, { provider: null })).outcome).toBe("progress");
  });
  it("finds running runs that nobody is working on", async () => {
    const runId = await loadSample();
    expect(await findStuckRuns(db)).toEqual([]); // just started
    const later = new Date(Date.now() + 5 * 60_000);
    expect(await findStuckRuns(db, later)).toEqual([runId]);
    await db.update(runs).set({ leaseUntil: new Date(later.getTime() + 60_000) }).where(eq(runs.id, runId));
    expect(await findStuckRuns(db, later)).toEqual([]);
  });
});

describe("a crash in the middle of a run", () => {
  async function crashAt(step: RunStep, cursor: number) {
    const runId = await loadSample();
    let crashed = false;
    const hook = (s: RunStep, c: number) => {
      if (!crashed && s === step && c === cursor) {
        crashed = true;
        throw new Crash("process died");
      }
    };
    const outcomes: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const r = await advanceRun(db, runId, { provider: provider(), crashHook: hook });
      outcomes.push(r.outcome);
      if (r.outcome === "finished" || r.outcome === "failed") break;
    }
    return { runId, outcomes, crashed };
  }

  for (const step of ["prepare", "explain", "headline", "finalize"] as const) {
    it(`during ${step}: the next invocation resumes, and the sheet has no duplicates or gaps`, async () => {
      const { runId, outcomes, crashed } = await crashAt(step, 0);
      expect(crashed).toBe(true);
      expect(outcomes).toContain("retry");
      expect(outcomes.at(-1)).toBe("finished");
      const [row] = await db.select().from(runs).where(eq(runs.id, runId));
      expect(row).toMatchObject({ status: "completed", attempts: 0 });
      expect(await sheetCounts(runId)).toEqual({ lines: 15, exceptions: 0 });
      expect(await db.select().from(runHeadlines).where(eq(runHeadlines.runId, runId))).toHaveLength(1);
      const recs = await db.select().from(recommendations).where(eq(recommendations.runId, runId));
      for (const g of GOLDEN) expect([...(recs.find((r) => r.skuId === g.skuId)?.flags ?? [])].sort()).toEqual([...g.flags].sort());
    });
  }

  it("gives up and records a failed run after repeated failures in the same step", async () => {
    const runId = await loadSample();
    const always = () => {
      throw new Crash("disk on fire");
    };
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await advanceRun(db, runId, { provider: null, crashHook: always });
      outcomes.push(r.outcome);
      if (r.outcome === "failed") break;
    }
    expect(outcomes).toEqual(["retry", "retry", "failed"]);
    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row?.status).toBe("failed");
    expect(row?.counts.notes?.at(-1)).toMatch(/failed in step "prepare" after 3 attempts: disk on fire/);
  });
});

describe("full size: 400 SKUs, 156 weeks, 1,200 distributors", () => {
  it("ingests, runs in bounded steps, and resumes after a forced failure mid-way", { timeout: 300_000 }, async () => {
    const files = generateSynthetic();
    const reports = [
      await ingestCsv(db, "distributors", "d.csv", files.distributors),
      await ingestCsv(db, "sku_master", "m.csv", files.sku_master),
      await ingestCsv(db, "festival_calendar", "f.csv", files.festival_calendar),
      await ingestCsv(db, "sales", "s.csv", files.sales),
      await ingestCsv(db, "inventory", "i.csv", files.inventory),
    ];
    expect(reports.map((r) => [r.accepted, r.rejected])).toEqual([[1200, 0], [400, 0], [48, 0], [60880, 0], [396, 0]]);

    const runId = (await startRun(db, { trigger: "manual", asOf: "2026-10-19" })).runId;
    const calls = { explain: 0, headline: 0 };
    let crashed = false;
    const hook = (s: RunStep, c: number) => {
      if (!crashed && s === "explain" && c === LINES_PER_INVOCATION) {
        crashed = true;
        throw new Crash("function timed out");
      }
    };
    const longest: number[] = [];
    let invocations = 0;
    const outcomes: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const t0 = Date.now();
      const r = await advanceRun(db, runId, { provider: provider(calls), crashHook: hook });
      longest.push(Date.now() - t0);
      invocations += 1;
      outcomes.push(r.outcome);
      if (r.outcome === "finished" || r.outcome === "failed") break;
    }

    expect(crashed).toBe(true);
    expect(outcomes.at(-1)).toBe("finished");
    expect(outcomes).toContain("retry");
    expect(invocations).toBeGreaterThan(5); // no single invocation did the whole run
    expect(Math.max(...longest)).toBeLessThan(120_000); // each piece is far inside the 300 s function limit

    const sheet = await sheetCounts(runId);
    expect(sheet.lines + sheet.exceptions).toBe(400);
    expect(sheet.exceptions).toBeGreaterThanOrEqual(15); // new, short history, zero demand, jumps, missing stock
    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row).toMatchObject({ status: "completed", llmStatus: "ok", step: "done" });
    const flagged = (await db.select().from(recommendations).where(eq(recommendations.runId, runId))).filter((r) => r.flags.length > 0);
    expect(flagged.length).toBeGreaterThan(100);
    expect(flagged.every((r) => r.explanationSource === "llm")).toBe(true);
    expect(row?.counts.llm).toMatchObject({ total: flagged.length });
    // 25 lines per call: the crashed chunk's calls were made twice but only the committed ones are logged
    expect(calls.explain).toBeGreaterThanOrEqual(Math.ceil(flagged.length / 25));
    expect(row?.llmCalls).toBe(Math.ceil(flagged.length / 25) + 1);
  });
});
