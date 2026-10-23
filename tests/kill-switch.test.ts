import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Actor } from "@/auth/actor";
import { firstMissingPermission, permissionsFor } from "@/auth/config-auth";
import type { Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { appState, baselineWeekly, killChecks, killState, outcomesMonthly, outcomesWeekly, recommendations, runs, users } from "@/db/schema";
import { DEFAULT_RULE_CONFIG, ruleConfigSchema, type RuleConfig } from "@/engine/config";
import { exportBlocked } from "@/kill/guards";
import { runKillCheck } from "@/kill/run";
import { KillNotActiveError, clearKill, getKillState, tripKill } from "@/kill/state";
import { createConfigVersion, getActiveConfig } from "@/run/config-store";
import { ForbiddenError, saveConfigChange } from "@/run/config-save";
import { applyDecision } from "@/run/decisions";
import { startAndExecute, startRun } from "@/run/execute";
import { ensureMeasurementStart, getMeasurementStart, startMeasurement } from "@/run/measurement";
import { createTestDb } from "./db";

let db: Db;
let close: () => Promise<void>;
let sponsorId: string;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await loadFixtures(db);
  const [u] = await db.insert(users).values({ email: "deepa@x.test", name: "Deepa", role: "sponsor" }).returning();
  sponsorId = u!.id;
});
afterEach(async () => close());

const actor = (role: Actor["role"], userId: string | null = sponsorId): Actor => ({ role, userId, system: false });
const cfg = (o: Partial<RuleConfig> = {}): RuleConfig => ({ ...DEFAULT_RULE_CONFIG, ...o });
const week = (n: number) => `2026-W${String(n).padStart(2, "0")}`;

describe("who may change which settings", () => {
  it("maps keys to permissions", () => {
    expect(permissionsFor(["cover_min_weeks"])).toEqual(["editRules"]);
    expect(permissionsFor(["zoho_push_enabled"])).toEqual(["editSwitches"]);
    expect(permissionsFor(["override_kill_rate", "zoho_push_enabled"]).sort()).toEqual(["editKill", "editSwitches"]);
    expect(firstMissingPermission("planner", ["override_kill_rate"])).toBe("editKill");
    expect(firstMissingPermission("planner", ["cover_min_weeks"])).toBeNull();
    expect(firstMissingPermission("sponsor", ["cover_min_weeks"])).toBe("editRules");
    expect(firstMissingPermission("admin", ["zoho_push_enabled", "cover_min_weeks", "override_kill_rate"])).toBeNull();
  });
  it("saveConfigChange enforces them: the planner owns the rules, the sponsor the thresholds and switches", async () => {
    await expect(saveConfigChange(db, { config: cfg({ override_kill_rate: 0.6 }), note: "n", actor: actor("planner") })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveConfigChange(db, { config: cfg({ zoho_push_enabled: true }), note: "n", actor: actor("planner") })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveConfigChange(db, { config: cfg({ cover_min_weeks: 5 }), note: "n", actor: actor("sponsor") })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await saveConfigChange(db, { config: cfg({ cover_min_weeks: 5 }), note: "Raghav tweak", actor: actor("planner") })).version).toBe(2);
    expect((await saveConfigChange(db, { config: cfg({ cover_min_weeks: 5, override_kill_rate: 0.6, zoho_push_enabled: true }), note: "Deepa", actor: actor("sponsor") })).version).toBe(3);
  });
  it("config versions from before v2, or saved with the removed shadow-mode key, still parse", async () => {
    const old: Record<string, unknown> = { ...DEFAULT_RULE_CONFIG, mode: "shadow" };
    for (const k of ["indicator_kill_pct", "expected_regions", "export_id_label", "enable_moq_flag", "zoho_push_enabled"]) delete old[k];
    const parsed = ruleConfigSchema.parse(old);
    expect(parsed).not.toHaveProperty("mode");
    expect(parsed.expected_regions).toEqual(["Maharashtra", "Goa"]);
    expect((await createConfigVersion(db, parsed, "migrated")).version).toBe(2);
    await db.update((await import("@/db/schema")).ruleConfig).set({ config: old });
    expect((await getActiveConfig(db)).config.indicator_kill_pct).toBe(20);
  });
});

