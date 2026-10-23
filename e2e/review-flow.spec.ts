import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const USERS = {
  planner: { email: "raghav@freshroots.test" },
  sponsor: { email: "deepa@freshroots.test" },
  data: { email: "priya@freshroots.test" },
  admin: { email: "it@freshroots.test" },
} as const;
type UserKey = keyof typeof USERS;

/** Sign in the way a person does: ask for a link, open it, confirm. (The e2e server shows the link instead of emailing it.) */
async function login(page: Page, who: UserKey = "admin") {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await page.getByLabel("Email").fill(USERS[who].email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByTestId("link-sent")).toContainText("sign-in link is on its way");
  await page.getByTestId("dev-link").click();
  await page.getByTestId("confirm-signin").click();
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("shadow mode: sign in as the planner, run, review, decide; the export stays blocked", async ({ page }) => {
  await login(page, "planner");
  await expect(page.getByTestId("user-chip")).toContainText("Raghav · Planner");
  await expect(page.getByTestId("shadow-chip")).toBeVisible();
  await expect(page.getByText("No runs yet")).toBeVisible();

  await page.getByLabel("Run date").fill("2026-10-19");
  await page.getByTestId("run-now").click();
  await expect(page.getByTestId("headline")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("headline")).toContainText("15 SKUs reviewed for 19 Oct 2026");
  await expect(page.getByTestId("shadow-banner")).toBeVisible();
  await expect(page.locator('[data-testid^="row-"]')).toHaveCount(15);
  const row1 = page.getByTestId("row-SKU001");
  await expect(row1).toContainText("high_demand+stockout_risk.general");
  await expect(row1).toContainText("ratio 1.21/1.20");
  // the open PO came from Zoho (synced before the run), shown next to stock and not counted
  await expect(row1).toContainText("open PO 300 (not counted)");

  // keyboard approve, button approve, reject with a reason, edit with a reason
  await page.keyboard.press("j");
  await page.keyboard.press("a");
  await expect(row1).toHaveAttribute("data-status", "approved");
  await page.getByTestId("row-SKU003").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("row-SKU003")).toHaveAttribute("data-status", "approved");

  const rejectRow = page.getByTestId("row-SKU011");
  await rejectRow.getByRole("button", { name: "Reject" }).click();
  const rejectPanel = page.getByRole("form", { name: /Reject/ });
  await expect(rejectPanel.getByRole("button", { name: "Reject line" })).toBeDisabled();
  await rejectPanel.getByLabel("Why are you rejecting this line?").fill("Distributor already holds a full pallet");
  await rejectPanel.getByRole("button", { name: "Reject line" }).click();
  await expect(rejectRow).toHaveAttribute("data-status", "rejected");

  const editRow = page.getByTestId("row-SKU004");
  await editRow.getByRole("button", { name: "Edit" }).click();
  const editPanel = page.getByRole("form", { name: /Edit/ });
  await editPanel.getByLabel(/New quantity/).fill("300");
  await editPanel.getByLabel("Why are you changing the quantity?").fill("Festival promo planned for this week");
  await editPanel.getByRole("button", { name: "Save edit" }).click();
  await expect(editRow).toHaveAttribute("data-status", "edited");
  await expect(page.getByTestId("decided-count")).toContainText("4 of 15 decided");

  await page.getByLabel("Filter by status").selectOption("rejected");
  await expect(page.locator('[data-testid^="row-"]')).toHaveCount(1);
  await page.getByLabel("Filter by status").selectOption("all");

  // the export is blocked in shadow mode: the button and the API
  await expect(page.getByTestId("export-link")).toBeDisabled();
  await expect(page.getByTestId("export-link")).toContainText("shadow mode");
  const api = await page.request.get("/api/export/approved?run=00000000-0000-0000-0000-000000000000");
  expect(api.status()).toBe(423);
  expect((await api.json()).reason).toBe("shadow");

  // the planner can change rules but not the mode
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByTestId("op-mode-live")).toBeDisabled();
  await expect(page.getByTestId("cfg-indicator_kill_pct")).toBeDisabled();
  await expect(page.getByTestId("cfg-cover_min_weeks")).toBeEnabled();

  await page.goto("/");
  await expect(page.getByTestId("decided-count")).toContainText("4 of 15 decided");
});

