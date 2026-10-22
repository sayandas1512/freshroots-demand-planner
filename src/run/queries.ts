import { desc, eq, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { exceptions, recommendations, runHeadlines, runs, skus } from "@/db/schema";
import type { ReviewData, ReviewException, ReviewRow, ReviewRun } from "./review-types";

function toRun(r: typeof runs.$inferSelect): ReviewRun {
  return {
    id: r.id,
    status: r.status,
    trigger: r.trigger,
    asOf: r.asOfDate,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    llmStatus: r.llmStatus,
    configVersion: r.configVersion,
    festivalMode: typeof r.counts.festivalMode === "string" ? r.counts.festivalMode : null,
    notes: r.counts.notes ?? [],
    steps: r.counts.steps ?? {},
  };
}

export async function latestRun(db: Db): Promise<ReviewRun | null> {
  const [row] = await db.select().from(runs).where(ne(runs.trigger, "backtest")).orderBy(desc(runs.startedAt)).limit(1);
  return row ? toRun(row) : null;
}

/** The review sheet for a run. Lines of a run that is still going are not shown: the sheet appears once it is saved. */
export async function loadReview(db: Db, runId?: string): Promise<ReviewData | null> {
  const run = runId ? (await db.select().from(runs).where(eq(runs.id, runId)).limit(1))[0] : (await db.select().from(runs).where(ne(runs.trigger, "backtest")).orderBy(desc(runs.startedAt)).limit(1))[0];
  if (!run) return null;
  const review = toRun(run);
  if (run.status === "running") return { run: review, headline: null, rows: [], exceptions: [] };

  const recRows = await db
    .select({ rec: recommendations, name: skus.name, category: skus.category, unit: skus.unit, distributorId: skus.distributorId })
    .from(recommendations)
    .leftJoin(skus, eq(skus.skuId, recommendations.skuId))
    .where(eq(recommendations.runId, run.id))
    .orderBy(recommendations.skuId);
  const rows: ReviewRow[] = recRows.map(({ rec, name, category, unit, distributorId }) => ({
    id: rec.id,
    skuId: rec.skuId,
    name: name ?? rec.skuId,
    category: category ?? "",
    unit: unit ?? "",
    distributorId: distributorId ?? "",
    action: rec.action,
    flags: rec.flags as ReviewRow["flags"],
    ruleFired: rec.ruleFired,
    qty: rec.qty,
    metrics: rec.metrics,
    explanation: rec.explanation,
    source: rec.explanationSource,
    status: rec.status,
    finalQty: rec.finalQty,
    decidedNote: rec.decidedNote,
  }));

  const excRows = await db
    .select({ exc: exceptions, name: skus.name })
    .from(exceptions)
    .leftJoin(skus, eq(skus.skuId, exceptions.skuId))
    .where(eq(exceptions.runId, run.id))
    .orderBy(exceptions.skuId);
  const excs: ReviewException[] = excRows.map(({ exc, name }) => ({
    id: exc.id,
    skuId: exc.skuId,
    name: name ?? null,
    type: exc.type,
    detail: exc.detail,
    status: exc.status,
    handledNote: exc.handledNote,
  }));

  const [headline] = await db.select().from(runHeadlines).where(eq(runHeadlines.runId, run.id)).limit(1);
  return { run: review, headline: headline ? { lines: headline.text.split("\n"), source: headline.source } : null, rows, exceptions: excs };
}
