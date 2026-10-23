import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

/**
 * The marker's path: open the link, nothing to sign in to, and the whole case can be exercised as a guest administrator,
 * as in real use: a run, line-by-line decisions, an export, outcomes feeding the kill check, and the kill switch.
 */
test.describe.configure({ mode: "serial" });

test("a reviewer with only the link can run, review, export, and take the kill check to a stop", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.getByTestId("guest-banner")).toContainText("Open access");
  await expect(page.getByTestId("user-chip")).toHaveText("Guest · open access");
  await expect(page.getByText("No runs yet")).toBeVisible();

  // run and review
  await page.getByLabel("Run date").fill("2026-10-19");
  await page.getByTestId("run-now").click();
  await expect(page.getByTestId("headline")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("row-SKU001")).toContainText("high_demand+stockout_risk.general");
  await page.getByTestId("row-SKU003").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("row-SKU003")).toHaveAttribute("data-status", "approved");
  await page.getByTestId("row-SKU011").getByRole("button", { name: "Reject" }).click();
  await page.getByRole("form", { name: /Reject/ }).getByLabel("Why are you rejecting this line?").fill("Pallet already on hand");
  await page.getByRole("form", { name: /Reject/ }).getByRole("button", { name: "Reject line" }).click();
  await expect(page.getByTestId("row-SKU011")).toHaveAttribute("data-status", "rejected");
  await page.getByTestId("row-SKU004").getByRole("button", { name: "Edit" }).click();
  await page.getByRole("form", { name: /Edit/ }).getByLabel(/New quantity/).fill("300");
  await page.getByRole("form", { name: /Edit/ }).getByLabel("Why are you changing the quantity?").fill("Festival promo planned");
  await page.getByRole("form", { name: /Edit/ }).getByRole("button", { name: "Save edit" }).click();
  await expect(page.getByTestId("row-SKU004")).toHaveAttribute("data-status", "edited");

  // export: available straight away, preview first, then only the decided lines
  await page.getByTestId("export-link").click();
  await expect(page.getByTestId("export-preview-table").locator("tbody tr")).toHaveCount(2);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-csv").click()]);
  const csv = (await readFile(await download.path(), "utf8")).trim().split(/\r?\n/);
  expect(csv.slice(1).map((l) => l.split(",").slice(0, 3).join(","))).toEqual(["SKU003,Freshroots Brown Rice 1kg,300", "SKU004,Freshroots Almond Milk 500ml,300"]);

  // the sample outcomes are already loaded (npm run seed), so the kill criteria show real baseline figures
  await page.getByRole("link", { name: "Health" }).click();
  await expect(page.getByTestId("measure-since")).toContainText("2026-10-12");
  await expect(page.getByTestId("kill-criteria")).toContainText("Weekly stockout incidents");

  // feed bad weeks and run the check twice: warning, then stop
  await page.getByRole("link", { name: "Outcomes" }).click();
  await expect(page.getByTestId("frozen-table").locator("tbody tr")).toHaveCount(8);
  await page.getByLabel("Weekly outcomes CSV").setInputFiles("fixtures/outcomes_breach.csv");
  await page.getByRole("button", { name: "Upload CSV" }).click();
  await expect(page.getByText("4 weeks saved, 0 rows rejected.")).toBeVisible();
  await page.getByRole("link", { name: "Health" }).click();
  await page.getByTestId("run-kill-check").click();
  await expect(page.getByTestId("kill-check-result")).toContainText("warnings");
  await page.getByRole("link", { name: "Outcomes" }).click();
  await page.getByLabel("Weekly outcomes CSV").setInputFiles("fixtures/outcomes_breach_next_week.csv");
  await page.getByRole("button", { name: "Upload CSV" }).click();
  await expect(page.getByText("1 weeks saved, 0 rows rejected.")).toBeVisible();
  await page.getByRole("link", { name: "Health" }).click();
  await page.getByTestId("run-kill-check").click();
  await expect(page.getByTestId("kill-check-result")).toContainText("stopped");
  await expect(page.getByTestId("kill-banner")).toContainText("Weekly stockout incidents");
  await expect(page.getByTestId("export-link")).toHaveCount(0); // Health has no export; the next page proves read-only
  await page.goto("/");
  await expect(page.getByTestId("run-now")).toBeDisabled();
  await expect(page.getByTestId("export-link")).toContainText("kill switch");

  // clear it with a note, and press Stop by hand too
  await page.getByRole("link", { name: "Health" }).click();
  await page.getByTestId("clear-note").fill("Reviewed, safe to restart");
  await page.getByTestId("clear-kill").click();
  await expect(page.getByTestId("kill-status")).toHaveText("Off");
  await page.getByTestId("stop-button").click();
  await page.getByTestId("stop-reason").fill("Demonstrating the manual stop");
  await page.getByTestId("stop-confirm").click();
  await expect(page.getByTestId("kill-banner")).toContainText("Demonstrating the manual stop");
  await page.getByTestId("clear-note").fill("Demonstration finished");
  await page.getByTestId("clear-kill").click();
  await expect(page.getByTestId("kill-status")).toHaveText("Off");

  // open access is for people, not for machines: the scheduled-job endpoints still need their secret
  expect((await request.get("/api/cron/run")).status()).toBe(401);
  expect((await request.get("/api/cron/kill-check")).status()).toBe(401);
  expect((await request.post("/api/zoho/webhook")).status()).not.toBe(200);
});
