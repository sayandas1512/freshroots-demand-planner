import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { appState, baselineWeekly, outcomesWeekly } from "@/db/schema";
import { isoWeekOf, parseDate } from "@/engine/weeks";
import { log } from "@/lib/log";

/**
 * Measurement start: the date from which results are judged against the baseline. The weekly baseline is the 8 outcome
 * weeks before it, copied aside so later edits cannot move the goalposts. It is set automatically the first time the
 * system is used and can be restarted by the sponsor or an admin (for example when real data replaces sample data).
 */
export const BASELINE_WEEKS = 8;
const KEY = "live_since";

export async function getMeasurementStart(db: Db): Promise<string | null> {
  const [row] = await db.select().from(appState).where(eq(appState.key, KEY)).limit(1);
  return typeof row?.value.date === "string" ? row.value.date : null;
}

/** The start date, creating it as `today` the first time anyone asks. */
export async function ensureMeasurementStart(db: Db, today: string): Promise<string> {
  const existing = await getMeasurementStart(db);
  if (existing) return existing;
  await db.insert(appState).values({ key: KEY, value: { date: today, auto: true } }).onConflictDoNothing();
  return (await getMeasurementStart(db)) ?? today;
}

/** Set the start date and re-freeze the baseline from the newest 8 weekly outcomes before it. */
export async function startMeasurement(db: Db, input: { startDate: string; userId: string | null }): Promise<{ frozenWeeks: number; startDate: string }> {
  parseDate(input.startDate);
  const floor = isoWeekOf(input.startDate);
  const before = (await db.select().from(outcomesWeekly)).filter((w) => w.week < floor).sort((a, b) => b.week.localeCompare(a.week)).slice(0, BASELINE_WEEKS);
  await db.transaction(async (tx) => {
    await tx.delete(baselineWeekly);
    for (const r of before) await tx.insert(baselineWeekly).values({ week: r.week, stockoutIncidents: r.stockoutIncidents, overstockValueInr: r.overstockValueInr, frozenBy: input.userId });
    await tx.insert(appState).values({ key: KEY, value: { date: input.startDate, by: input.userId } }).onConflictDoUpdate({ target: appState.key, set: { value: { date: input.startDate, by: input.userId }, updatedAt: new Date() } });
  });
  log("warn", "measurement restarted", { startDate: input.startDate, frozenWeeks: before.length, userId: input.userId });
  return { frozenWeeks: before.length, startDate: input.startDate };
}
