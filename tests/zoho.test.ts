import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { exportLog, openPos, recommendations, skus, zohoItemMap, zohoPushLog, zohoSyncLog, zohoVendorMap } from "@/db/schema";
import { ingestCsv } from "@/ingest/ingest";
import { applyDecision } from "@/run/decisions";
import { startAndExecute } from "@/run/execute";
import { ZohoClient, ZohoError, dbTokenStore, memoryTokenStore, type TokenStore } from "@/zoho/client";
import { zohoConfig, type ZohoConfig } from "@/zoho/config";
import { ensureFreshOpenPos } from "@/zoho";
import { allowRetry, planDraftPos, pushDraftPos, referenceFor } from "@/zoho/push";
import { rebuildOpenPos, syncZoho } from "@/zoho/sync";
import { FakeZoho } from "./fake-zoho";
import { createTestDb } from "./db";
import { GOLDEN_AS_OF } from "./golden-table";

const cfg = (o: Partial<ZohoConfig> = {}): ZohoConfig => ({ clientId: "cid", clientSecret: "secret", refreshToken: "refresh-123", orgId: "60001", dc: "in", openStatuses: ["issued", "partially_received", "open"], dailyBudget: 1000, webhookSecret: null, apiBase: null, accountsBase: null, ...o });
const fixedClock = () => {
  let t = Date.parse("2026-10-20T04:00:00Z");
  return { now: () => t, advance: (ms: number) => void (t += ms), sleeps: [] as number[], sleep(ms: number) { this.sleeps.push(ms); t += ms; return Promise.resolve(); } };
};

function client(fake: FakeZoho, o: Partial<ZohoConfig> = {}, store: TokenStore = memoryTokenStore(), clock = fixedClock()) {
  return { c: new ZohoClient(cfg(o), store, { fetchImpl: fake.fetch, sleep: (ms) => clock.sleep(ms), now: clock.now }), clock, store };
}

