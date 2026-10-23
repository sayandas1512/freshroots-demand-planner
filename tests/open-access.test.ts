import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { actorFromHeaders } from "@/auth/actor";
import { GUEST_EMAIL, getGuestUser, openAccessEnabled, resetGuestCache } from "@/auth/guest";
import { can } from "@/auth/roles";
import { createSessionValue } from "@/auth/session";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { createTestDb } from "./db";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  resetGuestCache();
  ({ db, close } = await createTestDb());
});
afterEach(async () => close());

describe("open access (demonstration and marking)", () => {
  it("is off unless OPEN_ACCESS=1", () => {
    expect(openAccessEnabled(env({}))).toBe(false);
    expect(openAccessEnabled(env({ OPEN_ACCESS: "0" }))).toBe(false);
    expect(openAccessEnabled(env({ OPEN_ACCESS: "true" }))).toBe(false);
    expect(openAccessEnabled(env({ OPEN_ACCESS: "1" }))).toBe(true);
  });

  it("with it off, a visitor with no session and no secret is nobody", async () => {
    expect(await actorFromHeaders(null, undefined, { env: env({ SESSION_SECRET: "s".repeat(20) }), db })).toBeNull();
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("with it on, a visitor becomes the guest administrator, who can do everything the grader needs", async () => {
    const a = await actorFromHeaders(null, undefined, { env: env({ OPEN_ACCESS: "1" }), db });
    expect(a).toMatchObject({ role: "admin", system: false, guest: true });
    expect(a?.userId).toBeTruthy();
    for (const perm of ["decide", "run", "upload", "export", "stop", "clearKill", "editSwitches", "editKill", "editRules", "outcomes", "backtest"] as const) expect(can(a?.role, perm), perm).toBe(true);
    const [guest] = await db.select().from(users).where(eq(users.email, GUEST_EMAIL));
    expect(guest).toMatchObject({ name: "Guest", role: "admin", active: true });
  });

  it("creates the guest once, however many visitors come", async () => {
    const d = { env: env({ OPEN_ACCESS: "1" }), db };
    const ids = await Promise.all([actorFromHeaders(null, undefined, d), actorFromHeaders(null, undefined, d), actorFromHeaders(null, undefined, d)]);
    expect(new Set(ids.map((i) => i?.userId)).size).toBe(1);
    resetGuestCache();
    expect((await getGuestUser(db)).id).toBe(ids[0]?.userId);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("a signed-in person still acts as themselves, and the cron secret is still the system, never a guest", async () => {
    const secret = "session-secret-0123456789";
    const [raghav] = await db.insert(users).values({ email: "raghav@x.test", name: "Raghav", role: "planner" }).returning();
    const cookie = await createSessionValue(secret, { userId: raghav!.id, role: "planner" });
    const e = env({ OPEN_ACCESS: "1", SESSION_SECRET: secret, CRON_SECRET: "cron-secret-0123456789" });
    expect(await actorFromHeaders(null, cookie, { env: e, db })).toEqual({ userId: raghav!.id, role: "planner", system: false });
    expect(await actorFromHeaders("Bearer cron-secret-0123456789", undefined, { env: e, db })).toMatchObject({ system: true, userId: null });
    // a bad or expired cookie falls back to guest rather than to someone else
    expect(await actorFromHeaders(null, "forged.cookie.value.here", { env: e, db })).toMatchObject({ guest: true });
  });

  it("repairs the guest if someone changed or deactivated it", async () => {
    const d = { env: env({ OPEN_ACCESS: "1" }), db };
    await actorFromHeaders(null, undefined, d);
    await db.update(users).set({ role: "data", active: false }).where(eq(users.email, GUEST_EMAIL));
    resetGuestCache();
    expect(await actorFromHeaders(null, undefined, d)).toMatchObject({ role: "admin", guest: true });
    expect((await db.select().from(users).where(eq(users.email, GUEST_EMAIL)))[0]).toMatchObject({ active: true, role: "admin" });
  });
});
