import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Actor } from "@/auth/actor";
import { firstMissingPermission, permissionsFor } from "@/auth/config-auth";
import type { Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { appState, baselineWeekly, killChecks, killState, outcomesMonthly, outcomesWeekly, recommendations, runs, users } from "@/db/schema";
import { DEFAULT_RULE_CONFIG, type RuleConfig } from "@/engine/config";
import { GO_LIVE_ITEMS } from "@/golive/items";
import { goLiveReadiness, tickItem } from "@/golive/readiness";
import { exportBlocked } from "@/kill/guards";
import { runKillCheck } from "@/kill/run";
import { KillNotActiveError, clearKill, getKillState, tripKill } from "@/kill/state";
import { createConfigVersion, getActiveConfig } from "@/run/config-store";
import { applyDecision } from "@/run/decisions";
import { startAndExecute, startRun } from "@/run/execute";
import { ForbiddenError, GateError, saveConfigChange } from "@/run/mode";
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

async function readyForGoLive() {
  for (const i of GO_LIVE_ITEMS) await tickItem(db, { key: i.key, userId: sponsorId, note: null });
  for (let w = 36; w <= 43; w += 1) await db.insert(outcomesWeekly).values({ week: week(w), stockoutIncidents: 10, overstockValueInr: 1_000_000, source: "Priya's report" });
}
async function goLive(today = "2026-11-02") {
  return saveConfigChange(db, { config: cfg({ mode: "live" }), note: "Go live", actor: actor("sponsor"), today });
}

describe("who may change which settings", () => {
  it("maps keys to permissions", () => {
    expect(permissionsFor(["cover_min_weeks"])).toEqual(["editRules"]);
    expect(permissionsFor(["mode"])).toEqual(["setMode"]);
    expect(permissionsFor(["override_kill_rate", "mode"]).sort()).toEqual(["editKill", "setMode"]);
    expect(firstMissingPermission("planner", ["mode"])).toBe("setMode");
    expect(firstMissingPermission("planner", ["cover_min_weeks"])).toBeNull();
    expect(firstMissingPermission("sponsor", ["cover_min_weeks"])).toBe("editRules");
    expect(firstMissingPermission("admin", ["mode", "cover_min_weeks", "override_kill_rate"])).toBeNull();
  });
  it("saveConfigChange enforces them", async () => {
    await expect(saveConfigChange(db, { config: cfg({ mode: "live" }), note: "n", actor: actor("planner"), today: "2026-11-02" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveConfigChange(db, { config: cfg({ cover_min_weeks: 5 }), note: "n", actor: actor("sponsor"), today: "2026-11-02" })).rejects.toBeInstanceOf(ForbiddenError);
    const saved = await saveConfigChange(db, { config: cfg({ cover_min_weeks: 5 }), note: "Raghav tweak", actor: actor("planner"), today: "2026-11-02" });
    expect(saved.version).toBe(2);
    const saved2 = await saveConfigChange(db, { config: cfg({ cover_min_weeks: 5, override_kill_rate: 0.6 }), note: "Deepa tweak", actor: actor("sponsor"), today: "2026-11-02" });
    expect(saved2.version).toBe(3);
  });
});

describe("shadow and live mode", () => {
  it("defaults to shadow, and shadow blocks the export while live allows it", async () => {
    expect((await getActiveConfig(db)).config.mode).toBe("shadow");
    expect((await exportBlocked(db))?.status).toBe(423);
    await readyForGoLive();
    await goLive();
    expect(await exportBlocked(db)).toBeNull();
  });

  it("refuses to go live until the checklist and 8 weekly outcomes are done, and names what is missing", async () => {
    await expect(goLive()).rejects.toBeInstanceOf(GateError);
    for (const i of GO_LIVE_ITEMS) await tickItem(db, { key: i.key, userId: sponsorId, note: null });
    const r = await goLiveReadiness(db);
    expect(r.ready).toBe(false);
    expect(r.missing.join(" ")).toMatch(/8 weeks of weekly outcomes \(0 entered\)/);
    try {
      await goLive();
    } catch (e) {
      expect((e as GateError).missing).toHaveLength(1);
    }
  });

  it("going live records the date and freezes the 8 weeks before it, once", async () => {
    await readyForGoLive();
    await db.insert(outcomesWeekly).values({ week: "2026-W44", stockoutIncidents: 99, overstockValueInr: 9, source: "after go-live" });
    const saved = await goLive("2026-11-02"); // 2026-11-02 is in W45
    expect(saved.config.mode).toBe("live");
    const [live] = await db.select().from(appState).where(eq(appState.key, "live_since"));
    expect(live?.value.date).toBe("2026-11-02");
    const frozen = await db.select().from(baselineWeekly);
    expect(frozen.map((f) => f.week).sort()).toEqual(["2026-W37", "2026-W38", "2026-W39", "2026-W40", "2026-W41", "2026-W42", "2026-W43", "2026-W44"]);
    await saveConfigChange(db, { config: cfg({ mode: "shadow" }), note: "Back to shadow", actor: actor("sponsor"), today: "2026-11-10" });
    expect(await db.select().from(appState).where(eq(appState.key, "live_since"))).toHaveLength(0);
    await db.update(outcomesWeekly).set({ stockoutIncidents: 1 });
    await goLive("2026-11-16");
    expect((await db.select().from(baselineWeekly)).every((f) => f.stockoutIncidents === 10 || f.week === "2026-W44")).toBe(true);
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

  it("while on: cron and run-now record skipped_killed and do nothing else, and the export is 423", async () => {
    await readyForGoLive();
    await goLive();
    await tripKill(db, { kind: "trip_manual", reason: "Test stop", label: "t" });
    const a = await startRun(db, { trigger: "cron", asOf: "2026-10-19" });
    const b = await startRun(db, { trigger: "manual", asOf: "2026-10-19" });
    expect([a.reason, b.reason]).toEqual(["killed", "killed"]);
    const all = await db.select().from(runs);
    expect(all.map((r) => r.status)).toEqual(["skipped_killed", "skipped_killed"]);
    expect(await db.select().from(recommendations)).toHaveLength(0);
    expect((await exportBlocked(db))?.status).toBe(423);
    await clearKill(db, { setBy: null, label: "admin", note: "All clear again" });
    const c = await startRun(db, { trigger: "manual", asOf: "2026-10-19" });
    expect(c).toMatchObject({ created: true, reason: "created" });
  });
});

describe("automatic kill checks", () => {
  async function liveWithBaseline() {
    await readyForGoLive();
    await goLive("2026-11-02");
    await db.delete(outcomesWeekly).where(eq(outcomesWeekly.week, "2026-W44"));
  }
  const addWeeks = async (from: number, to: number, stockout: number, overstock = 1_000_000) => {
    for (let w = from; w <= to; w += 1) await db.insert(outcomesWeekly).values({ week: week(w), stockoutIncidents: stockout, overstockValueInr: overstock, source: "Priya's report" }).onConflictDoNothing();
  };

  it("does nothing in shadow mode however bad the numbers are", async () => {
    await addWeeks(40, 50, 999);
    const r = await runKillCheck(db, { trigger: "manual" });
    expect(r.tripped).toBe(false);
    expect((await getKillState(db)).active).toBe(false);
  });

  it("trips on weekly indicators only at the second consecutive check on new data", async () => {
    await liveWithBaseline();
    await addWeeks(45, 48, 13); // 30% worse than the baseline of 10
    const first = await runKillCheck(db, { trigger: "run" });
    expect(first.tripped).toBe(false);
    expect(first.warnings.map((c) => c.id)).toContain("indicator_stockout");
    const same = await runKillCheck(db, { trigger: "run" }); // same data: not a second check
    expect(same.tripped).toBe(false);
    await addWeeks(49, 49, 13);
    const second = await runKillCheck(db, { trigger: "run" });
    expect(second.tripped).toBe(true);
    expect(second.trippedNow).toBe(true);
    const state = await getKillState(db);
    expect(state).toMatchObject({ active: true, kind: "trip_auto", by: "system: kill check" });
    expect(state.reason).toMatch(/Weekly stockout incidents/);
    await addWeeks(50, 50, 13);
    expect((await runKillCheck(db, { trigger: "run" })).trippedNow).toBe(false);
    expect((await db.select().from(killState)).filter((r) => r.active)).toHaveLength(1);
    expect((await db.select().from(killChecks)).length).toBe(4);
  });

  it("trips when a full live quarter exceeds the baseline high, and shows last year's figure", async () => {
    await liveWithBaseline();
    for (const [p, v] of [["2027-04", 1_300_000], ["2027-05", 1_200_000], ["2027-06", 1_100_000]] as const) {
      await db.insert(outcomesMonthly).values({ period: p, stockoutLossInr: v, writeoffInr: 100_000, methodNote: "Finance close" });
    }
    const r = await runKillCheck(db, { trigger: "monthly" });
    expect(r.criteria.find((c) => c.id === "quarter_loss")).toMatchObject({ status: "kill", value: "₹39.0 lakh in 2027-Q2" });
    expect(r.tripped).toBe(true);
  });

  it("trips when 4 consecutive completed live runs are mostly overridden", async () => {
    await readyForGoLive();
    await saveConfigChange(db, { config: cfg({ mode: "live" }), note: "Go live", actor: actor("sponsor"), today: "2026-01-01" });
    for (const d of ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]) {
      const res = await startAndExecute(db, { trigger: "manual", asOf: d }, { provider: null });
      const recs = await db.select().from(recommendations).where(eq(recommendations.runId, res.runId));
      for (const r of recs.slice(0, 8)) await applyDecision(db, r.id, { action: "reject", reason: "Not what I would order" }, sponsorId);
      for (const r of recs.slice(8)) await applyDecision(db, r.id, { action: "approve" }, sponsorId);
    }
    expect((await getKillState(db)).active).toBe(false); // each run-end check ran before its decisions were made
    await runKillCheck(db, { trigger: "manual" });
    const state = await getKillState(db);
    expect(state.active).toBe(true);
    expect(state.reason).toMatch(/Override rate/);
    expect((await db.select().from(runs)).filter((r) => r.status === "skipped_killed")).toHaveLength(0);
  });
});

describe("config versions from before v2", () => {
  it("still parse, filling the new settings with defaults", async () => {
    const { ruleConfigSchema } = await import("@/engine/config");
    const old: Record<string, unknown> = { ...DEFAULT_RULE_CONFIG };
    for (const k of ["mode", "indicator_kill_pct", "expected_regions", "export_id_label", "enable_moq_flag"]) delete old[k];
    const parsed = ruleConfigSchema.parse(old);
    expect(parsed.mode).toBe("shadow");
    expect(parsed.expected_regions).toEqual(["Maharashtra", "Goa"]);
    expect((await createConfigVersion(db, parsed, "migrated")).version).toBe(2);
  });
});
