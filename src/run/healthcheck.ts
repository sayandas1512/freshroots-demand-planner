import { desc, ne, sql } from "drizzle-orm";
import { configuredProvider, createProvider } from "@/ai";
import type { Db } from "@/db/client";
import { runs } from "@/db/schema";
import { daysBetween } from "@/engine/weeks";
import { dataFreshness } from "@/ingest/ingest";
import { getKillState } from "@/kill/state";
import { todayIst } from "@/lib/dates";
import { getActiveConfig } from "./config-store";

export type Overall = "ok" | "degraded" | "stopped" | "down";

export interface SystemHealth {
  overall: Overall;
  checkedAt: string;
  db: { ok: boolean; ms: number | null };
  lastRun: { id: string; status: string; asOf: string; at: string } | null;
  files: { latestSalesWeek: string | null; latestInventoryDate: string | null; inventoryAgeDays: number | null; inventoryStale: boolean };
  kill: { active: boolean; reason: string | null };
  mode: "shadow" | "live";
  llm: { provider: string | null; model: string | null; reachable: boolean | null; error?: string };
}

/**
 * One call that answers "is it working?": database reachable, last run, file freshness, kill state and (on request)
 * whether the LLM provider answers. The LLM ping costs a few tokens, so it only runs when asked.
 */
export async function systemHealth(db: Db, opts: { pingLlm: boolean; now?: Date } = { pingLlm: false }): Promise<SystemHealth> {
  const now = opts.now ?? new Date();
  const t0 = Date.now();
  let dbOk = true;
  try {
    await db.execute(sql`select 1`);
  } catch {
    dbOk = false;
  }
  const ms = dbOk ? Date.now() - t0 : null;
  const llmKind = configuredProvider();
  if (!dbOk) {
    return { overall: "down", checkedAt: now.toISOString(), db: { ok: false, ms: null }, lastRun: null, files: { latestSalesWeek: null, latestInventoryDate: null, inventoryAgeDays: null, inventoryStale: true }, kill: { active: false, reason: null }, mode: "shadow", llm: { provider: llmKind, model: null, reachable: null } };
  }

  const [lastRow] = await db.select().from(runs).where(ne(runs.trigger, "backtest")).orderBy(desc(runs.startedAt)).limit(1);
  const fresh = await dataFreshness(db);
  const kill = await getKillState(db);
  const { config } = await getActiveConfig(db);
  const today = todayIst(now);
  const age = fresh.latestInventoryDate ? daysBetween(fresh.latestInventoryDate, today) : null;
  const stale = age === null || age > config.stale_inventory_days;

  const provider = createProvider();
  const llm: SystemHealth["llm"] = { provider: llmKind, model: provider?.model ?? null, reachable: null };
  if (opts.pingLlm && provider?.ping) {
    try {
      await provider.ping(AbortSignal.timeout(10_000));
      llm.reachable = true;
    } catch (err) {
      llm.reachable = false;
      llm.error = err instanceof Error ? err.message.slice(0, 160) : "unreachable";
    }
  }

  const lastBad = lastRow !== undefined && (lastRow.status === "failed" || lastRow.status === "completed_degraded");
  const overall: Overall = kill.active ? "stopped" : stale || lastBad || llm.reachable === false ? "degraded" : "ok";
  return {
    overall,
    checkedAt: now.toISOString(),
    db: { ok: true, ms },
    lastRun: lastRow ? { id: lastRow.id, status: lastRow.status, asOf: lastRow.asOfDate, at: lastRow.startedAt.toISOString() } : null,
    files: { latestSalesWeek: fresh.latestSalesWeek, latestInventoryDate: fresh.latestInventoryDate, inventoryAgeDays: age, inventoryStale: stale },
    kill: { active: kill.active, reason: kill.reason },
    mode: config.mode,
    llm,
  };
}
