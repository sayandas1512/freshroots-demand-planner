import { defineConfig, devices } from "@playwright/test";

/** Read-only smoke test of a deployed site: LIVE_URL=https://... npm run test:live. Starts nothing. */
const url = process.env.LIVE_URL;
if (!url) throw new Error("Set LIVE_URL to the site to check, for example LIVE_URL=https://your-site.vercel.app");

export default defineConfig({
  testDir: "./e2e",
  testMatch: /live-smoke\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: url, trace: "retain-on-failure" },
});
