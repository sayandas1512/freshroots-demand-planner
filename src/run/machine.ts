import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { createProvider } from "@/ai";
import { explainFactsFor, headlineFactsFor } from "@/ai/facts";
import { explainChunk, headlineFor, llmStatusFor } from "@/ai/generate";
import { costUsd } from "@/ai/status";
import { templateReason } from "@/ai/templates";
import type { LlmProvider } from "@/ai/types";
import { getEnv } from "@/config/env";
import type { Db } from "@/db/client";
import { exceptions as exceptionsTable, recommendations, runHeadlines, runs, skus, type RunCounts } from "@/db/schema";
import { evaluateAll } from "@/engine/evaluate";
import type { EvaluationResult, ExceptionItem, RecommendationLine, SkuMaster } from "@/engine/types";
import { daysBetween } from "@/engine/weeks";
import { runKillCheck } from "@/kill/run";
import { ensureFreshOpenPos } from "@/zoho";
import { log } from "@/lib/log";
import { notifyRunProblem } from "./alerts";
import { getActiveConfig } from "./config-store";
import { loadEngineData } from "./load";

/**
 * The run as a resumable state machine. Each call to `advanceRun` does one bounded piece of work and saves
 * where it got to (step, cursor) in the runs row, so no single serverless invocation has to finish a whole run
 * and a crash in the middle loses at most one piece:
 *
 *   prepare   load data, apply the rules, save the draft sheet and exceptions (one transaction)
 *   explain   LLM reasons for flagged lines, `LINES_PER_INVOCATION` at a time (25 per call)
 *   headline  the three-line headline
 *   finalize  status, cost, kill check, alerts
 *
 * A lease stops two invocations working on the same run. Every write is either atomic or idempotent, so resuming
 * never duplicates a line.
 */
export type RunStep = "prepare" | "explain" | "headline" | "finalize" | "done";
export type StepName = "ingest_check" | "rules" | "exceptions" | "llm_explain" | "llm_headline" | "sheet_saved" | "done";
export const STEP_ORDER: StepName[] = ["ingest_check", "rules", "exceptions", "llm_explain", "llm_headline", "sheet_saved", "done"];
type StepStatus = NonNullable<RunCounts["steps"]>[string]["status"];

export const LINES_PER_INVOCATION = 75;
export const MAX_STEP_ATTEMPTS = 3;
export const LEASE_MS = 5 * 60_000;

export interface AdvanceOptions {
  /** Defaults to the configured LLM provider, or none (templates only). */
  provider?: LlmProvider | null;
  callTimeoutMs?: number;
  /** Test hook: called inside a step after its work is done and before it is saved. Throw to simulate a crash. */
  crashHook?: (step: RunStep, cursor: number) => void;
}

export type AdvanceOutcome = "progress" | "finished" | "failed" | "retry" | "busy";

export interface AdvanceResult {
  outcome: AdvanceOutcome;
  step: RunStep;
  cursor: number;
  status: string;
}

interface LlmCounts {
  provider: boolean;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  good: number;
  total: number;
  headlineSource?: "llm" | "template";
  model?: string | null;
}

class Progress {
  constructor(
    private readonly db: Db,
    private readonly runId: string,
    private counts: RunCounts,
  ) {}

  async step(name: StepName, status: StepStatus, detail?: string): Promise<void> {
    const steps = { ...(this.counts.steps ?? {}) };
    steps[name] = { status, at: new Date().toISOString(), ...(detail ? { detail } : {}) };
    this.counts = { ...this.counts, steps };
    await this.flush();
  }

  async note(text: string): Promise<void> {
    this.counts = { ...this.counts, notes: [...(this.counts.notes ?? []), text] };
    await this.flush();
  }

  merge(extra: Partial<RunCounts>): void {
    this.counts = { ...this.counts, ...extra };
  }

  get snapshot(): RunCounts {
    return this.counts;
  }

