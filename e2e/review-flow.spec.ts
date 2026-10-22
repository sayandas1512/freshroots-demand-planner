import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const USERS = {
  planner: { email: "raghav@freshroots.test", password: "planner-pass-123" },
  sponsor: { email: "deepa@freshroots.test", password: "sponsor-pass-123" },
  data: { email: "priya@freshroots.test", password: "data-pass-12345" },
  admin: { email: "it@freshroots.test", password: "admin-pass-1234" },
} as const;
type UserKey = keyof typeof USERS;

async function login(page: Page, who: UserKey = "admin") {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(USERS[who].email);
  await page.getByLabel("Password").fill(USERS[who].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("log in, run, review, decide, export approved lines only", async ({ page }) => {
  await login(page);

  // a fresh database has no runs yet
  await expect(page.getByText("No runs yet")).toBeVisible();

  // trigger a run for the sample as-of date and watch real progress
  await page.getByLabel("Run date").fill("2026-10-19");
  await page.getByTestId("run-now").click();
  await expect(page.getByTestId("headline")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("headline")).toContainText("15 SKUs reviewed for 19 Oct 2026");
  await expect(page.getByTestId("headline")).toContainText("Template");
  await expect(page.locator('[data-testid^="row-"]')).toHaveCount(15);
  await expect(page.getByTestId("decided-count")).toContainText("0 of 15 decided");

  // the sheet shows the rule that fired and the numbers
  const row1 = page.getByTestId("row-SKU001");
  await expect(row1).toContainText("high_demand+stockout_risk.general");
  await expect(row1).toContainText("Urgent");
  await expect(row1).toContainText("ratio 1.21/1.20");

  // 1. keyboard: J selects the first line (SKU001, urgent), A approves it
  await page.keyboard.press("j");
  await expect(row1).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("a");
  await expect(row1).toHaveAttribute("data-status", "approved");

  // 2. approve with the button
  await page.getByTestId("row-SKU003").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("row-SKU003")).toHaveAttribute("data-status", "approved");

  // 3. reject needs a reason
  const rejectRow = page.getByTestId("row-SKU011");
  await rejectRow.getByRole("button", { name: "Reject" }).click();
  const rejectPanel = page.getByRole("form", { name: /Reject/ });
  await expect(rejectPanel.getByRole("button", { name: "Reject line" })).toBeDisabled();
  await rejectPanel.getByLabel("Why are you rejecting this line?").fill("Distributor already holds a full pallet");
  await rejectPanel.getByRole("button", { name: "Reject line" }).click();
  await expect(rejectRow).toHaveAttribute("data-status", "rejected");

  // 4. edit the quantity with a reason
  const editRow = page.getByTestId("row-SKU004");
  await editRow.getByRole("button", { name: "Edit" }).click();
  const editPanel = page.getByRole("form", { name: /Edit/ });
  await editPanel.getByLabel(/New quantity/).fill("300");
  await editPanel.getByLabel("Why are you changing the quantity?").fill("Festival promo planned for this week");
  await editPanel.getByRole("button", { name: "Save edit" }).click();
  await expect(editRow).toHaveAttribute("data-status", "edited");
  await expect(editRow).toContainText("300");

  await expect(page.getByTestId("decided-count")).toContainText("4 of 15 decided");
  await expect(page.getByTestId("live-region")).toContainText(/quantity changed to 300/);

  // 5. filters
  await page.getByLabel("Filter by status").selectOption("rejected");
  await expect(page.locator('[data-testid^="row-"]')).toHaveCount(1);
  await page.getByLabel("Filter by status").selectOption("all");
  await expect(page.locator('[data-testid^="row-"]')).toHaveCount(15);

  // 6. export contains only approved and edited lines, using the final quantity
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-link").click()]);
  const path = await download.path();
  const csv = (await readFile(path, "utf8")).trim().split(/\r?\n/);
  expect(csv[0]).toBe("SKU_ID,SKU_Name,Quantity,Unit,Distributor_ID,Run_ID,Approved_At");
  expect(csv.slice(1).map((l) => l.split(",").slice(0, 3).join(","))).toEqual(["SKU001,Masala Peanuts 200g,900", "SKU003,Poha Thick 500g,500", "SKU004,Fresh Bhakarwadi 250g,300"]);
  expect(csv.join("\n")).not.toContain("SKU011");

  // decisions survive a reload
  await page.reload();
  await expect(page.getByTestId("decided-count")).toContainText("4 of 15 decided");
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

test("settings: preview impact, save a version; health: override log; backtest", async ({ page }) => {
  await login(page);

  // Settings: baseline_only changes exactly one line on the sample (SKU001 loses HIGH_DEMAND)
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Open question for Raghav")).toBeVisible();
  await expect(page.getByTestId("save-config")).toBeDisabled();
  await page.getByTestId("mode-baseline_only").check();
  await expect(page.getByTestId("config-diff")).toContainText("Festival uplift mode");
  await page.getByTestId("preview-impact").click();
  await expect(page.getByTestId("impact-count")).toHaveText("1");
  await expect(page.getByTestId("impact-result")).toContainText("SKU001");
  await expect(page.getByTestId("impact-result")).toContainText("Nothing was saved");
  await page.getByTestId("config-note").fill("Trying the baseline-only reading of the festival rule");
  await page.getByTestId("save-config").click();
  await expect(page.getByText("Saved as version 2")).toBeVisible();
  await expect(page.getByTestId("version-2")).toContainText("baseline-only");
  await expect(page.getByTestId("version-1")).toBeVisible();

  // Health: the override log holds the reasons given earlier, and is searchable
  await page.getByRole("link", { name: "Health" }).click();
  await expect(page.getByRole("heading", { name: "Health" })).toBeVisible();
  await expect(page.getByTestId("override-log")).toContainText("Distributor already holds a full pallet");
  await expect(page.getByTestId("override-log")).toContainText("Festival promo planned for this week");
  await page.getByLabel("Search the override log").fill("pallet");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("override-log").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("baseline-table")).toContainText("₹18.0 lakh to ₹22.0 lakh");

  // Backtest: with no orders file only the system's lines are shown, and it says so
  await page.getByRole("link", { name: "Backtest" }).click();
  await expect(page.getByText("only 16 weeks of sales and one festival month")).toBeVisible();
  await page.getByLabel("First week").selectOption("2026-W42");
  await page.getByLabel("Last week").selectOption("2026-W42");
  await page.getByTestId("run-backtest").click();
  await expect(page.getByTestId("no-orders-note")).toBeVisible();
  await expect(page.getByTestId("backtest-table")).toContainText("SKU001");
  // version 2 (baseline_only) is now active, so SKU001 is no longer high-demand: standard quantity, not 1.5x
  await expect(page.getByTestId("backtest-table").locator("tr", { hasText: "SKU001" })).toContainText("reorder now");
});

test("data page: a deliberately broken CSV is rejected row by row with reasons", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Data" }).click();
  await expect(page.getByTestId("fresh-stock")).toHaveText("2026-10-19");
  const card = page.getByTestId("upload-sales");
  await card.getByLabel("Weekly sales CSV file").setInputFiles("fixtures/broken_sales.csv");
  await card.getByRole("button", { name: "Upload" }).click();
  await expect(card.getByText("3 accepted", { exact: true })).toBeVisible();
  await expect(card.getByText("7 rejected", { exact: true })).toBeVisible();
  const rejects = card.locator("table tbody tr");
  await expect(rejects).toHaveCount(7);
  await expect(card).toContainText("Week must be an ISO week like 2026-W42");
  await expect(card).toContainText("Duplicate of row 8");
  await expect(card).toContainText("SKU777 is not in the SKU master");
});

test("400 more SKUs: the table is windowed and still navigable", async ({ page }) => {
  await login(page);
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

  // J/K still move through the list and keep the selected row mounted
  for (let i = 0; i < 30; i += 1) await page.keyboard.press("j");
  const selected = page.locator('[data-testid^="row-"][aria-selected="true"]');
  await expect(selected).toHaveCount(1);

  // scrolling to the end mounts the last rows
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('[data-testid^="row-"]').last()).toBeVisible();
  expect(await page.locator('[data-testid^="row-"]').count()).toBeLessThan(40);

  // a filter that cuts the list below 100 returns to the plain list
  await page.getByLabel("Filter by flag").selectOption("OVERSTOCK_RISK");
  await expect(page.getByTestId("virtual-scroller")).toHaveCount(0);
});

test("unauthenticated API access is refused and the cron route needs its secret", async ({ request }) => {
  expect((await request.get("/api/export/approved?run=00000000-0000-0000-0000-000000000000")).status()).toBe(401);
  expect((await request.get("/api/cron/run")).status()).toBe(401);
  expect((await request.get("/api/cron/run", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  const ok = await request.get("/api/cron/run", { headers: { authorization: "Bearer e2e-cron-secret-0123456789" } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toHaveProperty("runId");
});
