import { existsSync } from "node:fs";

/** Scripts run outside Next.js, so load .env.local ourselves when it exists. */
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