  async flush(): Promise<void> {
    await this.db.update(runs).set({ counts: this.counts, updatedAt: new Date() }).where(eq(runs.id, this.runId));
  }
}

function tally(result: EvaluationResult): Pick<RunCounts, "lines" | "exceptions" | "byAction" | "byFlag" | "byRule"> {
  const byAction: Record<string, number> = {};
  const byFlag: Record<string, number> = {};
  const byRule: Record<string, number> = {};
  for (const l of result.lines) {
    byAction[l.action] = (byAction[l.action] ?? 0) + 1;
    byRule[l.ruleFired] = (byRule[l.ruleFired] ?? 0) + 1;
    for (const f of l.flags) byFlag[f] = (byFlag[f] ?? 0) + 1;
  }
  for (const e of result.exceptions) byRule[`exception.${e.type}`] = (byRule[`exception.${e.type}`] ?? 0) + 1;
  return { lines: result.lines.length, exceptions: result.exceptions.length, byAction, byFlag, byRule };
}

const llmOf = (c: RunCounts): LlmCounts => (c.llm as LlmCounts | undefined) ?? { provider: false, calls: 0, inputTokens: 0, outputTokens: 0, good: 0, total: 0 };

function chosenProvider(options: AdvanceOptions): LlmProvider | null {
  return options.provider === undefined ? createProvider() : options.provider;
}

function lineFromRow(r: typeof recommendations.$inferSelect): RecommendationLine {
  return { skuId: r.skuId, action: r.action, flags: r.flags as RecommendationLine["flags"], ruleFired: r.ruleFired, qty: r.qty, metrics: r.metrics };
}

/** Take the lease on a running run, or return null when it is finished or someone else holds it. */
async function acquireLease(db: Db, runId: string, now: Date) {
  const [row] = await db
    .update(runs)
    .set({ leaseUntil: new Date(now.getTime() + LEASE_MS) })
    .where(and(eq(runs.id, runId), eq(runs.status, "running"), or(isNull(runs.leaseUntil), lt(runs.leaseUntil, now))))
    .returning();
  return row ?? null;
}

// ---- steps

async function prepare(db: Db, run: typeof runs.$inferSelect, progress: Progress, options: AdvanceOptions): Promise<void> {
  const asOf = run.asOfDate;
  await progress.step("ingest_check", "running");
  // Fresh open POs from Zoho when the connector is on. A failed sync never stops the run.
  const zoho = await ensureFreshOpenPos(db);
  if (zoho.attempted && (!zoho.report || !zoho.report.ok)) {
    await progress.note(`Zoho sync failed${zoho.report?.error ? ` (${zoho.report.error})` : ""}. Open POs are as of ${zoho.lastOkAt ? zoho.lastOkAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never"}.`);
  }
  const { version, config } = await getActiveConfig(db);
  const loaded = await loadEngineData(db, asOf, { includeOpenPos: true, includeDistributors: config.enable_distributor_exceptions });
  const inventoryAge = loaded.latestInventoryDate === null ? null : daysBetween(loaded.latestInventoryDate, asOf);
  const stale = inventoryAge === null || inventoryAge > config.stale_inventory_days;
  if (stale) {
    await progress.note(
      inventoryAge === null ? "No inventory snapshot exists on or before the run date." : `Stock data is ${inventoryAge} days old (limit ${config.stale_inventory_days}). Treat cover figures with care.`,
    );
  }
  progress.merge({ inventoryAgeDays: inventoryAge, festivalMode: config.festival_uplift_mode, stale });
  await progress.step("ingest_check", stale ? "degraded" : "done", loaded.latestInventoryDate ? `Stock as of ${loaded.latestInventoryDate}` : "No stock data");

  await progress.step("rules", "running");
  const result = evaluateAll(loaded.data, config);
  await progress.step("rules", "done", `${result.lines.length} lines`);

  await progress.step("exceptions", "running");
  const skuMap = new Map(loaded.data.skus.map((s) => [s.skuId, s]));
  const wording = new Map(result.lines.map((l) => [l.skuId, templateReason(explainFactsFor(l, skuMap.get(l.skuId) as SkuMaster))]));
  const flaggedTotal = result.lines.filter((l) => l.flags.length > 0).length;
  progress.merge({ ...tally(result), flaggedTotal });
  options.crashHook?.("prepare", 0);

  // The draft sheet, the exceptions and the move to the next step are saved together or not at all.
  await db.transaction(async (tx) => {
    for (let i = 0; i < result.lines.length; i += 200) {
      await tx
        .insert(recommendations)
        .values(
          result.lines.slice(i, i + 200).map((l) => ({
            runId: run.id,
            skuId: l.skuId,
            action: l.action,
            flags: l.flags,
            ruleFired: l.ruleFired,
            qty: l.qty,
            metrics: l.metrics,
            explanation: wording.get(l.skuId) as string,
            explanationSource: "template" as const,
          })),
        )
        .onConflictDoNothing();
    }
    for (let i = 0; i < result.exceptions.length; i += 200) {
      await tx.insert(exceptionsTable).values(result.exceptions.slice(i, i + 200).map((e) => ({ runId: run.id, skuId: e.skuId, type: e.type, detail: e.detail })));
    }
    await tx
      .update(runs)
      .set({ configVersion: version, step: "explain", cursor: 0, attempts: 0, counts: progress.snapshot, updatedAt: new Date() })
      .where(eq(runs.id, run.id));
  });
  await progress.step("exceptions", "done", `${result.exceptions.length} routed to Raghav`);
}

