import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
const OPEN_PORT = 3201;
const SYSTEM_PORT = 3202;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "main", testMatch: /review-flow\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: `http://localhost:${PORT}` } },
    // Open access: a second server where anyone with the link acts as a guest administrator, like a marker would.
    { name: "open", testMatch: /open-access\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: `http://localhost:${OPEN_PORT}` } },
    // The whole fortnight in one journey, with stand-ins for Gemini, Zoho and Resend.
    { name: "system", testMatch: /full-system\.spec\.ts/, timeout: 120_000, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: `http://localhost:${SYSTEM_PORT}` } },
  ],
  webServer: [
    { command: "npx tsx e2e/fake-zoho-server.ts", url: "http://localhost:4010/__state", reuseExistingServer: false, timeout: 60_000 },
    {
    // Fresh embedded database, the five fixtures, then the production build.
    command: `rm -rf .data/e2e && npm run build && npm run seed && npm run seed:users && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { PGLITE_DIR: ".data/e2e", SESSION_SECRET: "e2e-session-secret-0123456789", SEED_USERS: JSON.stringify([{ email: "raghav@freshroots.test", name: "Raghav", role: "planner" }, { email: "deepa@freshroots.test", name: "Deepa", role: "sponsor" }, { email: "priya@freshroots.test", name: "Priya", role: "data" }, { email: "it@freshroots.test", name: "IT Admin", role: "admin" }]), AUTH_DEV_LINKS: "1", PUBLIC_VIEW: "1", CRON_SECRET: "e2e-cron-secret-0123456789", ZOHO_CLIENT_ID: "cid", ZOHO_CLIENT_SECRET: "secret", ZOHO_REFRESH_TOKEN: "refresh-123", ZOHO_ORG_ID: "60001", ZOHO_API_BASE_URL: "http://localhost:4010/inventory/v1", ZOHO_ACCOUNTS_BASE_URL: "http://localhost:4010", ZOHO_WEBHOOK_SECRET: "e2e-webhook-secret-0123456789", DATABASE_URL: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "" },
  },
    {
      command: `rm -rf .data/e2e-open && npm run seed && npx next start -p ${OPEN_PORT}`,
      url: `http://localhost:${OPEN_PORT}/login`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: { PGLITE_DIR: ".data/e2e-open", SESSION_SECRET: "e2e-session-secret-0123456789", CRON_SECRET: "e2e-cron-secret-0123456789", OPEN_ACCESS: "1", DATABASE_URL: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "" },
    },
    { command: "npx tsx e2e/fake-gemini-server.ts", url: "http://localhost:4011/__state", reuseExistingServer: false, timeout: 60_000 },
    { command: "npx tsx e2e/fake-resend-server.ts", url: "http://localhost:4013/__emails", reuseExistingServer: false, timeout: 60_000 },
    { command: "npx tsx e2e/fake-zoho-server.ts", url: "http://localhost:4012/__state", reuseExistingServer: false, timeout: 60_000, env: { FAKE_ZOHO_PORT: "4012" } },
    {
      command: `rm -rf .data/e2e-system && npm run seed && npx next start -p ${SYSTEM_PORT}`,
      url: `http://localhost:${SYSTEM_PORT}/login`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        PGLITE_DIR: ".data/e2e-system",
        SESSION_SECRET: "e2e-session-secret-0123456789",
        CRON_SECRET: "e2e-cron-secret-0123456789",
        OPEN_ACCESS: "1",
        DATABASE_URL: "",
        ANTHROPIC_API_KEY: "",
        LLM_PROVIDER: "gemini",
        GEMINI_API_KEY: "e2e-gemini-key",
        GEMINI_API_BASE_URL: "http://localhost:4011/v1beta",
        RESEND_API_KEY: "e2e-resend-key",
        RESEND_API_URL: "http://localhost:4013/emails",
        ALERT_EMAIL: "alerts@freshroots.test",
        ALERT_FROM: "Freshroots Planner <alerts@freshroots.test>",
        ZOHO_CLIENT_ID: "cid",
        ZOHO_CLIENT_SECRET: "secret",
        ZOHO_REFRESH_TOKEN: "refresh-123",
        ZOHO_ORG_ID: "60001",
        ZOHO_API_BASE_URL: "http://localhost:4012/inventory/v1",
        ZOHO_ACCOUNTS_BASE_URL: "http://localhost:4012",
      },
    },
  ],
});
