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
  webServer: {
    // Fresh embedded database, the five fixtures, then the production build.
    command: `rm -rf .data/e2e && npm run build && npm run seed && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { PGLITE_DIR: ".data/e2e", APP_PASSWORD: "e2e-password", CRON_SECRET: "e2e-cron-secret-0123456789", DATABASE_URL: "", ANTHROPIC_API_KEY: "" },
  },
});
