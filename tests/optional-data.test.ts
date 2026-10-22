import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { exceptions, skus, weeklySales, weeklySalesByDistributor } from "@/db/schema";
import { detectDistributorShift } from "@/engine/distributors";
import { evaluateAll } from "@/engine/evaluate";
import { lastCompleteWeeks } from "@/engine/weeks";
import { ingestCsv } from "@/ingest/ingest";
import { parseCsv } from "@/ingest/parse";
import { createConfigVersion, getActiveConfig } from "@/run/config-store";
import { startAndExecute } from "@/run/execute";
import { createTestDb } from "./db";
import { GOLDEN_AS_OF } from "./golden-table";
import { config, fixtureEngineData, flat, singleSku } from "./helpers";

const weeks = lastCompleteWeeks("2026-10-19", 12);
const dist = (perWeek: (w: string, i: number) => number) => new Map(weeks.map((w, i) => [w, perWeek(w, i)]));

describe("detectDistributorShift", () => {
  const steady = dist(() => 50);
  it("flags a distributor whose recent share is more than the threshold below its baseline share", () => {
    const falling = dist((_, i) => (i >= 8 ? 5 : 50));
    const shifts = detectDistributorShift(new Map([["D1", falling], ["D2", steady]]), weeks, 4, 30);
    expect(shifts.map((s) => s.distributorId)).toEqual(["D1"]);
    expect(shifts[0]?.baselineShare).toBeGreaterThan(0.4);
    expect(shifts[0]?.recentShare).toBeLessThan(0.15);
  });
  it("does not flag small moves, a single distributor, tiny distributors, or exactly the threshold", () => {
    expect(detectDistributorShift(new Map([["D1", dist((_, i) => (i >= 8 ? 45 : 50))], ["D2", steady]]), weeks, 4, 30)).toEqual([]);
    expect(detectDistributorShift(new Map([["D1", steady]]), weeks, 4, 30)).toEqual([]);
    expect(detectDistributorShift(new Map([["D1", dist((_, i) => (i >= 8 ? 0 : 2))], ["D2", dist(() => 100)]]), weeks, 4, 30)).toEqual([]);
    // share 50% -> 35% is exactly 30% lower
    expect(detectDistributorShift(new Map([["D1", dist((_, i) => (i >= 8 ? 35 : 50))], ["D2", dist((_, i) => (i >= 8 ? 65 : 50))]]), weeks, 4, 30)).toEqual([]);
  });
});

describe("distributor_shift exception (off by default)", () => {
  const data = () => {
    const base = singleSku({ units: flat(100), stock: 700, asOf: "2026-10-19" });
    const w = lastCompleteWeeks("2026-10-19", 12);
    const mk = (f: (i: number) => number) => new Map(w.map((x, i) => [x, f(i)]));
    return { ...base, distributorSales: new Map([["S1", new Map([["D1", mk((i) => (i >= 8 ? 5 : 50))], ["D2", mk(() => 50)]])]]) };
  };
  it("does nothing unless switched on", () => {
    expect(evaluateAll(data(), config()).exceptions).toEqual([]);
  });
  it("routes the SKU to the planner with no recommendation when on", () => {
    const r = evaluateAll(data(), config({ enable_distributor_exceptions: true }));
    expect(r.lines).toEqual([]);
    expect(r.exceptions[0]).toMatchObject({ skuId: "S1", type: "distributor_shift" });
    expect(r.exceptions[0]?.detail).toMatch(/Distributor D1 supplied .*% of this SKU over the last 12 weeks but .*% over the last 4/);
  });
  it("is ignored when there is no distributor data for the SKU", () => {
    const d = { ...data(), distributorSales: new Map() };
    expect(evaluateAll(d, config({ enable_distributor_exceptions: true })).lines).toHaveLength(1);
  });
});

describe("lead time and MOQ", () => {
  const withMaster = (leadTimeWeeks: number | null, moq: number | null, stock = 300) => {
    const d = singleSku({ units: flat(100), stock, std: 100 });
    return { ...d, skus: [{ ...d.skus[0]!, leadTimeWeeks, moq }] };
  };
  it("shows lead time and MOQ when present, but raises no flag while the switches are off", () => {
    const l = evaluateAll(withMaster(4, 150), config()).lines[0]!;
    expect(l.metrics).toMatchObject({ leadTimeWeeks: 4, moq: 150, infoFlags: [] });
  });
  it("flags lead_time_breach when cover is below lead time, and below-MOQ quantities, without changing the action", () => {
    const off = evaluateAll(withMaster(4, 150), config()).lines[0]!;
    const on = evaluateAll(withMaster(4, 150), config({ enable_lead_time_flag: true, enable_moq_flag: true })).lines[0]!;
    expect(on.metrics.infoFlags).toEqual(["LEAD_TIME_BREACH", "BELOW_MOQ"]);
    expect([on.action, on.qty, on.flags]).toEqual([off.action, off.qty, off.flags]);
    expect(evaluateAll(withMaster(3, 100), config({ enable_lead_time_flag: true, enable_moq_flag: true })).lines[0]?.metrics.infoFlags).toEqual([]); // cover exactly 3, qty exactly MOQ
    expect(evaluateAll(withMaster(null, null), config({ enable_lead_time_flag: true, enable_moq_flag: true })).lines[0]?.metrics.infoFlags).toEqual([]);
    expect(evaluateAll(withMaster(4, 150, 1000), config({ enable_lead_time_flag: true })).lines[0]?.metrics.infoFlags).toEqual([]);
  });
  it("does not disturb the golden data", () => {
    const g = evaluateAll(fixtureEngineData(GOLDEN_AS_OF), config({ enable_lead_time_flag: true, enable_moq_flag: true }));
    expect(g.lines).toHaveLength(15);
    expect(g.lines.every((l) => l.metrics.infoFlags.length === 0)).toBe(true);
  });
});