describe("measurement start and the frozen weekly baseline", () => {
  const addWeeks = async (from: number, to: number, stockout: number, overstock = 1_000_000) => {
    for (let w = from; w <= to; w += 1) await db.insert(outcomesWeekly).values({ week: week(w), stockoutIncidents: stockout, overstockValueInr: overstock, source: "Priya's report" }).onConflictDoNothing();
  };

  it("is set automatically the first time it is asked for, and not moved afterwards", async () => {
    expect(await getMeasurementStart(db)).toBeNull();
    expect(await ensureMeasurementStart(db, "2026-10-23")).toBe("2026-10-23");
    expect(await ensureMeasurementStart(db, "2027-01-01")).toBe("2026-10-23");
  });

  it("freezes the 8 newest weekly outcomes before the start date, ignores later weeks, and replaces the baseline when restarted", async () => {
    await addWeeks(30, 40, 10);
    await db.insert(outcomesWeekly).values({ week: week(45), stockoutIncidents: 99, overstockValueInr: 9, source: "after" });
    const first = await startMeasurement(db, { startDate: "2026-10-12", userId: sponsorId }); // Monday of W42
    expect(first).toEqual({ frozenWeeks: 8, startDate: "2026-10-12" });
    expect((await db.select().from(baselineWeekly)).map((b) => b.week).sort()).toEqual(["2026-W33", "2026-W34", "2026-W35", "2026-W36", "2026-W37", "2026-W38", "2026-W39", "2026-W40"]);
    expect(await getMeasurementStart(db)).toBe("2026-10-12");
    await db.update(outcomesWeekly).set({ stockoutIncidents: 1 }).where(eq(outcomesWeekly.week, week(35)));
    expect((await db.select().from(baselineWeekly).where(eq(baselineWeekly.week, week(35))))[0]?.stockoutIncidents).toBe(10); // frozen, not edited
    const again = await startMeasurement(db, { startDate: "2026-10-05", userId: null }); // Monday of W41, W40 now counts
    expect(again.frozenWeeks).toBe(8);
    expect((await db.select().from(baselineWeekly).where(eq(baselineWeekly.week, week(35))))[0]?.stockoutIncidents).toBe(1);
    await expect(startMeasurement(db, { startDate: "2026-02-30", userId: null })).rejects.toThrow();
  });

  it("freezes however many weeks exist when there are fewer than 8", async () => {
    await addWeeks(38, 40, 10);
    expect((await startMeasurement(db, { startDate: "2026-10-12", userId: null })).frozenWeeks).toBe(3);
  });
});

describe("kill switch", () => {
  it("trips once, records who, clears only with a note, and logs both", async () => {
    expect(await tripKill(db, { kind: "trip_manual", reason: "Supplier strike", setBy: sponsorId, label: "Deepa (sponsor)" })).toBe(true);
    expect(await tripKill(db, { kind: "trip_manual", reason: "again", label: "x" })).toBe(false);
    expect(await getKillState(db)).toMatchObject({ active: true, reason: "Supplier strike", by: "Deepa (sponsor)" });
    await clearKill(db, { setBy: sponsorId, label: "Deepa (sponsor)", note: "Supplier is back" });
    expect((await getKillState(db)).active).toBe(false);
    await expect(clearKill(db, { setBy: sponsorId, label: "x", note: "nothing to clear" })).rejects.toBeInstanceOf(KillNotActiveError);
    const rows = await db.select().from(killState);
    expect(rows.map((r) => r.kind).sort()).toEqual(["clear", "trip_manual"]);
    expect(rows.find((r) => r.kind === "clear")).toMatchObject({ note: "Supplier is back", setBy: sponsorId });
  });

  it("the export is open until the kill switch is on; while on, cron and Run-now record skipped_killed and do nothing else", async () => {
    expect(await exportBlocked(db)).toBeNull();
    await tripKill(db, { kind: "trip_manual", reason: "Test stop", label: "t" });
    expect((await exportBlocked(db))?.status).toBe(423);
    const a = await startRun(db, { trigger: "cron", asOf: "2026-10-19" });
    const b = await startRun(db, { trigger: "manual", asOf: "2026-10-19" });
    expect([a.reason, b.reason]).toEqual(["killed", "killed"]);
    expect((await db.select().from(runs)).map((r) => r.status)).toEqual(["skipped_killed", "skipped_killed"]);
    expect(await db.select().from(recommendations)).toHaveLength(0);
    await clearKill(db, { setBy: null, label: "admin", note: "All clear again" });
    expect(await exportBlocked(db)).toBeNull();
    expect(await startRun(db, { trigger: "manual", asOf: "2026-10-19" })).toMatchObject({ created: true, reason: "created" });
  });
});