async function explain(db: Db, run: typeof runs.$inferSelect, progress: Progress, options: AdvanceOptions): Promise<void> {
  const flaggedTotal = Number(run.counts.flaggedTotal ?? 0);
  const provider = chosenProvider(options);
  if (run.cursor === 0) await progress.step("llm_explain", "running");

  const rows = await db
    .select({ rec: recommendations, sku: skus })
    .from(recommendations)
    .innerJoin(skus, eq(skus.skuId, recommendations.skuId))
    .where(and(eq(recommendations.runId, run.id), sql`cardinality(${recommendations.flags}) > 0`))
    .orderBy(asc(recommendations.skuId))
    .limit(LINES_PER_INVOCATION)
    .offset(run.cursor);
  const facts = rows.map(({ rec, sku }) => explainFactsFor(lineFromRow(rec), { skuId: sku.skuId, name: sku.name, category: sku.category, perishability: sku.perishability, standardReorderQty: sku.standardReorderQty, unit: sku.unit, distributorId: sku.distributorId }));
  const chunk = await explainChunk(provider, facts, options.callTimeoutMs);
  options.crashHook?.("explain", run.cursor);

  const llm = { ...llmOf(run.counts) };
  llm.provider = provider !== null;
  llm.model = provider?.model ?? null;
  llm.calls += chunk.calls;
  llm.inputTokens += chunk.usage.inputTokens;
  llm.outputTokens += chunk.usage.outputTokens;
  llm.total += chunk.explanations.length;
  llm.good += chunk.explanations.filter((e) => e.source === "llm").length;
  const next = run.cursor + rows.length;
  const done = rows.length === 0 || next >= flaggedTotal;
  progress.merge({ llm });

  await db.transaction(async (tx) => {
    for (const e of chunk.explanations.filter((x) => x.source === "llm")) {
      await tx.update(recommendations).set({ explanation: e.text, explanationSource: "llm" }).where(and(eq(recommendations.runId, run.id), eq(recommendations.skuId, e.skuId)));
    }
    await tx
      .update(runs)
      .set({ step: done ? "headline" : "explain", cursor: done ? 0 : next, attempts: 0, counts: progress.snapshot, updatedAt: new Date() })
      .where(eq(runs.id, run.id));
  });
  if (done) {
    const degraded = llm.good < llm.total;
    await progress.step("llm_explain", !degraded ? "done" : provider ? "degraded" : "skipped");
    await progress.step("llm_headline", "running");
  }
}