describe("config from the environment", () => {
  it("is null unless everything needed is set, defaults to the India data centre, and rejects an unknown one", () => {
    const env = { ZOHO_CLIENT_ID: "a", ZOHO_CLIENT_SECRET: "b", ZOHO_REFRESH_TOKEN: "c", ZOHO_ORG_ID: "d" } as unknown as NodeJS.ProcessEnv;
    expect(zohoConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(zohoConfig(env)).toMatchObject({ dc: "in", openStatuses: ["issued", "partially_received", "open"], dailyBudget: 1000, webhookSecret: null, apiBase: null });
    expect(zohoConfig({ ...env, ZOHO_API_BASE_URL: "http://localhost:4010/inventory/v1" })?.apiBase).toBe("http://localhost:4010/inventory/v1");
    expect(zohoConfig({ ...env, ZOHO_API_BASE_URL: "http://evil.example.com/v1" })?.apiBase).toBeNull();
    expect(zohoConfig({ ...env, ZOHO_DC: "com", ZOHO_OPEN_PO_STATUSES: " Issued , OPEN ", ZOHO_DAILY_CALL_BUDGET: "5000" })).toMatchObject({ dc: "com", openStatuses: ["issued", "open"], dailyBudget: 5000 });
    expect(zohoConfig({ ...env, ZOHO_DC: "mars" })).toBeNull();
    expect(zohoConfig({ ...env, ZOHO_ORG_ID: "" })).toBeNull();
  });
});

describe("OAuth client", () => {
  it("exchanges the refresh token on the India accounts server, sends the bearer header and organisation id, and caches the access token", async () => {
    const fake = new FakeZoho();
    const { c } = client(fake);
    await c.request("GET", "/items");
    await c.request("GET", "/items");
    expect(fake.tokenCount).toBe(1);
    const t = fake.tokenCalls[0]!;
    expect(t.url).toBe("https://accounts.zoho.in/oauth/v2/token");
    expect(Object.fromEntries(t.body)).toEqual({ refresh_token: "refresh-123", client_id: "cid", client_secret: "secret", grant_type: "refresh_token" });
    expect(fake.calls[0]!.auth).toBe("Zoho-oauthtoken tok-1");
    expect(fake.calls[0]!.query.get("organization_id")).toBe("60001");
    expect(c.apiBase).toBe("https://www.zohoapis.in/inventory/v1");
  });

  it("shares the cached token across client instances (separate serverless invocations) through the store", async () => {
    const fake = new FakeZoho();
    const store = memoryTokenStore();
    await client(fake, {}, store).c.request("GET", "/items");
    await client(fake, {}, store).c.request("GET", "/items");
    expect(fake.tokenCount).toBe(1);
  });

  it("refreshes before the hour is up, with a margin, and keeps the site updated without anyone doing anything", async () => {
    const fake = new FakeZoho();
    const { c, clock } = client(fake);
    await c.request("GET", "/items");
    clock.advance(54 * 60_000); // 6 minutes left: still inside the safe window
    await c.request("GET", "/items");
    expect(fake.tokenCount).toBe(1);
    clock.advance(2 * 60_000); // under the 5 minute margin
    await c.request("GET", "/items");
    expect(fake.tokenCount).toBe(2);
    expect(fake.calls.at(-1)!.auth).toBe("Zoho-oauthtoken tok-2");
  });

  it("recovers from a revoked or expired token (401) once, and gives up if it keeps failing", async () => {
    const fake = new FakeZoho();
    const { c } = client(fake);
    await c.request("GET", "/items");
    fake.expireAllTokens();
    await expect(c.request("GET", "/items")).resolves.toMatchObject({ code: 0 });
    expect(fake.tokenCount).toBe(2);
    fake.expireAllTokens();
    fake.tokenFails = true;
    await expect(c.request("GET", "/items")).rejects.toThrow(/token refresh failed/);
  });

  it("falls back to a still-valid cached token when the refresh endpoint is refusing", async () => {
    const fake = new FakeZoho();
    const store = memoryTokenStore();
    const { c, clock } = client(fake, {}, store);
    await c.request("GET", "/items");
    clock.advance(58 * 60_000);
    fake.tokenFails = true;
    await expect(c.request("GET", "/items")).resolves.toMatchObject({ code: 0 });
    expect(fake.calls.at(-1)!.auth).toBe("Zoho-oauthtoken tok-1");
  });

  it("a bad refresh token is a clear error that never contains the secret", async () => {
    const fake = new FakeZoho();
    const bad = new ZohoClient(cfg({ refreshToken: "nope", clientSecret: "TOP-SECRET" }), memoryTokenStore(), { fetchImpl: fake.fetch });
    const err = await bad.request("GET", "/items").catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(ZohoError);
    expect((err as Error).message).toMatch(/refresh token and data centre/);
    expect((err as Error).message).not.toContain("TOP-SECRET");
  });

  it("retries 429 and 5xx with backoff (honouring Retry-After), then throws; errors with code != 0 are errors even on HTTP 200", async () => {
    const fake = new FakeZoho();
    const { c, clock } = client(fake);
    fake.failNext = { status: 429, times: 1, headers: { "retry-after": "3" } };
    await expect(c.request("GET", "/items")).resolves.toBeDefined();
    expect(clock.sleeps).toEqual([3000]);
    fake.failNext = { status: 500, times: 5 };
    await expect(c.request("GET", "/items")).rejects.toThrow(/failed/);
    fake.failNext = null;
    await expect(c.request("GET", "/nope")).rejects.toMatchObject({ status: 404 });
  });

  it("paces itself under 100 calls a minute", async () => {
    const fake = new FakeZoho();
    const { c, clock } = client(fake);
    for (let i = 0; i < 95; i += 1) await c.request("GET", "/items");
    expect(clock.sleeps.length).toBeGreaterThan(0);
    expect(fake.calls.length).toBe(95);
  });

  it("reads every page of a list", async () => {
    const fake = new FakeZoho();
    fake.pageSize = 2;
    fake.items = Array.from({ length: 5 }, (_, i) => ({ item_id: `i${i}`, name: `n${i}` }));
    const rows = await client(fake).c.paginate("/items", "items");
    expect(rows).toHaveLength(5);
    expect(fake.count("GET", "/items")).toBe(3);
  });
});

describe("sync and push against Zoho", () => {
  let db: Db;
  let close: () => Promise<void>;
  let fake: FakeZoho;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await loadFixtures(db);
    fake = new FakeZoho();
    fake.items = ["SKU001", "SKU002", "SKU003", "SKU004"].map((sku, i) => ({ item_id: `item-${sku}`, name: `Zoho ${sku}`, sku, purchase_rate: 40 + i, vendor_id: "v-1" }));
    fake.items.push({ item_id: "item-ORPHAN", name: "Not ours", sku: "ZZZ-1", purchase_rate: 5 });
    fake.vendors = [{ contact_id: "v-1", contact_name: "Sahyadri Agencies" }, { contact_id: "v-2", contact_name: "Konkan Foods" }];
    fake.pos = [
      { purchaseorder_id: "po-1", purchaseorder_number: "PO-1", status: "issued", vendor_id: "v-1", total: 100, delivery_date: "2026-10-25", line_items: [{ item_id: "item-SKU001", quantity: 300, quantity_received: 0 }, { item_id: "item-ORPHAN", quantity: 7, quantity_received: 0 }] },
      { purchaseorder_id: "po-2", purchaseorder_number: "PO-2", status: "Partially_Received", vendor_id: "v-1", total: 50, line_items: [{ item_id: "item-SKU002", quantity: 100, quantity_received: 40 }, { item_id: "item-SKU003", quantity: 10, quantity_received: 10 }] },
      { purchaseorder_id: "po-3", purchaseorder_number: "PO-3", status: "draft", vendor_id: "v-1", total: 9, line_items: [{ item_id: "item-SKU004", quantity: 999, quantity_received: 0 }] },
      { purchaseorder_id: "po-4", purchaseorder_number: "PO-4", status: "cancelled", vendor_id: "v-1", total: 9, line_items: [{ item_id: "item-SKU004", quantity: 888, quantity_received: 0 }] },
    ];
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await close();
  });
  const mk = (o: Partial<ZohoConfig> = {}) => client(fake, o, dbTokenStore(db)).c;
  const openRows = async (source = "zoho") => (await db.select().from(openPos).where(eq(openPos.source, source))).map((r) => [r.skuId, r.qty, r.expectedDate]).sort();

  describe("read side: open POs by API", () => {
    it("builds open_pos from issued and partially received POs only, using quantity not yet received", async () => {
      const report = await syncZoho(db, mk(), { trigger: "manual" });
      expect(report).toMatchObject({ ok: true, items: 5, vendors: 2, posListed: 4, posOpen: 2, posDetailed: 2, openPoRows: 2 });
      expect(await openRows()).toEqual([["SKU001", 300, "2026-10-25"], ["SKU002", 60, null]]);
      expect(report.unmapped).toEqual([{ itemId: "item-ORPHAN", name: "Not ours" }]);
      expect(report.warnings.join(" ")).toMatch(/1 Zoho items on open purchase orders are not matched to a SKU/);
      const [log] = await db.select().from(zohoSyncLog);
      expect(log).toMatchObject({ ok: true, trigger: "manual" });
      expect(log?.calls).toBe(report.calls);
    });

    it("the engine sees the synced quantity next to stock", async () => {
      await syncZoho(db, mk(), { trigger: "manual" });
      const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
      const rec = (await db.select().from(recommendations).where(eq(recommendations.runId, res.runId))).find((r) => r.skuId === "SKU001")!;
      expect(rec.metrics.openPoQty).toBe(300);
    });

    it("a manual mapping wins and fixes an unmatched item", async () => {
      await db.insert(zohoItemMap).values({ skuId: "SKU005", itemId: "item-ORPHAN" });
      await syncZoho(db, mk(), { trigger: "manual" });
      expect(await openRows()).toEqual([["SKU001", 300, "2026-10-25"], ["SKU002", 60, null], ["SKU005", 7, "2026-10-25"]]);
    });

    it("is incremental: a second sync re-reads neither items nor unchanged POs, a change or force does", async () => {
      await syncZoho(db, mk(), { trigger: "cron" });
      const before = fake.calls.length;
      const second = await syncZoho(db, mk(), { trigger: "cron" });
      expect(second).toMatchObject({ ok: true, items: 0, posDetailed: 0 });
      expect(fake.calls.length - before).toBe(1); // just the PO list
      expect(await openRows()).toHaveLength(2);

      fake.pos[1]!.status = "issued";
      fake.pos[1]!.total = 55;
      expect((await syncZoho(db, mk(), { trigger: "cron" })).posDetailed).toBe(1);

      const forced = await syncZoho(db, mk(), { trigger: "webhook", force: true });
      expect(forced).toMatchObject({ items: 5, posDetailed: 2 });
    });

    it("keeps the CSV rows when only Zoho rows are rebuilt, and the CSV upload keeps the Zoho rows", async () => {
      await ingestCsv(db, "open_pos", "po.csv", "SKU_ID,Open_PO_Qty,Expected_Date\nSKU009,25,\n");
      await syncZoho(db, mk(), { trigger: "manual" });
      expect(await openRows("csv")).toEqual([["SKU009", 25, null]]);
      await ingestCsv(db, "open_pos", "po.csv", "SKU_ID,Open_PO_Qty,Expected_Date\n");
      expect(await openRows("csv")).toEqual([]);
      expect(await openRows()).toHaveLength(2);
      await rebuildOpenPos(db, ["issued"]);
      expect((await openRows()).map((r) => r[0])).toEqual(["SKU001"]);
    });

    it("stays inside the daily call budget and says what it skipped", async () => {
      await syncZoho(db, mk(), { trigger: "cron" }); // spends calls
      const spent = (await db.select().from(zohoSyncLog))[0]!.calls;
      // forced: items, vendors and the list cost 3 calls, then 2 detail reads are wanted but only 1 fits in what is left
      const tight = await syncZoho(db, mk({ dailyBudget: spent + 10 + 4 }), { trigger: "cron", force: true });
      expect(tight.ok).toBe(true);
      expect(tight.skippedForBudget).toBeGreaterThan(0);
      expect(tight.warnings.join(" ")).toMatch(/daily Zoho call budget/);
      expect(await openRows()).toHaveLength(2); // last known quantities kept
    });

    it("refuses to sync once the daily budget is used, leaving open POs untouched, and logs the failure", async () => {
      await syncZoho(db, mk(), { trigger: "cron" });
      const r = await syncZoho(db, mk({ dailyBudget: 12 }), { trigger: "cron" });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Daily Zoho call budget used/);
      expect(await openRows()).toHaveLength(2);
      expect((await db.select().from(zohoSyncLog)).at(-1)?.ok).toBe(false);
    });

    it("a failing list call fails the sync without wiping the open POs; one unreadable PO only warns", async () => {
      await syncZoho(db, mk(), { trigger: "cron" });
      fake.failNext = { status: 500, times: 99 };
      const failed = await syncZoho(db, mk(), { trigger: "cron", force: true });
      expect(failed.ok).toBe(false);
      expect(await openRows()).toHaveLength(2);
      fake.failNext = null;
      fake.pos = fake.pos.filter((p) => p.purchaseorder_id !== "po-1");
      fake.pos.push({ purchaseorder_id: "ghost", purchaseorder_number: "PO-9", status: "issued", vendor_id: "v-1", total: 1, line_items: [] });
      const partial = await syncZoho(db, mk(), { trigger: "cron", force: true });
      expect(partial.ok).toBe(true);
    });

    it("tolerates items and vendors in unexpected shapes", async () => {
      fake.items.push({ item_id: "", name: "broken" } as never);
      const r = await syncZoho(db, mk(), { trigger: "manual" });
      expect(r.ok).toBe(true);
      expect(r.warnings.join(" ")).toMatch(/unexpected shape/);
    });

    it("runs before each run when stale, and a Zoho outage only adds a note", async () => {
      vi.stubEnv("ZOHO_CLIENT_ID", "cid");
      vi.stubEnv("ZOHO_CLIENT_SECRET", "secret");
      vi.stubEnv("ZOHO_REFRESH_TOKEN", "refresh-123");
      vi.stubEnv("ZOHO_ORG_ID", "60001");
      vi.stubGlobal("fetch", fake.fetch);
      const first = await ensureFreshOpenPos(db);
      expect(first).toMatchObject({ attempted: true, report: { ok: true } });
      expect((await ensureFreshOpenPos(db)).attempted).toBe(false); // fresh enough
      fake.tokenFails = true;
      fake.expireAllTokens();
      const later = await ensureFreshOpenPos(db, 0);
      expect(later.report?.ok).toBe(false);
      expect(later.lastOkAt).not.toBeNull();
      const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
      expect(res.status).toBe("completed"); // the run still completes
    });
  });

  describe("write side: draft purchase orders", () => {
    async function approvedRun() {
      const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
      const recs = await db.select().from(recommendations).where(eq(recommendations.runId, res.runId));
      const id = (sku: string) => recs.find((r) => r.skuId === sku)!.id;
      await applyDecision(db, id("SKU001"), { action: "approve" }, null); // DIST001, 750
      await applyDecision(db, id("SKU003"), { action: "approve" }, null); // DIST002, 300
      await applyDecision(db, id("SKU004"), { action: "edit", qty: 300, reason: "Festival promo" }, null); // DIST002, 300
      await applyDecision(db, id("SKU011"), { action: "reject", reason: "Pallet on hand" }, null);
      await db.insert(zohoVendorMap).values([{ distributorId: "DIST001", vendorId: "v-1" }, { distributorId: "DIST002", vendorId: "v-2" }]);
      await syncZoho(db, mk(), { trigger: "manual" });
      return res.runId;
    }
    const posts = () => fake.calls.filter((c) => c.method === "POST");

    it("plans one PO per vendor from approved lines only, with Zoho's purchase rate, and says why anything is blocked", async () => {
      const runId = await approvedRun();
      const plan = await planDraftPos(db, runId);
      expect(plan.blocked).toEqual([]);
      expect(plan.pos.map((p) => [p.vendorId, p.reference, p.totalQty, p.lines.map((l) => [l.skuId, l.itemId, l.qty, l.rate])])).toEqual([
        ["v-1", referenceFor(runId, "v-1"), 750, [["SKU001", "item-SKU001", 750, 40]]],
        ["v-2", referenceFor(runId, "v-2"), 600, [["SKU003", "item-SKU003", 300, 42], ["SKU004", "item-SKU004", 300, 43]]],
      ]);
      expect(JSON.stringify(plan)).not.toContain("SKU011");
    });

    it("blocks a vendor's whole PO when any line has no item, no rate or no vendor, and never splits it", async () => {
      const runId = await approvedRun();
      fake.items = fake.items.map((i) => (i.sku === "SKU003" ? { ...i, purchase_rate: 0 } : i));
      await syncZoho(db, mk(), { trigger: "manual", force: true });
      const held = await planDraftPos(db, runId);
      expect(held.pos.map((p) => p.vendorId)).toEqual(["v-1"]); // the other vendor is untouched
      const reasons = Object.fromEntries(held.blocked.map((b) => [b.skuId, b.reason]));
      expect(reasons.SKU003).toMatch(/has no purchase rate/);
      expect(reasons.SKU004).toMatch(/Held back/);

      await db.delete(zohoVendorMap).where(eq(zohoVendorMap.distributorId, "DIST001"));
      const none = await planDraftPos(db, runId);
      expect(none.pos).toEqual([]);
      expect(none.blocked.find((b) => b.skuId === "SKU001")?.reason).toMatch(/Distributor DIST001 is not mapped to a Zoho vendor/);
    });

    it("creates DRAFT POs only: no status, no issue, approve or submit calls, a reference for every PO, and a log entry", async () => {
      const runId = await approvedRun();
      const out = await pushDraftPos(db, mk(), { runId, userId: null, today: "2026-10-20" });
      expect(out.results.map((r) => [r.vendorName, r.status])).toEqual([["Sahyadri Agencies", "created"], ["Konkan Foods", "created"]]);
      expect(posts()).toHaveLength(2);
      for (const p of posts()) {
        expect(p.path).toBe("/purchaseorders");
        const b = p.body as Record<string, unknown>;
        expect(b).not.toHaveProperty("status");
        expect(String(b.reference_number)).toMatch(/^FR-[0-9a-f]{8}-/);
        expect(b.date).toBe("2026-10-20");
        expect(String(b.notes)).toContain("Review before issuing");
      }
      expect(fake.calls.some((c) => /issue|approve|submit|status/i.test(c.path))).toBe(false);
      expect(fake.pos.filter((p) => p.status === "draft" && p.purchaseorder_number.startsWith("FR-"))).toHaveLength(2);
      expect((posts()[0]!.body as { line_items: unknown[] }).line_items).toEqual([{ item_id: "item-SKU001", quantity: 750, purchase_rate: 40 }]);
      const log = await db.select().from(zohoPushLog);
      expect(log.map((l) => l.status)).toEqual(["created", "created"]);
      expect((await db.select().from(exportLog)).map((l) => [l.kind, l.lineCount, l.totalQty])).toEqual([["zoho_draft", 2, 1350]]);
    });

    it("never creates the same PO twice, however often the push is repeated or raced", async () => {
      const runId = await approvedRun();
      const [a, b] = await Promise.all([pushDraftPos(db, mk(), { runId, userId: null, today: "2026-10-20" }), pushDraftPos(db, mk(), { runId, userId: null, today: "2026-10-20" })]);
      expect(posts()).toHaveLength(2);
      const statuses = [...a.results, ...b.results].map((r) => r.status).sort();
      expect(statuses.filter((s) => s === "created")).toHaveLength(2);
      const again = await pushDraftPos(db, mk(), { runId, userId: null, today: "2026-10-21" });
      expect(again.results.map((r) => r.status)).toEqual(["already_created", "already_created"]);
      expect(posts()).toHaveLength(2);
    });

    it("a rejected request is a failure that can be retried; a lost connection is unconfirmed and is never retried blindly", async () => {
      const runId = await approvedRun();
      fake.failNext = { status: 400, times: 2 };
      const failed = await pushDraftPos(db, mk(), { runId, userId: null, today: "2026-10-20" });
      expect(failed.results.map((r) => r.status)).toEqual(["failed", "failed"]);
      expect(await db.select().from(zohoPushLog).where(eq(zohoPushLog.status, "failed"))).toHaveLength(2);
      fake.failNext = null;
      const retried = await pushDraftPos(db, mk(), { runId, userId: null, today: "2026-10-20" });
      expect(retried.results.map((r) => r.status)).toEqual(["created", "created"]);

      // a second run's worth: connection drops after sending
      await db.delete(zohoPushLog);
      fake.pos = fake.pos.filter((p) => !p.purchaseorder_number.startsWith("FR-"));
      fake.networkErrorOnCreate = true;
      const lost = await pushDraftPos(db, mk(), { runId, userId: null, today: "2026-10-20" });
      expect(lost.results.map((r) => r.status)).toEqual(["unconfirmed", "unconfirmed"]);
      fake.networkErrorOnCreate = false;
      const before = posts().length;
      const blocked = await pushDraftPos(db, mk(), { runId, userId: null, today: "2026-10-20" });
      expect(blocked.results.map((r) => r.status)).toEqual(["unconfirmed", "unconfirmed"]);
      expect(posts().length).toBe(before); // nothing created without a human check

      // one of them did reach Zoho before the connection dropped: it is found, not duplicated
      const ref = referenceFor(runId, "v-1");
      fake.pos.push({ purchaseorder_id: "found-1", purchaseorder_number: ref, status: "draft", vendor_id: "v-1", total: 1, line_items: [] });
      const found = await pushDraftPos(db, mk(), { runId, userId: null, today: "2026-10-20" });
      expect(found.results.map((r) => r.status)).toEqual(["already_created", "unconfirmed"]);
      expect(found.results[0]?.zohoPoNumber).toBe(ref);

      // a person checks Zoho for the other one, sees nothing, and allows a retry
      expect(await allowRetry(db, referenceFor(runId, "v-2"))).toBe(true);
      expect(await allowRetry(db, ref)).toBe(false); // created rows can never be reset
      const final = await pushDraftPos(db, mk(), { runId, userId: null, today: "2026-10-20" });
      expect(final.results.map((r) => r.status)).toEqual(["already_created", "created"]);
    });

    it("the SKU master's Distributor_ID is only a key into the vendor map, so the unconfirmed meaning can be fixed in one place", async () => {
      const runId = await approvedRun();
      await db.update(skus).set({ distributorId: "DIST002" }).where(eq(skus.skuId, "SKU001"));
      const plan = await planDraftPos(db, runId);
      expect(plan.pos.find((p) => p.vendorId === "v-2")?.lines.map((l) => l.skuId).sort()).toEqual(["SKU001", "SKU003", "SKU004"]);
    });
  });
});

describe("token store in the database", () => {
  it("persists across instances", async () => {
    const { db, close } = await createTestDb();
    const a = dbTokenStore(db);
    expect(await a.load()).toBeNull();
    await a.save({ token: "t", expiresAt: 123 });
    expect(await dbTokenStore(db).load()).toEqual({ token: "t", expiresAt: 123 });
    await a.save({ token: "t2", expiresAt: 456 });
    expect(await a.load()).toEqual({ token: "t2", expiresAt: 456 });
    await close();
  });
});
