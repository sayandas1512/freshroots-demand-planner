import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { log } from "@/lib/log";

/**
 * Open access: with OPEN_ACCESS=1, anyone with the link acts as a guest administrator without signing in. This exists
 * for demonstrations and marking, where a reviewer must be able to approve, run, export and use the kill switch.
 * Every action is recorded against the "Guest" user, so the audit trail stays complete. Do not use it with real data.
 */
export const GUEST_EMAIL = "guest@open-access.local";

export function openAccessEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPEN_ACCESS === "1";
}

let cachedId: string | null = null;

/** The Guest user, created on first use. It is an admin, active, and has no password because nothing signs in as it. */
export async function getGuestUser(db: Db): Promise<{ id: string }> {
  if (cachedId) {
    const [still] = await db.select({ id: users.id }).from(users).where(eq(users.id, cachedId)).limit(1);
    if (still) return still;
    cachedId = null;
  }
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, GUEST_EMAIL)).limit(1);
  if (existing) {
    await db.update(users).set({ active: true, role: "admin", name: "Guest" }).where(eq(users.id, existing.id));
    cachedId = existing.id;
    return existing;
  }
  const [created] = await db.insert(users).values({ email: GUEST_EMAIL, name: "Guest", role: "admin" }).onConflictDoNothing().returning({ id: users.id });
  const id = created?.id ?? (await db.select({ id: users.id }).from(users).where(eq(users.email, GUEST_EMAIL)).limit(1))[0]?.id;
  if (!id) throw new Error("Could not create the guest user");
  log("warn", "open access is on: visitors act as a guest administrator", { userId: id });
  cachedId = id;
  return { id };
}

export function resetGuestCache(): void {
  cachedId = null;
}
