import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { eq } from "drizzle-orm";
import { connectPostgres, migratePostgres, type Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { recommendations, runs } from "@/db/schema";
import { startAndExecute, startRun } from "@/run/execute";
import { GOLDEN, GOLDEN_AS_OF } from "./golden-table";

/**
 * Production uses node-postgres against Neon. This runs the same path (the `pg` driver, the migration runner,
 * jsonb, enums, the xmax upsert trick, advisory locks) against PGlite served over the Postgres wire protocol.
 */
describe("node-postgres driver path", () => {
  const port = 54_329;
  let server: PGLiteSocketServer;
  let lite: PGlite;
  let db: Db;
  let close: () => Promise<void>;
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;

  beforeAll(async () => {
    lite = await PGlite.create();
    server = new PGLiteSocketServer({ db: lite, port, host: "127.0.0.1", maxConnections: 10 });
    await server.start();
    await migratePostgres(url);
    ({ db, close } = connectPostgres(url));
  });
  afterAll(async () => {
    await close();
    await server.stop();
    await lite.close();
  });

  it("migrates, ingests the fixtures, and runs the pipeline to the golden flags", async () => {
    const reports = await loadFixtures(db);
    expect(reports.map((r) => r.accepted)).toEqual([4, 15, 24, 240, 15]);
    expect((await loadFixtures(db)).map((r) => r.replaced)).toEqual([4, 15, 24, 240, 15]);

    const res = await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
    expect(res.status).toBe("completed");
    const recs = await db.select().from(recommendations).where(eq(recommendations.runId, res.runId));
    expect(recs).toHaveLength(15);
    for (const g of GOLDEN) expect([...(recs.find((r) => r.skuId === g.skuId)?.flags ?? [])].sort()).toEqual([...g.flags].sort());
  });

  it("keeps runs from overlapping and returns the existing run for the same date", async () => {
    const again = await startRun(db, { trigger: "manual", asOf: GOLDEN_AS_OF });
    expect(again.reason).toBe("existing");
    const [a, b] = await Promise.all([startRun(db, { trigger: "cron", asOf: "2026-10-26" }), startRun(db, { trigger: "manual", asOf: "2026-10-26" })]);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect((await db.select().from(runs)).filter((r) => r.status === "running")).toHaveLength(1);
  });
});
