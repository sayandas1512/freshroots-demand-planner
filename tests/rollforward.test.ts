import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, max } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { inventorySnapshots, weeklySales } from "@/db/schema";
import { lastCompleteWeek } from "@/engine/weeks";
import { rollForwardDemoData } from "@/run/rollforward";
import { createTestDb } from "./db";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await loadFixtures(db);
});
afterEach(async () => close());

const latestStock = async () => (await db.select({ d: max(inventorySnapshots.asOfDate) }).from(inventorySnapshots))[0]?.d;
const latestWeek = async () => (await db.select({ w: max(weeklySales.week) }).from(weeklySales))[0]?.w;

describe("demo roll-forward", () => {
  it("brings stock to today and fills the missing complete weeks, then does nothing more", async () => {
    const today = "2027-03-10";
    const first = await rollForwardDemoData(db, today);
    expect(await latestStock()).toBe(today);
    expect(await latestWeek()).toBe(lastCompleteWeek(today));
    expect(first.weeksAdded.length).toBeGreaterThan(0);
    const again = await rollForwardDemoData(db, today);
    expect(again).toEqual({ stockDate: null, weeksAdded: [] });
  });

  it("only adds rows: existing weeks are untouched", async () => {
    const before = await db.select().from(weeklySales);
    const oldest = before[0] as (typeof before)[number];
    await rollForwardDemoData(db, "2027-03-10");
    const [row] = await db.select().from(weeklySales).where(eq(weeklySales.skuId, oldest.skuId));
    expect(before.some((r) => r.skuId === row?.skuId && r.week === row?.week && r.units === row?.units)).toBe(true);
    expect((await db.select().from(weeklySales)).length).toBeGreaterThan(before.length);
  });
});
