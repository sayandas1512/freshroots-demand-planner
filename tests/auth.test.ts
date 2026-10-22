import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/auth/password";
import { PERMISSIONS, ROLES, can, type Permission } from "@/auth/roles";
import { seedUsers } from "@/auth/users";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { createTestDb } from "./db";

describe("password hashing", () => {
  it("verifies the right password only, with a different salt every time", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

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

  it("creates users with hashed passwords, updates on re-run, and rejects weak or unknown input", async () => {
    const list = JSON.stringify([{ email: "Raghav@Freshroots.test", name: "Raghav", role: "planner", password: "long-enough-pw" }]);
    expect(await seedUsers(db, list)).toEqual({ created: 1, updated: 0 });
    expect(await seedUsers(db, list)).toEqual({ created: 0, updated: 1 });
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("raghav@freshroots.test");
    expect(rows[0]?.passwordHash).not.toContain("long-enough-pw");
    expect(await verifyPassword("long-enough-pw", rows[0]!.passwordHash)).toBe(true);
    await expect(seedUsers(db, JSON.stringify([{ email: "a@b.test", name: "A", role: "planner", password: "short" }]))).rejects.toThrow();
    await expect(seedUsers(db, JSON.stringify([{ email: "a@b.test", name: "A", role: "ceo", password: "long-enough-pw" }]))).rejects.toThrow();
  });
});
