import { count, eq } from "drizzle-orm";
import type { Actor } from "@/auth/actor";
import { firstMissingPermission } from "@/auth/config-auth";
import type { Db } from "@/db/client";
import { appState, baselineWeekly, outcomesWeekly } from "@/db/schema";
import { diffConfig, type RuleConfig } from "@/engine/config";
import { isoWeekOf } from "@/engine/weeks";
import { goLiveReadiness } from "@/golive/readiness";
import { WEEKS_NEEDED_FOR_BASELINE } from "@/golive/items";
import { log } from "@/lib/log";
import { createConfigVersion, getActiveConfig } from "./config-store";

export class ForbiddenError extends Error {}
export class GateError extends Error {
  constructor(
    message: string,
    readonly missing: string[],
  ) {
    super(message);
  }
}

/** Copy the 8 weeks before go-live into the frozen baseline. Only the first go-live freezes; later ones keep it. */
export async function freezeBaselineWeekly(db: Db, userId: string | null, today: string): Promise<number> {
  const [existing] = await db.select({ n: count() }).from(baselineWeekly);
  if (Number(existing?.n ?? 0) > 0) return 0;
  const thisWeek = isoWeekOf(today);
  const rows = (await db.select().from(outcomesWeekly))
    .filter((w) => w.week < thisWeek)
    .sort((a, b) => b.week.localeCompare(a.week))
    .slice(0, WEEKS_NEEDED_FOR_BASELINE);
  for (const r of rows) {
    await db.insert(baselineWeekly).values({ week: r.week, stockoutIncidents: r.stockoutIncidents, overstockValueInr: r.overstockValueInr, frozenBy: userId });
  }
  return rows.length;
}

/**
 * Save a new config version on behalf of an actor. Enforces who may change what, requires the go-live checklist
 * before the mode becomes live, and on that change records the go-live date and freezes the weekly baseline.
 */
export async function saveConfigChange(db: Db, input: { config: RuleConfig; note: string; actor: Actor; today: string }) {
  const active = await getActiveConfig(db);
  const changed = diffConfig(active.config, input.config).map((c) => c.key);
  const missing = firstMissingPermission(input.actor.role, changed);
  if (missing) throw new ForbiddenError(`Your role (${input.actor.role}) cannot change these settings.`);

  const toLive = active.config.mode === "shadow" && input.config.mode === "live";
  if (toLive) {
    const readiness = await goLiveReadiness(db);
    if (!readiness.ready) throw new GateError("The go-live checklist is not complete.", readiness.missing);
  }

  const saved = await createConfigVersion(db, input.config, input.note, input.actor.userId);
  if (toLive) {
    await freezeBaselineWeekly(db, input.actor.userId, input.today);
    await db.insert(appState).values({ key: "live_since", value: { date: input.today, version: saved.version } }).onConflictDoUpdate({ target: appState.key, set: { value: { date: input.today, version: saved.version }, updatedAt: new Date() } });
    log("warn", "mode changed to live", { version: saved.version, by: input.actor.userId });
  } else if (active.config.mode === "live" && input.config.mode === "shadow") {
    await db.delete(appState).where(eq(appState.key, "live_since"));
    log("warn", "mode changed to shadow", { version: saved.version, by: input.actor.userId });
  }
  return saved;
}

