import { desc } from "drizzle-orm";
import type { Db } from "@/db/client";
import { killState } from "@/db/schema";
import { sendAlertEmail } from "@/lib/email";
import { log } from "@/lib/log";

export interface KillStatus {
  active: boolean;
  reason: string | null;
  since: string | null;
  by: string | null;
  kind: string | null;
}

export async function getKillState(db: Db): Promise<KillStatus> {
  const [row] = await db.select().from(killState).orderBy(desc(killState.at)).limit(1);
  if (!row || !row.active) return { active: false, reason: null, since: null, by: null, kind: row?.kind ?? null };
  return { active: true, reason: row.reason, since: row.at.toISOString(), by: row.setByLabel, kind: row.kind };
}

/** Trip the switch. Does nothing if it is already on, so a repeated check never piles up rows or emails. */
export async function tripKill(
  db: Db,
  input: { kind: "trip_auto" | "trip_manual"; reason: string; detail?: Record<string, unknown>; setBy?: string | null; label: string },
): Promise<boolean> {
  if ((await getKillState(db)).active) return false;
  await db.insert(killState).values({ active: true, kind: input.kind, reason: input.reason, detail: input.detail ?? {}, setBy: input.setBy ?? null, setByLabel: input.label });
  log("warn", "kill switch tripped", { kind: input.kind, reason: input.reason, by: input.label });
  await sendAlertEmail({
    subject: "Freshroots planner: kill switch is ON",
    text: `The kill switch was tripped (${input.kind === "trip_auto" ? "automatic check" : "manual stop"}).\n\nReason: ${input.reason}\nBy: ${input.label}\n\nCron runs and the purchase-order export are stopped until the sponsor or an admin clears it on the Health page with a note.`,
  });
  return true;
}

export class KillNotActiveError extends Error {}

/** Clearing needs a note and is logged with who did it. The caller enforces the sponsor or admin role. */
export async function clearKill(db: Db, input: { setBy: string | null; label: string; note: string }): Promise<void> {
  if (!(await getKillState(db)).active) throw new KillNotActiveError("The kill switch is not on.");
  await db.insert(killState).values({ active: false, kind: "clear", reason: "Cleared", setBy: input.setBy, setByLabel: input.label, note: input.note });
  log("warn", "kill switch cleared", { by: input.label });
}
