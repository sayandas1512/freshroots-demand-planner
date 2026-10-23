import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    { command: "npx tsx e2e/fake-zoho-server.ts", url: "http://localhost:4010/__state", reuseExistingServer: false, timeout: 60_000 },
    {
    // Fresh embedded database, the five fixtures, then the production build.
    command: `rm -rf .data/e2e && npm run build && npm run seed && npm run seed:users && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { PGLITE_DIR: ".data/e2e", SESSION_SECRET: "e2e-session-secret-0123456789", SEED_USERS: JSON.stringify([{ email: "raghav@freshroots.test", name: "Raghav", role: "planner", password: "planner-pass-123" }, { email: "deepa@freshroots.test", name: "Deepa", role: "sponsor", password: "sponsor-pass-123" }, { email: "priya@freshroots.test", name: "Priya", role: "data", password: "data-pass-12345" }, { email: "it@freshroots.test", name: "IT Admin", role: "admin", password: "admin-pass-1234" }]), CRON_SECRET: "e2e-cron-secret-0123456789", ZOHO_CLIENT_ID: "cid", ZOHO_CLIENT_SECRET: "secret", ZOHO_REFRESH_TOKEN: "refresh-123", ZOHO_ORG_ID: "60001", ZOHO_API_BASE_URL: "http://localhost:4010/inventory/v1", ZOHO_ACCOUNTS_BASE_URL: "http://localhost:4010", ZOHO_WEBHOOK_SECRET: "e2e-webhook-secret-0123456789", DATABASE_URL: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "" },
  },
  ],
});
