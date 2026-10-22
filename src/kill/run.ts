import type { Db } from "@/db/client";
import { killChecks } from "@/db/schema";
import { log } from "@/lib/log";
import { executeKillCheck, type KillResult } from "./check";
import { gatherKillInput } from "./gather";
import { tripKill } from "./state";

/** Evaluate without recording anything. The Health page uses this to show every criterion. */
export async function previewKill(db: Db): Promise<KillResult> {
  return executeKillCheck(await gatherKillInput(db));
}

/** Evaluate, record the check, and trip the switch if a kill criterion is met. Runs after each run and monthly. */
export async function runKillCheck(db: Db, opts: { trigger: "run" | "monthly" | "manual"; runId?: string }): Promise<KillResult & { trippedNow: boolean }> {
  const result = executeKillCheck(await gatherKillInput(db));
  await db.insert(killChecks).values({
    trigger: opts.trigger,
    runId: opts.runId ?? null,
    latestWeek: result.latestWeek,
    levels: result.levels,
    result: { kill: result.kill.map((c) => c.id), warnings: result.warnings.map((c) => c.id), criteria: result.criteria },
  });
  let trippedNow = false;
  if (result.tripped) {
    const detail = result.kill.map((c) => `${c.label}: ${c.value ?? "n/a"} (limit ${c.threshold})`).join("; ");
    trippedNow = await tripKill(db, { kind: "trip_auto", reason: detail, detail: { criteria: result.kill }, label: "system: kill check" });
  }
  log("info", "kill check", { trigger: opts.trigger, runId: opts.runId, tripped: result.tripped, warnings: result.warnings.map((c) => c.id) });
  return { ...result, trippedNow };
}