test("roles: each role can and cannot do what it should", async ({ browser }) => {
  const as = async (who: UserKey) => {
    const ctx = await browser.newContext({ baseURL: "http://localhost:3200" });
    const page = await ctx.newPage();
    await login(page, who);
    return { ctx, page };
  };

  // data analyst: read-only Review, can upload
  const priya = await as("data");
  await expect(priya.page.getByTestId("row-SKU001")).toBeVisible();
  await expect(priya.page.getByTestId("row-SKU001").getByRole("button", { name: "Approve" })).toHaveCount(0);
  await priya.page.getByRole("link", { name: "Data" }).click();
  // open POs are managed by the Zoho connector, so the CSV upload is off for them
  await expect(priya.page.getByTestId("managed-open_pos")).toContainText("Managed by the Zoho connector");
  expect((await priya.page.request.post("/api/ingest/open_pos", { data: "SKU_ID,Open_PO_Qty,Expected_Date\n", headers: { "content-type": "text/csv" } })).status()).toBe(409);
  const card = priya.page.getByTestId("upload-festival_calendar");
  await card.getByLabel("Festival calendar CSV file").setInputFiles({ name: "fc.csv", mimeType: "text/csv", buffer: Buffer.from("Year,Month,Year_Month,Is_Festival_Month\n2026,12,2026-12,FALSE\n") });
  await card.getByRole("button", { name: "Upload" }).click();
  await expect(card.getByText("1 accepted", { exact: true })).toBeVisible();
  expect((await priya.page.request.post("/api/recommendations/00000000-0000-0000-0000-000000000000/decision", { data: { action: "approve" } })).status()).toBe(403);
  await priya.ctx.close();

  // planner: cannot upload; sponsor: cannot decide or change rules
  const raghav = await as("planner");
  expect((await raghav.page.request.post("/api/ingest/sales", { data: "SKU_ID,Week,Units_Sold\n", headers: { "content-type": "text/csv" } })).status()).toBe(403);
  await raghav.ctx.close();
  const deepa = await as("sponsor");
  await expect(deepa.page.getByTestId("row-SKU003").getByRole("button", { name: "Approve" })).toHaveCount(0);
  expect((await deepa.page.request.get("/api/export/approved?run=00000000-0000-0000-0000-000000000000")).status()).toBe(403);
  await deepa.page.getByRole("link", { name: "Settings" }).click();
  await expect(deepa.page.getByTestId("op-mode-live")).toBeEnabled();
  await expect(deepa.page.getByTestId("cfg-indicator_kill_pct")).toBeEnabled();
  await expect(deepa.page.getByTestId("cfg-cover_min_weeks")).toBeDisabled();
  await deepa.ctx.close();
});