describe("ingestion of optional columns", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await loadFixtures(db);
  });
  afterEach(async () => close());

  it("accepts SKU master files with and without Lead_Time_Weeks and MOQ, and never wipes stored values", async () => {
    const header = "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID";
    const r1 = await ingestCsv(db, "sku_master", "m.csv", `${header},Lead_Time_Weeks,MOQ\nSKU001,Masala Peanuts 200g,Snacks,Low,600,case,D001,2.5,100\nSKU002,Rice Flour 1kg,Staples,Low,800,case,D002,,\n`, null);
    expect(r1).toMatchObject({ accepted: 2, rejected: 0 });
    const rows = await db.select().from(skus).where(eq(skus.skuId, "SKU001"));
    expect(rows[0]).toMatchObject({ leadTimeWeeks: 2.5, moq: 100 });
    await ingestCsv(db, "sku_master", "m2.csv", `${header}\nSKU001,Masala Peanuts 200g,Snacks,Low,650,case,D001\n`, null);
    expect((await db.select().from(skus).where(eq(skus.skuId, "SKU001")))[0]).toMatchObject({ standardReorderQty: 650, leadTimeWeeks: 2.5, moq: 100 });
    const bad = parseCsv("sku_master", `${header},Lead_Time_Weeks,MOQ\nA,N,C,Low,10,case,D1,abc,5\nB,N,C,Low,10,case,D1,2,0\n`);
    expect(bad.rejects.map((r) => r.reason)).toEqual([expect.stringMatching(/Lead_Time_Weeks must be a number/), expect.stringMatching(/MOQ/)]);
  });

  it("derives the SKU aggregate from distributor rows and reports conflicts with an aggregate upload", async () => {
    const up = await ingestCsv(db, "sales", "d.csv", "SKU_ID,Week,Units_Sold,Distributor_ID\nSKU001,2026-W42,100,D001\nSKU001,2026-W42,60,D002\nSKU001,2026-W42,7,D001\n", null);
    expect(up).toMatchObject({ accepted: 2, rejected: 1 });
    expect((await db.select().from(weeklySalesByDistributor)).map((r) => [r.distributorId, r.units]).sort()).toEqual([["D001", 100], ["D002", 60]]);
    expect((await db.select().from(weeklySales).where(eq(weeklySales.skuId, "SKU001"))).find((r) => r.week === "2026-W42")?.units).toBe(160);

    const conflict = await ingestCsv(db, "sales", "agg.csv", "SKU_ID,Week,Units_Sold\nSKU001,2026-W42,999\nSKU001,2026-W41,50\n", null);
    expect(conflict.warnings.map((w) => w.reason)).toEqual([expect.stringMatching(/Aggregate 999 .* differs from the sum of its distributor rows \(160\)/)]);
    const agg = await db.select().from(weeklySales).where(eq(weeklySales.skuId, "SKU001"));
    expect(agg.find((r) => r.week === "2026-W42")?.units).toBe(160);
    expect(agg.find((r) => r.week === "2026-W41")?.units).toBe(50);

    const same = await ingestCsv(db, "sales", "agg2.csv", "SKU_ID,Week,Units_Sold\nSKU001,2026-W42,160\n", null);
    expect(same.warnings).toEqual([]);
  });

  it("a rerun with the distributor rule on routes a shifting SKU to Raghav", async () => {
    const wk = lastCompleteWeeks(GOLDEN_AS_OF, 12);
    const csv = ["SKU_ID,Week,Units_Sold,Distributor_ID", ...wk.flatMap((w, i) => [`SKU003,${w},${i >= 8 ? 4 : 75},D001`, `SKU003,${w},75,D002`])].join("\n");
    await ingestCsv(db, "sales", "d.csv", csv, null);
    const { config: c } = await getActiveConfig(db);
    await createConfigVersion(db, { ...c, enable_distributor_exceptions: true }, "turn on distributor shifts");
    const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
    const exc = await db.select().from(exceptions).where(eq(exceptions.runId, res.runId));
    expect(exc.map((e) => [e.skuId, e.type])).toEqual([["SKU003", "distributor_shift"]]);
  });

  it("warns, but does not reject, a distributor outside the expected regions", async () => {
    const r = await ingestCsv(db, "distributors", "d.csv", "Distributor_ID,Distributor_Name,Region,Status\nD900,Karnataka Foods,Karnataka,Active\nD901,Goa Foods,Goa,Active\nD902,Pune Foods,Maharashtra West,Active\n", null);
    expect(r).toMatchObject({ accepted: 3, rejected: 0 });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]?.reason).toMatch(/D900 is in "Karnataka", outside the expected regions \(maharashtra, goa\)/);
  });
});
