import { connectPglite, type Db } from "@/db/client";

/** A fresh in-memory Postgres (PGlite) with migrations and defaults applied. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const handle = await connectPglite();
  return { db: handle.db, close: handle.close };
}