test("go-live walk-through: the gate holds until the checklist and 8 weeks of outcomes exist", async ({ browser }) => {
  const sponsorCtx = await browser.newContext({ baseURL: "http://localhost:3200" });
  const deepa = await sponsorCtx.newPage();
  await login(deepa, "sponsor");

  // 1. the sponsor ticks every item
  await deepa.getByRole("link", { name: "Health" }).click();
  await expect(deepa.getByTestId("golive-section")).toContainText("still open");
  for (const key of ["backtest_reviewed", "shadow_reviewed", "kill_thresholds_confirmed", "loss_method_recorded", "baseline_weekly_ready", "kill_drill_done", "procurement_agreed", "hosting_signed_off"]) {
    const box = deepa.getByTestId(`golive-${key}`).getByRole("checkbox");
    await box.click();
    await expect(deepa.getByTestId(`golive-${key}`)).toContainText("Ticked by Deepa");
  }

  // 2. going live is still refused: no weekly outcomes yet
  await deepa.getByRole("link", { name: "Settings" }).click();
  await deepa.getByTestId("op-mode-live").check();
  await deepa.getByTestId("config-note").fill("Go live on the agreed date");
  await deepa.getByTestId("save-config").click();
  await expect(deepa.locator("p.form-error")).toContainText("go-live checklist is not complete");
  await expect(deepa.locator("p.form-error")).toContainText("8 weeks of weekly outcomes");

  // 3. the data analyst enters 8 weeks of outcomes from her weekly report
  const priyaCtx = await browser.newContext({ baseURL: "http://localhost:3200" });
  const priya = await priyaCtx.newPage();
  await login(priya, "data");
  await priya.getByRole("link", { name: "Outcomes" }).click();
  const csv = ["Week,Stockout_Incidents,Overstock_Value_INR", ...Array.from({ length: 8 }, (_, i) => `2026-W${34 + i},${10 + i},${1_000_000 + i * 10_000}`)].join("\n");
  await priya.getByLabel("Weekly outcomes CSV").setInputFiles({ name: "weekly.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await priya.getByRole("button", { name: "Upload CSV" }).click();
  await expect(priya.getByText("8 weeks saved, 0 rows rejected.")).toBeVisible();
  await priya.getByRole("textbox", { name: "Month" }).fill("2026-09");
  await priya.getByLabel("Stockout loss (₹)").fill("1200000");
  await priya.getByLabel("Write-offs (₹)").fill("400000");
  await priya.getByLabel("Loss-calculation method").fill("Lost units x margin from SAP out-of-stock days");
  await priya.getByRole("button", { name: "Save month" }).click();
  await expect(priya.getByTestId("monthly-table")).toContainText("2026-09");
  await priyaCtx.close();

  // 4. now the sponsor can go live; shadow labels go, the baseline is frozen
  await deepa.getByTestId("save-config").click();
  await expect(deepa.getByText(/Saved as version \d+/)).toBeVisible();
  await deepa.goto("/");
  await expect(deepa.getByTestId("shadow-chip")).toHaveCount(0);
  await expect(deepa.getByTestId("shadow-banner")).toHaveCount(0);
  await deepa.getByRole("link", { name: "Outcomes" }).click();
  await expect(deepa.getByTestId("frozen-table").locator("tbody tr")).toHaveCount(8);
  await deepa.getByRole("link", { name: "Health" }).click();
  await expect(deepa.getByTestId("kill-section")).toContainText("LIVE mode");
  await sponsorCtx.close();
});

test("live mode: the export preview lists exactly the decided lines and the download matches", async ({ page }) => {
  await login(page, "planner");
  await expect(page.getByTestId("shadow-chip")).toHaveCount(0);
  await page.getByTestId("export-link").click();
  await expect(page.getByRole("heading", { name: "Export preview" })).toBeVisible();
  await expect(page.getByTestId("export-preview-table").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByTestId("export-preview-table")).not.toContainText("SKU011");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-csv").click()]);
  const csv = (await readFile(await download.path(), "utf8")).trim().split(/\r?\n/);
  expect(csv[0]).toBe("SKU_ID,SKU_Name,Quantity,Unit,Distributor_ID,Run_ID,Approved_At");
  expect(csv.slice(1).map((l) => l.split(",").slice(0, 3).join(","))).toEqual(["SKU001,Masala Peanuts 200g,900", "SKU003,Poha Thick 500g,500", "SKU004,Fresh Bhakarwadi 250g,300"]);
});

test("kill switch: a manual stop makes everything read-only, and only the sponsor can clear it, with a note", async ({ browser }) => {
  const raghavCtx = await browser.newContext({ baseURL: "http://localhost:3200" });
  const raghav = await raghavCtx.newPage();
  await login(raghav, "planner");
  await raghav.getByTestId("stop-button").click();
  await raghav.getByTestId("stop-reason").fill("Supplier strike: orders cannot be placed");
  await raghav.getByTestId("stop-confirm").click();
  await expect(raghav.getByTestId("kill-banner")).toContainText("Kill switch is ON");
  await expect(raghav.getByTestId("kill-banner")).toContainText("Supplier strike");
  await expect(raghav.getByTestId("killed-chip")).toBeVisible();

  await expect(raghav.getByTestId("run-now")).toBeDisabled();
  await expect(raghav.getByTestId("row-SKU002").getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(raghav.getByTestId("export-link")).toContainText("kill switch");
  expect((await raghav.request.get("/api/export/approved?run=00000000-0000-0000-0000-000000000000")).status()).toBe(423);
  expect((await raghav.request.post("/api/run", { data: { asOf: "2026-10-19" } })).status()).toBe(423);
  expect((await raghav.request.post("/api/kill/clear", { data: { note: "I will just clear it" } })).status()).toBe(403);

  await raghav.getByRole("link", { name: "Health" }).click();
  await expect(raghav.getByTestId("kill-status")).toContainText("ON");
  await expect(raghav.getByTestId("clear-kill")).toHaveCount(0);
  await expect(raghav.getByTestId("overall-status")).toHaveText("stopped");
  await raghavCtx.close();

  const deepaCtx = await browser.newContext({ baseURL: "http://localhost:3200" });
  const deepa = await deepaCtx.newPage();
  await login(deepa, "sponsor");
  await deepa.getByRole("link", { name: "Health" }).click();
  await expect(deepa.getByTestId("clear-kill")).toBeDisabled();
  await deepa.getByTestId("clear-note").fill("Supplier is back and confirmed in writing");
  await deepa.getByTestId("clear-kill").click();
  await expect(deepa.getByTestId("kill-status")).toHaveText("Off");
  await expect(deepa.getByTestId("kill-banner")).toHaveCount(0);
  await expect(deepa.getByText(/cleared by Deepa/)).toBeAttached();
  await deepaCtx.close();
});

test("Zoho: sync, map vendors, create draft purchase orders once, never issue them", async ({ browser }) => {
  const state = async (page: Page) => (await (await page.request.get("http://localhost:4010/__state")).json()) as { pos: { purchaseorder_number: string; status: string; vendor_id: string; line_items: { item_id: string; quantity: number }[] }[]; calls: string[] };

  // admin: sync, then map the distributors on the approved lines to Zoho vendors
  const adminCtx = await browser.newContext({ baseURL: "http://localhost:3200" });
  const admin = await adminCtx.newPage();
  await login(admin, "admin");
  await admin.getByRole("link", { name: "Zoho" }).click();
  await admin.getByTestId("zoho-sync").click();
  await expect(admin.getByText(/Synced: 1 open PO lines/)).toBeVisible();
  await expect(admin.getByTestId("zoho-last")).toHaveText("OK");
  await admin.getByLabel("Zoho vendor for D001").selectOption("vendor-A");
  await expect(admin.getByText("Vendor mapping saved.")).toBeVisible();
  await admin.getByLabel("Zoho vendor for D003").selectOption("vendor-B");
  await expect(admin.getByLabel("Zoho vendor for D003")).toHaveValue("vendor-B");

  // before the sponsor switches it on, nothing can be created
  await admin.goto("/");
  await admin.getByTestId("export-link").click();
  await expect(admin.getByTestId("zoho-push-panel")).toContainText("switched off");
  await expect(admin.getByTestId("zoho-push")).toBeDisabled();
  expect((await admin.request.post("/api/zoho/push", { data: { runId: new URL(admin.url()).searchParams.get("run") } })).status()).toBe(423);

  // the sponsor (admin here) switches the feature on in Settings
  await admin.getByRole("link", { name: "Settings" }).click();
  await admin.getByTestId("cfg-zoho_push_enabled").check();
  await admin.getByTestId("config-note").fill("Allow draft POs in Zoho");
  await admin.getByTestId("save-config").click();
  await expect(admin.getByText(/Saved as version \d+/)).toBeVisible();

  // the planner creates the drafts from the export preview
  const raghavCtx = await browser.newContext({ baseURL: "http://localhost:3200" });
  const raghav = await raghavCtx.newPage();
  await login(raghav, "planner");
  await raghav.getByTestId("export-link").click();
  await expect(raghav.getByTestId("zoho-po-vendor-A")).toContainText("Sahyadri Supplies");
  await expect(raghav.getByTestId("zoho-po-vendor-A")).toContainText("1400 units".replace("1400", "1,400"));
  await expect(raghav.getByTestId("zoho-po-vendor-B")).toContainText("Fresh Bhakarwadi 250g");
  raghav.once("dialog", (d) => void d.accept());
  await raghav.getByTestId("zoho-push").click();
  await expect(raghav.getByTestId("zoho-results")).toContainText("Sahyadri Supplies: created");
  await expect(raghav.getByTestId("zoho-results")).toContainText("Deccan Wholesale: created");

  const s1 = await state(raghav);
  const drafts = s1.pos.filter((p) => p.purchaseorder_number.startsWith("FR-"));
  expect(drafts.map((p) => [p.status, p.vendor_id]).sort()).toEqual([["draft", "vendor-A"], ["draft", "vendor-B"]]);
  expect(drafts.find((p) => p.vendor_id === "vendor-A")?.line_items.map((l) => [l.item_id, l.quantity])).toEqual([["item-SKU001", 900], ["item-SKU003", 500]]);
  expect(s1.calls.some((c) => /issue|approve|submit|status/i.test(c))).toBe(false);

  // pressing it again creates nothing new
  raghav.once("dialog", (d) => void d.accept());
  await raghav.getByTestId("zoho-push").click();
  await expect(raghav.getByTestId("zoho-results")).toContainText("already created");
  expect((await state(raghav)).pos.filter((p) => p.purchaseorder_number.startsWith("FR-"))).toHaveLength(2);

  // the Zoho page lists them, and a shadow-mode or killed system could not have created them
  await admin.getByRole("link", { name: "Zoho" }).click();
  await expect(admin.getByTestId("push-log")).toContainText("created");
  await admin.getByRole("link", { name: "Health" }).click();
  await expect(admin.getByTestId("zoho-health")).toContainText("synced");

  // the webhook nudge: wrong secret refused, right secret accepted
  expect((await raghav.request.post("/api/zoho/webhook", { headers: { "x-zoho-webhook-secret": "wrong-wrong-wrong-wrong" } })).status()).toBe(401);
  expect([202]).toContain((await raghav.request.post("/api/zoho/webhook", { headers: { "x-zoho-webhook-secret": "e2e-webhook-secret-0123456789" } })).status());
  await adminCtx.close();
  await raghavCtx.close();
});

test("theme toggle switches and persists", async ({ page }) => {
  await login(page);
  const html = page.locator("html");
  await page.getByTestId("theme-toggle").click();
  const first = await html.getAttribute("data-theme");
  expect(["light", "dark"]).toContain(first);
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", first as string);
});

test("reduced motion shows final states immediately, with no movement", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", baseURL: "http://localhost:3200" });
  const page = await context.newPage();
  await login(page);
  await expect(page.getByTestId("headline")).toBeVisible();
  const state = await page.evaluate(() => {
    const nums = [...document.querySelectorAll("[data-num]")].map((e) => e.textContent);
    const fill = getComputedStyle(document.querySelector("[data-fill]") as Element).transform;
    const row = getComputedStyle(document.querySelector(".row[data-testid]") as Element);
    return { nums, fill, rowOpacity: row.opacity, rowTransform: row.transform, split: document.querySelectorAll("[data-line] > div").length };
  });
  expect(state.nums[0]).toBe("3.4");
  expect(state.fill).toBe("none");
  expect(state.rowOpacity).toBe("1");
  expect(state.rowTransform).toBe("none");
  expect(state.split).toBe(0);
  await context.close();
});

test("settings, health, outcomes, shadow comparison and backtest", async ({ page }) => {
  await login(page, "admin");

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("Open question for Raghav")).toBeVisible();
  await expect(page.getByTestId("save-config")).toBeDisabled();
  await page.getByTestId("mode-baseline_only").check();
  await expect(page.getByTestId("config-diff")).toContainText("Festival uplift mode");
  await page.getByTestId("preview-impact").click();
  await expect(page.getByTestId("impact-count")).toHaveText("1");
  await expect(page.getByTestId("impact-result")).toContainText("SKU001");
  await page.getByTestId("config-note").fill("Trying the baseline-only reading of the festival rule");
  await page.getByTestId("save-config").click();
  await expect(page.getByText(/Saved as version \d+/)).toBeVisible();
  await expect(page.getByTestId("version-1")).toBeVisible();

  await page.getByRole("link", { name: "Health" }).click();
  await expect(page.getByTestId("system-status")).toContainText("reachable");
  await expect(page.getByTestId("kill-criteria")).toContainText("Quarterly loss");
  await expect(page.getByTestId("kill-criteria")).toContainText("Rubber-stamp warning");
  await expect(page.getByTestId("override-log")).toContainText("Distributor already holds a full pallet");
  await expect(page.getByTestId("override-log")).toContainText("Festival promo planned for this week");
  await page.getByLabel("Search the override log").fill("pallet");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("override-log").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("baseline-table")).toContainText("₹18.0 lakh to ₹22.0 lakh");

  await page.getByRole("link", { name: "Shadow" }).click();
  await page.getByLabel("Forecast CSV").setInputFiles({ name: "raghav.csv", mimeType: "text/csv", buffer: Buffer.from("SKU_ID,Period,Qty\nSKU001,2026-10,900\nSKU003,2026-10,0\n") });
  await page.getByTestId("run-shadow").click();
  await expect(page.getByTestId("shadow-results")).toBeVisible();
  await expect(page.getByTestId("shadow-table")).toContainText("SKU003");

  await page.getByRole("link", { name: "Backtest" }).click();
  await expect(page.getByText("only 16 weeks of sales and one festival month")).toBeVisible();
  await expect(page.getByTestId("festival-check")).toContainText("Festival uplift check");
  await page.getByLabel("First week").selectOption("2026-W42");
  await page.getByLabel("Last week").selectOption("2026-W42");
  await page.getByTestId("run-backtest").click();
  await expect(page.getByTestId("no-orders-note")).toBeVisible();
  await expect(page.getByTestId("backtest-table").locator("tr", { hasText: "SKU001" })).toContainText("reorder now");
});

