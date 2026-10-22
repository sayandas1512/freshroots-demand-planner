import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { explainFactsFor, headlineFactsFor } from "@/ai/facts";
import { generateNarrative } from "@/ai/generate";
import { createProvider } from "@/ai";
import { costUsd } from "@/ai/status";
import { templateReason } from "@/ai/templates";
import type { LlmProvider } from "@/ai/types";
import { getEnv } from "@/config/env";
import type { Db } from "@/db/client";
import { exceptions as exceptionsTable, killState, recommendations, runHeadlines, runs, type RunCounts } from "@/db/schema";
import { evaluateAll } from "@/engine/evaluate";
import type { EvaluationResult } from "@/engine/types";
import { daysBetween, parseDate } from "@/engine/weeks";
import { runKillCheck } from "@/kill/run";
import { log } from "@/lib/log";
import { notifyRunProblem } from "./alerts";
import { getActiveConfig } from "./config-store";
import { loadEngineData } from "./load";

export type RunTrigger = "cron" | "manual";
export type StepName = "ingest_check" | "rules" | "exceptions" | "llm_explain" | "llm_headline" | "sheet_saved" | "done";
export const STEP_ORDER: StepName[] = ["ingest_check", "rules", "exceptions", "llm_explain", "llm_headline", "sheet_saved", "done"];
type StepStatus = NonNullable<RunCounts["steps"]>[string]["status"];

const IDEMPOTENCY_WINDOW_MS = 10 * 60_000;
const STALE_RUNNING_MS = 30 * 60_000;
const RUN_LOCK_KEY = 7_155_001;

export interface StartedRun {
  runId: string;
  created: boolean;
  reason: "created" | "existing" | "in_progress" | "killed";
}

/**
 * Create the run row under an advisory lock, or return the existing one.
 * - Same as_of_date and trigger within 10 minutes: return that run (idempotency).
 * - Another run is still going: return it, so two runs never overlap.
 */
