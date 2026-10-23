import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, can, type Permission } from "@/auth/roles";
import { LOGIN_TOKEN_TTL_MS, consumeLoginToken, devLinksAllowed, issueLoginToken, loginUrl } from "@/auth/magic";
import { seedUsers } from "@/auth/users";
import type { Db } from "@/db/client";
import { loginTokens, users } from "@/db/schema";
import { createTestDb } from "./db";

describe("role permissions", () => {
  const matrix: Record<Permission, string[]> = {
    view: ["planner", "sponsor", "data", "admin"],
    decide: ["planner", "admin"],
    run: ["planner", "data", "sponsor", "admin"],
    upload: ["data", "admin"],
    editRules: ["planner", "admin"],
    setMode: ["sponsor", "admin"],
    editKill: ["sponsor", "admin"],
    clearKill: ["sponsor", "admin"],
    stop: ["planner", "sponsor", "data", "admin"],
    outcomes: ["data", "sponsor", "admin"],
    goLive: ["planner", "sponsor", "data", "admin"],
    export: ["planner", "admin"],
    backtest: ["planner", "sponsor", "admin"],
    manageUsers: ["admin"],
  };
  it("matches the agreed matrix for every role and permission", () => {
    for (const permission of Object.keys(PERMISSIONS) as Permission[]) {
      for (const role of ROLES) expect(can(role, permission), `${role} ${permission}`).toBe(matrix[permission].includes(role));
    }
  });
  it("a manual stop is open to everyone signed in, and clearing a kill is not", () => {
    for (const role of ROLES) expect(can(role, "stop")).toBe(true);
    expect(can("planner", "clearKill")).toBe(false);
    expect(can("data", "clearKill")).toBe(false);
    expect(can(null, "view")).toBe(false);
  });
});

describe("seedUsers", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => close());

  it("creates users with no password, updates on re-run, and rejects bad input", async () => {
    const list = JSON.stringify([{ email: "Raghav@Freshroots.test", name: "Raghav", role: "planner" }]);
    expect(await seedUsers(db, list)).toEqual({ created: 1, updated: 0 });
    expect(await seedUsers(db, list)).toEqual({ created: 0, updated: 1 });
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("raghav@freshroots.test");
    await expect(seedUsers(db, JSON.stringify([{ email: "not-an-email", name: "A", role: "planner" }]))).rejects.toThrow();
    await expect(seedUsers(db, JSON.stringify([{ email: "a@b.test", name: "A", role: "ceo" }]))).rejects.toThrow();
    expect(Object.keys(rows[0] as object)).not.toContain("passwordHash");
  });
});

describe("passwordless sign-in links", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await seedUsers(db, JSON.stringify([{ email: "raghav@x.test", name: "Raghav", role: "planner" }]));
  });
  afterEach(async () => close());

  const t0 = new Date("2026-10-20T04:00:00Z");

  it("issues a one-time token for a registered email only, and stores just its hash", async () => {
    const issued = await issueLoginToken(db, " Raghav@X.test ", t0);
    expect(issued?.user.name).toBe("Raghav");
    expect(issued!.token.length).toBeGreaterThanOrEqual(40);
    const rows = await db.select().from(loginTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toContain(issued!.token);
    expect(rows[0]?.expiresAt.getTime()).toBe(t0.getTime() + LOGIN_TOKEN_TTL_MS);
    expect(await issueLoginToken(db, "nobody@x.test", t0)).toBeNull();
  });

  it("signs the person in once, and a second use or a guess fails", async () => {
    const { token } = (await issueLoginToken(db, "raghav@x.test", t0))!;
    expect(await consumeLoginToken(db, token, new Date(t0.getTime() + 60_000))).toMatchObject({ name: "Raghav", role: "planner" });
    expect(await consumeLoginToken(db, token, new Date(t0.getTime() + 61_000))).toBeNull();
    expect(await consumeLoginToken(db, "A".repeat(43), t0)).toBeNull();
    expect(await consumeLoginToken(db, "short", t0)).toBeNull();
    expect(await consumeLoginToken(db, "bad token with spaces and symbols !!!!!!", t0)).toBeNull();
  });

  it("expires after 15 minutes, exactly", async () => {
    const a = (await issueLoginToken(db, "raghav@x.test", t0))!.token;
    expect(await consumeLoginToken(db, a, new Date(t0.getTime() + LOGIN_TOKEN_TTL_MS + 1))).toBeNull();
    const b = (await issueLoginToken(db, "raghav@x.test", t0))!.token;
    expect(await consumeLoginToken(db, b, new Date(t0.getTime() + LOGIN_TOKEN_TTL_MS - 1))).not.toBeNull();
  });

  it("a deactivated user can neither get a link nor use one already sent", async () => {
    const { token } = (await issueLoginToken(db, "raghav@x.test", t0))!;
    await db.update(users).set({ active: false });
    expect(await consumeLoginToken(db, token, t0)).toBeNull();
    expect(await issueLoginToken(db, "raghav@x.test", t0)).toBeNull();
  });

  it("two requests racing for the same token sign in only once", async () => {
    const { token } = (await issueLoginToken(db, "raghav@x.test", t0))!;
    const results = await Promise.all([consumeLoginToken(db, token, t0), consumeLoginToken(db, token, t0)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("builds the link from the app address, and shows links on screen only outside Vercel production", () => {
    expect(loginUrl("https://planner.example.com/", "abc_DEF-123")).toBe("https://planner.example.com/login/verify?token=abc_DEF-123");
    const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
    expect(devLinksAllowed(env({ NODE_ENV: "development" }))).toBe(true);
    expect(devLinksAllowed(env({ NODE_ENV: "production" }))).toBe(false);
    expect(devLinksAllowed(env({ NODE_ENV: "production", AUTH_DEV_LINKS: "1" }))).toBe(true);
    expect(devLinksAllowed(env({ NODE_ENV: "production", AUTH_DEV_LINKS: "1", VERCEL_ENV: "production" }))).toBe(false);
    expect(devLinksAllowed(env({ NODE_ENV: "development", VERCEL_ENV: "production" }))).toBe(false);
  });
});