test("data page: a deliberately broken CSV is rejected row by row with reasons", async ({ page }) => {
  await login(page, "data");
  await page.getByRole("link", { name: "Data" }).click();
  await expect(page.getByTestId("fresh-stock")).toHaveText("2026-10-19");
  const card = page.getByTestId("upload-sales");
  await card.getByLabel("Weekly sales CSV file").setInputFiles("fixtures/broken_sales.csv");
  await card.getByRole("button", { name: "Upload" }).click();
  await expect(card.getByText("3 accepted", { exact: true })).toBeVisible();
  await expect(card.getByText("7 rejected", { exact: true })).toBeVisible();
  await expect(card.locator("table tbody tr")).toHaveCount(7);
  await expect(card).toContainText("Week must be an ISO week like 2026-W42");
  await expect(card).toContainText("Duplicate of row 8");
  await expect(card).toContainText("SKU777 is not in the SKU master");
});

test("400 more SKUs: the table is windowed and still navigable", async ({ page }) => {
  await login(page, "admin");
  const post = (kind: string, csv: string) => page.request.post(`/api/ingest/${kind}`, { data: csv, headers: { "content-type": "text/csv" } });
  const ids = Array.from({ length: 400 }, (_, i) => `BULK${String(i + 1).padStart(3, "0")}`);
  const weeks = Array.from({ length: 12 }, (_, i) => `2026-W${31 + i}`);
  await post("sku_master", ["SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID", ...ids.map((id) => `${id},Bulk item ${id},Staples,Low,100,case,D001`)].join("\n"));
  await post("sales", ["SKU_ID,Week,Units_Sold", ...ids.flatMap((id, i) => weeks.map((w) => `${id},${w},${50 + (i % 7) * 10}`))].join("\n"));
  const inv = await post("inventory", ["SKU_ID,Location,Units_On_Hand,As_Of_Date", ...ids.map((id, i) => `${id},Pune Central Warehouse,${300 + (i % 11) * 120},2026-10-19`)].join("\n"));
  expect((await inv.json()).accepted).toBe(400);

  await page.reload();
  await page.getByLabel("Run date").fill("2026-10-20");
  await page.getByTestId("run-now").click();
  await expect(page.getByTestId("headline")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("tab", { name: /Recommendations/ })).toContainText("415");

  const scroller = page.getByTestId("virtual-scroller");
  await expect(scroller).toBeVisible();
  expect(await page.locator('[data-testid^="row-"]').count()).toBeLessThan(40);
  for (let i = 0; i < 30; i += 1) await page.keyboard.press("j");
  await expect(page.locator('[data-testid^="row-"][aria-selected="true"]')).toHaveCount(1);
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('[data-testid^="row-"]').last()).toBeVisible();
  expect(await page.locator('[data-testid^="row-"]').count()).toBeLessThan(40);
  await page.getByLabel("Filter by flag").selectOption("OVERSTOCK_RISK");
  await expect(page.getByTestId("virtual-scroller")).toHaveCount(0);
});