export async function startRun(db: Db, input: { trigger: RunTrigger; asOf: string; now?: Date; startedBy?: string | null }): Promise<StartedRun> {
  parseDate(input.asOf);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${RUN_LOCK_KEY})`);

    const [kill] = await tx.select({ active: killState.active }).from(killState).orderBy(desc(killState.at)).limit(1);
    if (kill?.active) {
      const [skipped] = await tx
        .insert(runs)
        .values({ trigger: input.trigger, asOfDate: input.asOf, startedAt: now, finishedAt: now, status: "skipped_killed", counts: { notes: ["Skipped: the kill switch is on."] }, startedBy: input.startedBy ?? null })
        .returning({ id: runs.id });
      return { runId: skipped?.id ?? "", created: false, reason: "killed" as const };
    }

    await tx
      .update(runs)
      .set({ status: "failed", finishedAt: now, counts: sql`${runs.counts} || ${JSON.stringify({ notes: ["Marked failed: the run never finished."] })}::jsonb` })
      .where(and(eq(runs.status, "running"), ne(runs.trigger, "backtest"), sql`${runs.startedAt} < ${new Date(now.getTime() - STALE_RUNNING_MS)}`));

    const [recent] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.asOfDate, input.asOf),
          eq(runs.trigger, input.trigger),
          ne(runs.status, "failed"),
          ne(runs.status, "skipped_killed"),
          gt(runs.startedAt, new Date(now.getTime() - IDEMPOTENCY_WINDOW_MS)),
        ),
      )
      .orderBy(desc(runs.startedAt))
      .limit(1);
    if (recent) return { runId: recent.id, created: false, reason: "existing" as const };

    const [active] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.status, "running"), ne(runs.trigger, "backtest")))
      .limit(1);
    if (active) return { runId: active.id, created: false, reason: "in_progress" as const };

    const [row] = await tx
      .insert(runs)
      .values({ trigger: input.trigger, asOfDate: input.asOf, startedAt: now, counts: { steps: {} }, startedBy: input.startedBy ?? null })
      .returning({ id: runs.id });
    if (!row) throw new Error("Could not create run");
    return { runId: row.id, created: true, reason: "created" as const };
  });
}

class Progress {
  private counts: RunCounts = { steps: {}, notes: [] };

  constructor(
    private readonly db: Db,
    private readonly runId: string,
  ) {}

  async step(name: StepName, status: StepStatus, detail?: string): Promise<void> {
    const steps = this.counts.steps ?? {};
    steps[name] = { status, at: new Date().toISOString(), ...(detail ? { detail } : {}) };
    this.counts.steps = steps;
    await this.flush();
  }

  async note(text: string): Promise<void> {
    this.counts.notes = [...(this.counts.notes ?? []), text];
    await this.flush();
  }

  merge(extra: Partial<RunCounts>): void {
    this.counts = { ...this.counts, ...extra };
  }

  snapshot(): RunCounts {
    return this.counts;
  }

  async flush(): Promise<void> {
    await this.db.update(runs).set({ counts: this.counts }).where(eq(runs.id, this.runId));
  }
}

function tallyResult(result: EvaluationResult): Pick<RunCounts, "lines" | "exceptions" | "byAction" | "byFlag" | "byRule"> {
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

export interface ExecuteOptions {
  /** Defaults to the Anthropic provider when ANTHROPIC_API_KEY is set, otherwise template-only. */
  provider?: LlmProvider | null;
  callTimeoutMs?: number;
}

/**
 * Run the pipeline for an existing run row. Never throws: a fatal problem marks the run failed.
 * Steps: config + freshness + data, rules, exceptions + draft sheet (one transaction), LLM reasons,
 * LLM headline, then finalise. A failed LLM step or a bad SKU degrades the run instead of stopping it.
 */
export async function executeRun(db: Db, runId: string, options: ExecuteOptions = {}): Promise<{ status: string }> {
  const progress = new Progress(db, runId);
  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (!run) throw new Error(`Run ${runId} not found`);
    const asOf = run.asOfDate;

    // 1. ingest_check: config, data freshness, joined data
    await progress.step("ingest_check", "running");
    const { version, config } = await getActiveConfig(db);
    const loaded = await loadEngineData(db, asOf, { includeOpenPos: true, includeDistributors: config.enable_distributor_exceptions });
    const inventoryAge = loaded.latestInventoryDate === null ? null : daysBetween(loaded.latestInventoryDate, asOf);
    const stale = inventoryAge === null || inventoryAge > config.stale_inventory_days;
    await db.update(runs).set({ configVersion: version }).where(eq(runs.id, runId));
    if (stale) {
      await progress.note(
        inventoryAge === null
          ? "No inventory snapshot exists on or before the run date."
          : `Stock data is ${inventoryAge} days old (limit ${config.stale_inventory_days}). Treat cover figures with care.`,
      );
    }
    progress.merge({ inventoryAgeDays: inventoryAge, festivalMode: config.festival_uplift_mode });
    await progress.step("ingest_check", stale ? "degraded" : "done", loaded.latestInventoryDate ? `Stock as of ${loaded.latestInventoryDate}` : "No stock data");

    // 2. rules
    await progress.step("rules", "running");
    const result = evaluateAll(loaded.data, config);
    await progress.step("rules", "done", `${result.lines.length} lines`);

    // 3. exceptions + draft sheet, saved in one transaction before anything is shown
    await progress.step("exceptions", "running");
    const skuMap = new Map(loaded.data.skus.map((s) => [s.skuId, s]));
    const factsByLine = new Map(result.lines.map((l) => [l.skuId, explainFactsFor(l, skuMap.get(l.skuId)!)]));
    await db.transaction(async (tx) => {
      for (let i = 0; i < result.lines.length; i += 200) {
        await tx.insert(recommendations).values(
          result.lines.slice(i, i + 200).map((l) => ({
            runId,
            skuId: l.skuId,
            action: l.action,
            flags: l.flags,
            ruleFired: l.ruleFired,
            qty: l.qty,
            metrics: l.metrics,
            explanation: templateReason(factsByLine.get(l.skuId)!),
            explanationSource: "template" as const,
          })),
        );
      }
      for (let i = 0; i < result.exceptions.length; i += 200) {
        await tx.insert(exceptionsTable).values(result.exceptions.slice(i, i + 200).map((e) => ({ runId, skuId: e.skuId, type: e.type, detail: e.detail })));
      }
    });
    progress.merge(tallyResult(result));
    await progress.step("exceptions", "done", `${result.exceptions.length} routed to Raghav`);

    // 4 and 5. LLM reasons and headline (template fallback is built in)
    const provider = options.provider === undefined ? createProvider() : options.provider;
    const flagged = result.lines.filter((l) => l.flags.length > 0).map((l) => factsByLine.get(l.skuId)!);
    const headlineFacts = headlineFactsFor(asOf, result.lines, result.exceptions, skuMap, stale);
    await progress.step("llm_explain", "running");
    const narrative = await generateNarrative(provider, flagged, headlineFacts, {
      callTimeoutMs: options.callTimeoutMs,
      onPhase: async (phase, degraded) => {
        const fallback: StepStatus = provider ? "degraded" : "skipped";
        await progress.step(phase, degraded ? fallback : "done");
        if (phase === "llm_explain") await progress.step("llm_headline", "running");
      },
    });

    // 6. finalise: explanations, headline, run row
    const llmExplanations = narrative.explanations.filter((e) => e.source === "llm");
    try {
      await db.transaction(async (tx) => {
        for (const e of llmExplanations) {
          await tx
            .update(recommendations)
            .set({ explanation: e.text, explanationSource: "llm" })
            .where(and(eq(recommendations.runId, runId), eq(recommendations.skuId, e.skuId)));
        }
        await tx.insert(runHeadlines).values({ runId, text: narrative.headline.lines.join("\n"), source: narrative.headline.source }).onConflictDoNothing();
      });
    } catch (err) {
      await progress.note(`Could not save LLM wording: ${err instanceof Error ? err.message : "unknown error"}. Template wording is shown.`);
    }

    const env = getEnv();
    const cost = provider ? costUsd(narrative.usage, { inPerMTok: env.LLM_PRICE_IN_PER_MTOK, outPerMTok: env.LLM_PRICE_OUT_PER_MTOK }) : null;
    const degraded = stale || narrative.llmStatus === "partial" || narrative.llmStatus === "failed";
    await progress.step("sheet_saved", "done", `${result.lines.length} lines saved`);
    progress.merge({ llmTokens: narrative.usage, llmModel: provider?.model ?? null });
    const status = degraded ? "completed_degraded" : "completed";
    await progress.step("done", degraded ? "degraded" : "done");
    await db
      .update(runs)
      .set({
        status,
        finishedAt: new Date(),
        counts: progress.snapshot(),
        llmStatus: narrative.llmStatus,
        llmCalls: narrative.calls,
        llmCostUsd: cost === null ? null : cost.toFixed(6),
      })
      .where(eq(runs.id, runId));
    try {
      await runKillCheck(db, { trigger: "run", runId });
    } catch (err) {
      log("error", "kill check failed", { runId, error: err instanceof Error ? err.message : "unknown" });
    }
    if (degraded) {
      const reasons = [...(progress.snapshot().notes ?? []), ...(narrative.llmStatus === "partial" || narrative.llmStatus === "failed" ? [`LLM ${narrative.llmStatus}: template wording used`] : [])];
      await notifyRunProblem({ runId, asOf, status: "completed_degraded", reasons });
    }
    return { status };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await progress.note(`Run failed: ${message}`).catch(() => undefined);
    await db.update(runs).set({ status: "failed", finishedAt: new Date(), counts: progress.snapshot() }).where(eq(runs.id, runId)).catch(() => undefined);
    await notifyRunProblem({ runId, asOf: "unknown", status: "failed", reasons: [message] });
    return { status: "failed" };
  }
}

/** Convenience for the CLI, cron route and tests: start (idempotently) and execute to completion. */
export async function startAndExecute(db: Db, input: { trigger: RunTrigger; asOf: string; now?: Date }, options: ExecuteOptions = {}): Promise<StartedRun & { status: string }> {
  const started = await startRun(db, input);
  if (!started.created) {
    const [row] = await db.select({ status: runs.status }).from(runs).where(inArray(runs.id, [started.runId])).limit(1);
    return { ...started, status: row?.status ?? "unknown" };
  }
  const { status } = await executeRun(db, started.runId, options);
  return { ...started, status };
}