async function headline(db: Db, run: typeof runs.$inferSelect, progress: Progress, options: AdvanceOptions): Promise<void> {
  const provider = chosenProvider(options);
  const recRows = await db.select().from(recommendations).where(eq(recommendations.runId, run.id));
  const excRows = await db.select().from(exceptionsTable).where(eq(exceptionsTable.runId, run.id));
  const skuRows = await db.select().from(skus);
  const skuMap = new Map<string, SkuMaster>(skuRows.map((s) => [s.skuId, { skuId: s.skuId, name: s.name, category: s.category, perishability: s.perishability, standardReorderQty: s.standardReorderQty, unit: s.unit, distributorId: s.distributorId }]));
  const exceptionItems: ExceptionItem[] = excRows.map((e) => ({ skuId: e.skuId, type: e.type, detail: e.detail }));
  const facts = headlineFactsFor(run.asOfDate, recRows.map(lineFromRow), exceptionItems, skuMap, run.counts.stale === true);
  const result = await headlineFor(provider, facts, options.callTimeoutMs);
  options.crashHook?.("headline", 0);

  const llm = { ...llmOf(run.counts) };
  llm.provider = provider !== null;
  llm.model = provider?.model ?? null;
  llm.calls += result.calls;
  llm.inputTokens += result.usage.inputTokens;
  llm.outputTokens += result.usage.outputTokens;
  llm.headlineSource = result.source;
  progress.merge({ llm });

  await db.transaction(async (tx) => {
    await tx.insert(runHeadlines).values({ runId: run.id, text: result.lines.join("\n"), source: result.source }).onConflictDoNothing();
    await tx.update(runs).set({ step: "finalize", cursor: 0, attempts: 0, counts: progress.snapshot, updatedAt: new Date() }).where(eq(runs.id, run.id));
  });
  await progress.step("llm_headline", result.source === "llm" ? "done" : provider ? "degraded" : "skipped");
}

async function finalize(db: Db, run: typeof runs.$inferSelect, progress: Progress, options: AdvanceOptions): Promise<string> {
  const llm = llmOf(run.counts);
  const total = llm.total + 1;
  const good = llm.good + (llm.headlineSource === "llm" ? 1 : 0);
  const llmStatus = llmStatusFor(good, total, llm.provider);
  const env = getEnv();
  const cost = llm.provider ? costUsd({ inputTokens: llm.inputTokens, outputTokens: llm.outputTokens }, { inPerMTok: env.LLM_PRICE_IN_PER_MTOK, outPerMTok: env.LLM_PRICE_OUT_PER_MTOK }) : null;
  const degraded = run.counts.stale === true || llmStatus === "partial" || llmStatus === "failed";
  const status = degraded ? "completed_degraded" : "completed";
  progress.merge({ llmTokens: { inputTokens: llm.inputTokens, outputTokens: llm.outputTokens }, llmModel: llm.model ?? null });
  await progress.step("sheet_saved", "done", `${run.counts.lines ?? 0} lines saved`);
  await progress.step("done", degraded ? "degraded" : "done");
  options.crashHook?.("finalize", 0);
  await db
    .update(runs)
    .set({ status, step: "done", cursor: 0, attempts: 0, finishedAt: new Date(), counts: progress.snapshot, llmStatus, llmCalls: llm.calls, llmCostUsd: cost === null ? null : cost.toFixed(6), leaseUntil: null, updatedAt: new Date() })
    .where(eq(runs.id, run.id));

  try {
    await runKillCheck(db, { trigger: "run", runId: run.id });
  } catch (err) {
    log("error", "kill check failed", { runId: run.id, error: err instanceof Error ? err.message : "unknown" });
  }
  if (degraded) {
    const reasons = [...(progress.snapshot.notes ?? []), ...(llmStatus === "partial" || llmStatus === "failed" ? [`LLM ${llmStatus}: template wording used`] : [])];
    await notifyRunProblem({ runId: run.id, asOf: run.asOfDate, status: "completed_degraded", reasons });
  }
  return status;
}

