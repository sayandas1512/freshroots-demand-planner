import { count, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { baselineWeekly, goLiveItems, outcomesWeekly, users } from "@/db/schema";
import { GO_LIVE_ITEMS, WEEKS_NEEDED_FOR_BASELINE } from "./items";

export interface ItemStatus {
  key: string;
  label: string;
  help: string;
  roles: readonly string[];
  ticked: boolean;
  tickedByName: string | null;
  tickedAt: string | null;
  note: string | null;
}

export interface Readiness {
  items: ItemStatus[];
  weeklyOutcomeWeeks: number;
  baselineFrozen: boolean;
  missing: string[];
  ready: boolean;
}

export async function goLiveReadiness(db: Db): Promise<Readiness> {
  const ticks = await db
    .select({ key: goLiveItems.itemKey, at: goLiveItems.tickedAt, note: goLiveItems.note, name: users.name })
    .from(goLiveItems)
    .leftJoin(users, eq(users.id, goLiveItems.tickedBy));
  const byKey = new Map(ticks.map((t) => [t.key, t]));
  const items: ItemStatus[] = GO_LIVE_ITEMS.map((i) => {
    const t = byKey.get(i.key);
    return { key: i.key, label: i.label, help: i.help, roles: i.roles, ticked: Boolean(t), tickedByName: t?.name ?? null, tickedAt: t?.at.toISOString() ?? null, note: t?.note ?? null };
  });
  const [w] = await db.select({ n: count() }).from(outcomesWeekly);
  const [b] = await db.select({ n: count() }).from(baselineWeekly);
  const weeklyOutcomeWeeks = Number(w?.n ?? 0);
  const baselineFrozen = Number(b?.n ?? 0) > 0;
  const missing = items.filter((i) => !i.ticked).map((i) => i.label);
  if (!baselineFrozen && weeklyOutcomeWeeks < WEEKS_NEEDED_FOR_BASELINE) missing.push(`At least ${WEEKS_NEEDED_FOR_BASELINE} weeks of weekly outcomes (${weeklyOutcomeWeeks} entered)`);
  return { items, weeklyOutcomeWeeks, baselineFrozen, missing, ready: missing.length === 0 };
}

export async function tickItem(db: Db, input: { key: string; userId: string; note: string | null }): Promise<void> {
  await db
    .insert(goLiveItems)
    .values({ itemKey: input.key, tickedBy: input.userId, note: input.note })
    .onConflictDoUpdate({ target: goLiveItems.itemKey, set: { tickedBy: input.userId, note: input.note, tickedAt: new Date() } });
}

export async function untickItem(db: Db, key: string): Promise<void> {
  await db.delete(goLiveItems).where(eq(goLiveItems.itemKey, key));
}
