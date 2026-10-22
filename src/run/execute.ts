import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import type { LlmProvider } from "@/ai/types";
import type { Db } from "@/db/client";
import { killState, runs } from "@/db/schema";
import { parseDate } from "@/engine/weeks";
import { runToCompletion, type AdvanceOptions } from "./machine";

export type RunTrigger = "cron" | "manual";

const IDEMPOTENCY_WINDOW_MS = 10 * 60_000;
/** A run that has made no progress for this long (and is not leased) is given up on. */
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
      .where(and(eq(runs.status, "running"), ne(runs.trigger, "backtest"), sql`${runs.updatedAt} < ${new Date(now.getTime() - STALE_RUNNING_MS)}`));

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
      .values({ trigger: input.trigger, asOfDate: input.asOf, startedAt: now, updatedAt: now, counts: { steps: {} }, startedBy: input.startedBy ?? null })
      .returning({ id: runs.id });
    if (!row) throw new Error("Could not create run");
    return { runId: row.id, created: true, reason: "created" as const };
  });
}

export interface ExecuteOptions {
  /** Defaults to the configured LLM provider, or none (templates only). */
  provider?: LlmProvider | null;
  callTimeoutMs?: number;
  crashHook?: AdvanceOptions["crashHook"];
}

/** Run every step of an existing run in this process. Never throws: a fatal problem marks the run failed. */
export async function executeRun(db: Db, runId: string, options: ExecuteOptions = {}): Promise<{ status: string }> {
  const { status } = await runToCompletion(db, runId, options);
  return { status };
}

/** Convenience for the CLI and tests: start (idempotently) and execute to completion. */
export async function startAndExecute(db: Db, input: { trigger: RunTrigger; asOf: string; now?: Date }, options: ExecuteOptions = {}): Promise<StartedRun & { status: string }> {
  const started = await startRun(db, input);
  if (!started.created) {
    const [row] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, started.runId)).limit(1);
    return { ...started, status: row?.status ?? "unknown" };
  }
  const { status } = await executeRun(db, started.runId, options);
  return { ...started, status };
}

export { STEP_ORDER, type StepName } from "./machine";
