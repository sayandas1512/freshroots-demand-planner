import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

/**
 * The marker's path: open the link, nothing to sign in to, and every part of the workflow works as a guest administrator.
 */
test.describe.configure({ mode: "serial" });

test("a reviewer with only the link can run, review, go live, export and use the kill switch", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.getByTestId("guest-banner")).toContainText("Open access");
  await expect(page.getByTestId("user-chip")).toHaveText("Guest · open access");
  await expect(page.getByText("No runs yet")).toBeVisible();

  // run and review
  await page.getByLabel("Run date").fill("2026-10-19");
  await page.getByTestId("run-now").click();
  await expect(page.getByTestId("headline")).toBeVisible({ timeout: 60_000 });
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

  // the system starts in shadow mode, so the export is blocked until go-live
  await expect(page.getByTestId("export-link")).toContainText("shadow mode");

  // go live: tick the checklist, enter 8 weeks of outcomes, switch the mode
  await page.getByRole("link", { name: "Health" }).click();
  for (const key of ["backtest_reviewed", "shadow_reviewed", "kill_thresholds_confirmed", "loss_method_recorded", "baseline_weekly_ready", "kill_drill_done", "procurement_agreed", "hosting_signed_off"]) {
    await page.getByTestId(`golive-${key}`).getByRole("checkbox").click();
    await expect(page.getByTestId(`golive-${key}`)).toContainText("Ticked by Guest");
  }
  await page.getByRole("link", { name: "Outcomes" }).click();
  await page.getByLabel("Weekly outcomes CSV").setInputFiles("fixtures/weekly_outcomes_sample.csv");
  await page.getByRole("button", { name: "Upload CSV" }).click();
  await expect(page.getByText("8 weeks saved, 0 rows rejected.")).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByTestId("op-mode-live").check();
  await page.getByTestId("config-note").fill("Go live for the demonstration");
  await page.getByTestId("save-config").click();
  await expect(page.getByText(/Saved as version \d+/)).toBeVisible();

  // export: the preview, then the file with only the decided lines
  await page.goto("/");
  await expect(page.getByTestId("shadow-chip")).toHaveCount(0);
  await page.getByTestId("export-link").click();
  await expect(page.getByTestId("export-preview-table").locator("tbody tr")).toHaveCount(2);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-csv").click()]);
  const csv = (await readFile(await download.path(), "utf8")).trim().split(/\r?\n/);
  expect(csv.slice(1).map((l) => l.split(",").slice(0, 3).join(","))).toEqual(["SKU003,Poha Thick 500g,500", "SKU004,Fresh Bhakarwadi 250g,300"]);

  // the kill switch: stop, see everything go read-only, clear it with a note
  await page.goto("/");
  await page.getByTestId("stop-button").click();
  await page.getByTestId("stop-reason").fill("Demonstrating the kill switch");
  await page.getByTestId("stop-confirm").click();
  await expect(page.getByTestId("kill-banner")).toContainText("Demonstrating the kill switch");
  await expect(page.getByTestId("run-now")).toBeDisabled();
  await page.getByRole("link", { name: "Health" }).click();
  await page.getByTestId("clear-note").fill("Demonstration finished, safe to restart");
  await page.getByTestId("clear-kill").click();
  await expect(page.getByTestId("kill-status")).toHaveText("Off");

  // open access is for people, not for machines: the scheduled-job endpoints still need their secret
  expect((await request.get("/api/cron/run")).status()).toBe(401);
  expect((await request.get("/api/cron/kill-check")).status()).toBe(401);
  expect((await request.post("/api/zoho/webhook")).status()).not.toBe(200);
});