/** Do one bounded piece of work on a run. Safe to call at any time, from any invocation, any number of times. */
export async function advanceRun(db: Db, runId: string, options: AdvanceOptions = {}, now: Date = new Date()): Promise<AdvanceResult> {
  const run = await acquireLease(db, runId, now);
  if (!run) {
    const [current] = await db.select({ status: runs.status, step: runs.step, cursor: runs.cursor }).from(runs).where(eq(runs.id, runId)).limit(1);
    const finished = current !== undefined && current.status !== "running";
    return { outcome: finished ? "finished" : "busy", step: (current?.step as RunStep | undefined) ?? "done", cursor: current?.cursor ?? 0, status: current?.status ?? "unknown" };
  }

  const progress = new Progress(db, run.id, run.counts);
  const step = run.step as RunStep;
  try {
    if (step === "prepare") await prepare(db, run, progress, options);
    else if (step === "explain") await explain(db, run, progress, options);
    else if (step === "headline") await headline(db, run, progress, options);
    else if (step === "finalize") {
      const status = await finalize(db, run, progress, options);
      return { outcome: "finished", step: "done", cursor: 0, status };
    }
    const [after] = await db.update(runs).set({ leaseUntil: null }).where(eq(runs.id, run.id)).returning({ step: runs.step, cursor: runs.cursor });
    return { outcome: "progress", step: (after?.step as RunStep | undefined) ?? step, cursor: after?.cursor ?? 0, status: "running" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    const attempts = run.attempts + 1;
    log("error", "run step failed", { runId: run.id, step, attempts, error: message });
    if (attempts >= MAX_STEP_ATTEMPTS) {
      await progress.note(`Run failed in step "${step}" after ${attempts} attempts: ${message}`).catch(() => undefined);
      await db.update(runs).set({ status: "failed", finishedAt: new Date(), leaseUntil: null, attempts, updatedAt: new Date() }).where(eq(runs.id, run.id)).catch(() => undefined);
      await notifyRunProblem({ runId: run.id, asOf: run.asOfDate, status: "failed", reasons: [`Step ${step}: ${message}`] });
      return { outcome: "failed", step, cursor: run.cursor, status: "failed" };
    }
    await db.update(runs).set({ attempts, leaseUntil: null, updatedAt: new Date() }).where(eq(runs.id, run.id)).catch(() => undefined);
    return { outcome: "retry", step, cursor: run.cursor, status: "running" };
  }
}

/** Run every remaining step in this process: for the CLI, tests, and anywhere a long invocation is fine. */
export async function runToCompletion(db: Db, runId: string, options: AdvanceOptions = {}): Promise<{ status: string; invocations: number }> {
  let invocations = 0;
  for (let guard = 0; guard < 2000; guard += 1) {
    const r = await advanceRun(db, runId, options);
    invocations += 1;
    if (r.outcome === "finished" || r.outcome === "failed") return { status: r.status, invocations };
    if (r.outcome === "busy") return { status: r.status, invocations };
  }
  throw new Error("Run did not finish within the step limit");
}

/** Running runs that nobody is working on: no lease and no progress for a while. The safety net resumes these. */
export async function findStuckRuns(db: Db, now: Date = new Date(), idleMs = 90_000): Promise<string[]> {
  const rows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.status, "running"), or(isNull(runs.leaseUntil), lt(runs.leaseUntil, now)), lt(runs.updatedAt, new Date(now.getTime() - idleMs))));
  return rows.map((r) => r.id);
}
