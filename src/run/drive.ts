import type { Db } from "@/db/client";
import { log } from "@/lib/log";
import { advanceRun, type AdvanceOptions } from "./machine";

/** Ask the app to do the next piece of a run, in a fresh invocation. Returns quickly: the route answers 202 and works after responding. */
export async function dispatchAdvance(origin: string, runId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log("error", "cannot chain run: CRON_SECRET is not set", { runId });
    return false;
  }
  try {
    const res = await fetchImpl(`${origin}/api/run/${runId}/advance`, { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000) });
    return res.status === 202 || res.ok;
  } catch (err) {
    log("warn", "could not dispatch the next run step; the resume cron will pick it up", { runId, error: err instanceof Error ? err.message : "unknown" });
    return false;
  }
}

/** One piece of work, then hand over to the next invocation. A failed hand-over is covered by the resume cron. */
export async function driveRun(db: Db, origin: string, runId: string, options: AdvanceOptions = {}, fetchImpl: typeof fetch = fetch): Promise<void> {
  const result = await advanceRun(db, runId, options);
  log("info", "run advanced", { runId, outcome: result.outcome, step: result.step, cursor: result.cursor });
  if (result.outcome === "progress" || result.outcome === "retry") await dispatchAdvance(origin, runId, fetchImpl);
}
