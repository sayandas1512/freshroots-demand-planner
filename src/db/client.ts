import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { getEnv } from "@/config/env";
import * as schema from "./schema";
import { ensureDefaults } from "./defaults";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const MIGRATIONS = path.join(process.cwd(), "drizzle");

interface Handle {
  db: Db;
  close: () => Promise<void>;
}

/** Real Postgres (Neon). Migrations are applied by `npm run db:migrate` during deploy. */
export function connectPostgres(url: string): Handle {
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 20_000 });
  return { db: drizzlePg(pool, { schema }), close: () => pool.end() };
}

/** Embedded Postgres (PGlite). `dir` undefined means in-memory. Used for local dev, tests and the e2e flow. */
export async function connectPglite(dir?: string): Promise<Handle> {
  // Loaded on demand: with DATABASE_URL set (production) the embedded database is never imported.
  const [{ PGlite }, { drizzle: drizzlePglite }, { migrate: migratePglite }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  if (dir) mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  await ensureDefaults(db);
  return { db, close: () => client.close() };
}

export async function migratePostgres(url: string): Promise<void> {
  const handle = connectPostgres(url);
  try {
    await migratePg(handle.db as ReturnType<typeof drizzlePg<typeof schema>>, { migrationsFolder: MIGRATIONS });
    await ensureDefaults(handle.db);
  } finally {
    await handle.close();
  }
}

const GLOBAL_KEY = Symbol.for("freshroots.db");
type Holder = { [GLOBAL_KEY]?: Promise<Handle> };

/** Process-wide database handle. Survives Next.js hot reloads. */
export function getDb(): Promise<Db> {
  const holder = globalThis as Holder;
  holder[GLOBAL_KEY] ??= (async () => {
    const env = getEnv();
    if (env.DATABASE_URL) return connectPostgres(env.DATABASE_URL);
    return connectPglite(path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.PGLITE_DIR));
  })();
  return holder[GLOBAL_KEY].then((h) => h.db);
}