describe("automatic kill checks (always on: there is no shadow period)", () => {
  const addWeeks = async (from: number, to: number, stockout: number, overstock = 1_000_000) => {
    for (let w = from; w <= to; w += 1) await db.insert(outcomesWeekly).values({ week: week(w), stockoutIncidents: stockout, overstockValueInr: overstock, source: "Priya's report" }).onConflictDoNothing();
  };
  async function measuring() {
    await addWeeks(36, 43, 10); // the baseline: 10 incidents a week
    await startMeasurement(db, { startDate: "2026-11-02", userId: sponsorId }); // Monday of W45
  }

  it("has nothing to judge before outcomes exist, so nothing trips", async () => {
    const r = await runKillCheck(db, { trigger: "manual" });
    expect(r.tripped).toBe(false);
    expect(r.criteria.filter((c) => c.status === "no_data").length).toBeGreaterThanOrEqual(4);
    expect((await getKillState(db)).active).toBe(false);
  });

  it("trips on weekly indicators only at the second consecutive check on new data", async () => {
    await measuring();
    await addWeeks(45, 48, 13); // 30% worse than the baseline of 10
    const first = await runKillCheck(db, { trigger: "run" });
    expect(first.tripped).toBe(false);
    expect(first.warnings.map((c) => c.id)).toContain("indicator_stockout");
    expect((await runKillCheck(db, { trigger: "run" })).tripped).toBe(false); // same data: not a second check
    await addWeeks(49, 49, 13);
    const second = await runKillCheck(db, { trigger: "run" });
    expect(second).toMatchObject({ tripped: true, trippedNow: true });
    expect(await getKillState(db)).toMatchObject({ active: true, kind: "trip_auto", by: "system: kill check" });
    expect((await getKillState(db)).reason).toMatch(/Weekly stockout incidents/);
    await addWeeks(50, 50, 13);
    expect((await runKillCheck(db, { trigger: "run" })).trippedNow).toBe(false);
    expect((await db.select().from(killState)).filter((r) => r.active)).toHaveLength(1);
    expect((await db.select().from(killChecks)).length).toBe(4);
  });

  it("trips when a full quarter since measurement started exceeds the baseline high, and shows last year's figure", async () => {
    await measuring();
    for (const [p, v] of [["2027-04", 1_300_000], ["2027-05", 1_200_000], ["2027-06", 1_100_000]] as const) {
      await db.insert(outcomesMonthly).values({ period: p, stockoutLossInr: v, writeoffInr: 100_000, methodNote: "Finance close" });
    }
    const r = await runKillCheck(db, { trigger: "monthly" });
    expect(r.criteria.find((c) => c.id === "quarter_loss")).toMatchObject({ status: "kill", value: "₹39.0 lakh in 2027-Q2" });
    expect(r.tripped).toBe(true);
  });

  it("trips when 4 consecutive completed runs are mostly overridden", async () => {
    await startMeasurement(db, { startDate: "2026-01-01", userId: sponsorId });
    for (const d of ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]) {
      const res = await startAndExecute(db, { trigger: "manual", asOf: d }, { provider: null });
      const recs = await db.select().from(recommendations).where(eq(recommendations.runId, res.runId));
      for (const r of recs.slice(0, 8)) await applyDecision(db, r.id, { action: "reject", reason: "Not what I would order" }, sponsorId);
      for (const r of recs.slice(8)) await applyDecision(db, r.id, { action: "approve" }, sponsorId);
    }
    expect((await getKillState(db)).active).toBe(false); // each run-end check ran before its decisions were made
    await runKillCheck(db, { trigger: "manual" });
    expect((await getKillState(db)).reason).toMatch(/Override rate/);
    expect((await db.select().from(runs)).filter((r) => r.status === "skipped_killed")).toHaveLength(0);
    expect((await db.select().from(appState).where(eq(appState.key, "live_since"))).length).toBe(1);
  });
});