test("sign-in links: one use, no account enumeration, expired or invented links refused", async ({ page, request }) => {
  const ask = async (email: string) => (await request.post("/api/auth/request-link", { data: { email } })).json() as Promise<{ message: string; devLink?: string }>;
  const known = await ask("raghav@freshroots.test");
  const unknown = await ask("stranger@example.com");
  expect(unknown.message).toBe(known.message); // same answer either way
  expect(unknown.devLink).toBeUndefined();
  expect(known.devLink).toMatch(/\/login\/verify\?token=/);
  expect((await request.post("/api/auth/request-link", { data: { email: "not an email" } })).status()).toBe(400);

  // opening the link alone does not use it up (scanners); confirming does, once
  await page.goto(known.devLink as string);
  await expect(page.getByRole("heading", { name: "Confirm sign-in" })).toBeVisible();
  await page.goto(known.devLink as string);
  await page.getByTestId("confirm-signin").click();
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await page.context().clearCookies();
  await page.goto(known.devLink as string);
  await page.getByTestId("confirm-signin").click();
  await expect(page.getByText("expired or was already used")).toBeVisible();

  await page.goto("/login/verify?token=" + "A".repeat(43));
  await page.getByTestId("confirm-signin").click();
  await expect(page.getByText("expired or was already used")).toBeVisible();
  expect((await request.post("/api/auth/login", { data: { email: "raghav@freshroots.test", password: "x" } })).status()).toBe(401); // the old password route is gone
});

test("API access: unauthenticated is refused, secrets are required, health and kill-check answer", async ({ request }) => {
  expect((await request.get("/api/export/approved?run=00000000-0000-0000-0000-000000000000")).status()).toBe(401);
  expect((await request.get("/api/health")).status()).toBe(401);
  expect((await request.get("/api/cron/run")).status()).toBe(401);
  expect((await request.get("/api/cron/run", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  const bearer = { authorization: "Bearer e2e-cron-secret-0123456789" };
  const health = await request.get("/api/health", { headers: bearer });
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ db: { ok: true }, mode: "live" });
  const kill = await request.get("/api/cron/kill-check", { headers: bearer });
  expect(kill.status()).toBe(200);
  expect(await kill.json()).toHaveProperty("tripped", false);
  expect((await request.get("/api/cron/resume", { headers: bearer })).status()).toBe(200);
  const ok = await request.get("/api/cron/run", { headers: bearer });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toHaveProperty("runId");
});
