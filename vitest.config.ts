import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    // Each database test boots an in-memory Postgres (WASM). Cap parallelism so a busy laptop or CI runner does not time out.
    maxWorkers: 3,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
