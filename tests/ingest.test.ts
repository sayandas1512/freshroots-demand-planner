import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { festivalMonths, inventorySnapshots, openPos, skus, weeklySales } from "@/db/schema";
import { dataFreshness, ingestCsv } from "@/ingest/ingest";
import { parseCsv } from "@/ingest/parse";
import { createTestDb } from "./db";

describe("parseCsv (pure validation)", () => {
  it("accepts good rows and rejects each bad row with a reason, never silently dropping", () => {
    const parsed = parseCsv("sales", readFileSync("fixtures/broken_sales.csv", "utf8"));
    expect(parsed.totalRows).toBe(10);
    expect(parsed.rows.map((r) => r.row)).toEqual([2, 8, 11]);
    expect(parsed.rejects.map((r) => r.row)).toEqual([3, 4, 5, 6, 7, 9, 10]);
    expect(parsed.rows.length + parsed.rejects.length).toBe(parsed.totalRows);
    const reasonFor = (row: number) => parsed.rejects.find((r) => r.row === row)?.reason ?? "";
    expect(reasonFor(3)).toMatch(/Week must be an ISO week/);
    expect(reasonFor(4)).toMatch(/Units_Sold must be a whole number/);
    expect(reasonFor(5)).toMatch(/Units_Sold must be a whole number/);
    expect(reasonFor(6)).toMatch(/SKU_ID/);
    expect(reasonFor(7)).toMatch(/Units_Sold must be a whole number/);
    expect(reasonFor(9)).toMatch(/Duplicate of row 8/);
    expect(reasonFor(10)).toMatch(/SKU_ID/);
  });

  it("flags duplicates inside one file against the first occurrence", () => {
    const parsed = parseCsv("sales", "SKU_ID,Week,Units_Sold\nA,2026-W42,5\nA,2026-W42,6\n");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rejects[0]?.reason).toMatch(/Duplicate of row 2/);
  });

  it("rejects the whole file when a required column is missing, naming it", () => {
    const parsed = parseCsv("sales", "SKU_ID,Week\nA,2026-W42\n");
    expect(parsed.fileError).toMatch(/Units_Sold/);
    expect(parsed.rows).toEqual([]);
  });

  it("enforces size and row limits", () => {
    expect(parseCsv("sales", "x".repeat(4_000_001)).fileError).toMatch(/larger than/);
    const rows = Array.from({ length: 100_001 }, (_, i) => `S${i},2026-W01,1`).join("\n");
    expect(parseCsv("sales", `SKU_ID,Week,Units_Sold\n${rows}`).fileError).toMatch(/more than/);
  });

  it("tolerates a BOM and extra columns, and does not execute formulas", () => {
    const parsed = parseCsv("distributors", "﻿Distributor_ID,Distributor_Name,Region,Status,Extra\nD1,Name,West,Active,ignored\n");
    expect(parsed.rows).toHaveLength(1);
    const hostile = parseCsv("distributors", "Distributor_ID,Distributor_Name,Region,Status\n=cmd|' /C calc'!A0,N,R,Active\n");
    expect(hostile.rows).toHaveLength(0);
    expect(hostile.rejects).toHaveLength(1);
  });

  it("validates each kind's domain rules", () => {
    expect(parseCsv("sku_master", "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID\nA,N,C,Medium,10,case,D1\n").rejects[0]?.reason).toMatch(/Low or High/);
    expect(parseCsv("sku_master", "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID\nA,N,C,HIGH,0,case,D1\n").rejects[0]?.reason).toMatch(/Standard_Reorder_Qty/);
    expect(parseCsv("inventory", "SKU_ID,Location,Units_On_Hand,As_Of_Date\nA,W,5,2026-02-30\n").rejects[0]?.reason).toMatch(/real date/);
    expect(parseCsv("festival_calendar", "Year,Month,Year_Month,Is_Festival_Month\n2026,10,2026-11,TRUE\n").rejects[0]?.reason).toMatch(/do not match/);
    expect(parseCsv("open_pos", "SKU_ID,Open_PO_Qty,Expected_Date\nA,10,\nA,5,2026-11-01\n").rows).toHaveLength(2);
    expect(parseCsv("open_pos", "SKU_ID,Open_PO_Qty,Expected_Date\n").rows).toEqual([]);
  });
});

describe("ingestCsv (database)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => close());

  it("loads the five fixtures and reports counts per file", async () => {
    const reports = await loadFixtures(db);
    expect(reports.map((r) => [r.kind, r.accepted, r.rejected, r.replaced])).toEqual([
      ["distributors", 4, 0, 0],
      ["sku_master", 15, 0, 0],
      ["festival_calendar", 24, 0, 0],
      ["sales", 240, 0, 0],
      ["inventory", 15, 0, 0],
    ]);
    const [{ n: salesRows } = { n: 0 }] = await db.select({ n: count() }).from(weeklySales);
    expect(salesRows).toBe(240);
  });

  it("is idempotent: loading the same files again changes no data and reports rows as replaced", async () => {
    const again = await loadFixtures(db);
    expect(again.map((r) => r.replaced)).toEqual([4, 15, 24, 240, 15]);
    expect((await db.select({ n: count() }).from(weeklySales))[0]?.n).toBe(240);
    expect((await db.select({ n: count() }).from(skus))[0]?.n).toBe(15);
    expect((await db.select({ n: count() }).from(festivalMonths))[0]?.n).toBe(24);
    expect((await db.select({ n: count() }).from(inventorySnapshots))[0]?.n).toBe(15);
  });

  it("re-uploading a week replaces its values", async () => {
    const report = await ingestCsv(db, "sales", "w42.csv", "SKU_ID,Week,Units_Sold\nSKU001,2026-W42,999\n");
    expect(report).toMatchObject({ accepted: 1, replaced: 1, inserted: 0, rejected: 0 });
    const rows = await db.select().from(weeklySales);
    expect(rows.find((r) => r.skuId === "SKU001" && r.week === "2026-W42")?.units).toBe(999);
  });

  it("accepts good rows next to bad ones and reports the bad ones row by row", async () => {
    const report = await ingestCsv(db, "sales", "broken_sales.csv", readFileSync("fixtures/broken_sales.csv", "utf8"));
    expect(report.accepted).toBe(3);
    expect(report.rejected).toBe(7);
    expect(report.rejects.every((r) => r.reason.length > 0 && r.row >= 2)).toBe(true);
    expect(report.warnings.map((w) => w.raw.SKU_ID)).toEqual(["SKU777"]);
  });

  it("rejects an unreadable file without touching data", async () => {
    const before = (await db.select({ n: count() }).from(weeklySales))[0]?.n;
    const report = await ingestCsv(db, "sales", "bad.csv", "not,a,sales,file\n1,2,3,4\n");
    expect(report.fileError).toBeDefined();
    expect((await db.select({ n: count() }).from(weeklySales))[0]?.n).toBe(before);
  });

  it("replaces the open PO list on each upload, and an empty list is valid", async () => {
    await ingestCsv(db, "open_pos", "po.csv", "SKU_ID,Open_PO_Qty,Expected_Date\nSKU001,300,2026-10-25\nSKU002,100,\n");
    expect((await db.select({ n: count() }).from(openPos))[0]?.n).toBe(2);
    const cleared = await ingestCsv(db, "open_pos", "po.csv", "SKU_ID,Open_PO_Qty,Expected_Date\n");
    expect(cleared.replaced).toBe(2);
    expect((await db.select({ n: count() }).from(openPos))[0]?.n).toBe(0);
  });

  it("reports freshness", async () => {
    const f = await dataFreshness(db);
    expect(f.latestSalesWeek).toBe("2026-W42");
    expect(f.latestInventoryDate).toBe("2026-10-19");
    expect(f.skuCount).toBe(15);
  });
});
