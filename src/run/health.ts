import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { baseline, exceptions, overrides, recommendations, runs, skus } from "@/db/schema";

export interface HealthRun {
  id: string;
  status: string;
  trigger: string;
  asOf: string;
  startedAt: string;
  lines: number;
  exceptions: number;
  llmStatus: string;
  llmCalls: number;
  llmCostUsd: number | null;
  configVersion: number | null;
  note: string | null;
  overrideRate: number | null;
  templateRate: number | null;
}

export interface OverrideLogRow {
  id: string;
  at: string;
  skuId: string;
  skuName: string;
  field: string;
  from: string | null;
  to: string | null;
  reason: string;
  runId: string;
}

export interface HealthData {
  runs: HealthRun[];
  alerts: HealthRun[];
  totals: { runs: number; lines: number; overrideRate: number | null; overrideRateDecided: number | null; templateRate: number | null; llmCalls: number; llmCostUsd: number; avgExceptions: number | null };
  flagsByRule: { rule: string; count: number }[];
  exceptionsByType: { type: string; count: number }[];
  baseline: { period: string; stockoutLossInr: number; stockoutLossInrHigh: number | null; writeoffInr: number; writeoffInrHigh: number | null; source: string }[];
  overrideLog: OverrideLogRow[];
  overrideLogTotal: number;
}

const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);

export async function loadHealth(db: Db, query: string): Promise<HealthData> {
  const runRows = await db.select().from(runs).where(ne(runs.trigger, "backtest")).orderBy(desc(runs.startedAt)).limit(40);

  const perRun = await db
    .select({
      runId: recommendations.runId,
      total: sql<number>`count(*)::int`,
      overridden: sql<number>`count(*) filter (where ${recommendations.status} in ('edited','rejected'))::int`,
      decided: sql<number>`count(*) filter (where ${recommendations.status} <> 'pending')::int`,
      flagged: sql<number>`count(*) filter (where cardinality(${recommendations.flags}) > 0)::int`,
      flaggedTemplate: sql<number>`count(*) filter (where cardinality(${recommendations.flags}) > 0 and ${recommendations.explanationSource} = 'template')::int`,
    })
    .from(recommendations)
    .innerJoin(runs, eq(runs.id, recommendations.runId))
    .where(ne(runs.trigger, "backtest"))
    .groupBy(recommendations.runId);
  const statsByRun = new Map(perRun.map((r) => [r.runId, r]));

  const healthRuns: HealthRun[] = runRows.map((r) => {
    const s = statsByRun.get(r.id);
    return {
      id: r.id,
      status: r.status,
      trigger: r.trigger,
      asOf: r.asOfDate,
      startedAt: r.startedAt.toISOString(),
      lines: r.counts.lines ?? s?.total ?? 0,
      exceptions: r.counts.exceptions ?? 0,
      llmStatus: r.llmStatus,
      llmCalls: r.llmCalls,
      llmCostUsd: r.llmCostUsd === null ? null : Number(r.llmCostUsd),
      configVersion: r.configVersion,
      note: r.counts.notes?.at(-1) ?? null,
      overrideRate: s ? ratio(s.overridden, s.total) : null,
      templateRate: s ? ratio(s.flaggedTemplate, s.flagged) : null,
    };
  });

  const sum = (f: (s: (typeof perRun)[number]) => number) => perRun.reduce((a, s) => a + f(s), 0);
  const totalLines = sum((s) => s.total);
  const totals: HealthData["totals"] = {
    runs: runRows.length,
    lines: totalLines,
    overrideRate: ratio(sum((s) => s.overridden), totalLines),
    overrideRateDecided: ratio(sum((s) => s.overridden), sum((s) => s.decided)),
    templateRate: ratio(sum((s) => s.flaggedTemplate), sum((s) => s.flagged)),
    llmCalls: runRows.reduce((a, r) => a + r.llmCalls, 0),
    llmCostUsd: runRows.reduce((a, r) => a + (r.llmCostUsd === null ? 0 : Number(r.llmCostUsd)), 0),
    avgExceptions: runRows.length === 0 ? null : runRows.reduce((a, r) => a + (r.counts.exceptions ?? 0), 0) / runRows.length,
  };

  const flagsByRule = await db
    .select({ rule: recommendations.ruleFired, count: sql<number>`count(*)::int` })
    .from(recommendations)
    .innerJoin(runs, eq(runs.id, recommendations.runId))
    .where(ne(runs.trigger, "backtest"))
    .groupBy(recommendations.ruleFired)
    .orderBy(desc(sql`count(*)`));

  const exceptionRows = await db
    .select({ type: exceptions.type, count: sql<number>`count(*)::int` })
    .from(exceptions)
    .innerJoin(runs, eq(runs.id, exceptions.runId))
    .where(ne(runs.trigger, "backtest"))
    .groupBy(exceptions.type)
    .orderBy(desc(sql`count(*)`));
  const exceptionsByType = exceptionRows.map((r) => ({ type: r.type as string, count: Number(r.count) }));

  const q = query.trim();
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const filter = q
    ? or(ilike(overrides.reason, like), ilike(recommendations.skuId, like), ilike(skus.name, like), ilike(overrides.fromValue, like), ilike(overrides.toValue, like))
    : undefined;
  const logRows = await db
    .select({ o: overrides, skuId: recommendations.skuId, skuName: skus.name, runId: recommendations.runId })
    .from(overrides)
    .innerJoin(recommendations, eq(recommendations.id, overrides.recommendationId))
    .leftJoin(skus, eq(skus.skuId, recommendations.skuId))
    .where(filter)
    .orderBy(desc(overrides.at))
    .limit(200);
  const [logTotal] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(overrides)
    .innerJoin(recommendations, eq(recommendations.id, overrides.recommendationId))
    .leftJoin(skus, eq(skus.skuId, recommendations.skuId))
    .where(and(filter));

  return {
    runs: healthRuns,
    alerts: healthRuns.filter((r) => r.status === "failed" || r.status === "completed_degraded").slice(0, 5),
    totals,
    flagsByRule: flagsByRule.map((r) => ({ rule: r.rule, count: Number(r.count) })),
    exceptionsByType,
    baseline: await db.select().from(baseline).orderBy(baseline.period),
    overrideLog: logRows.map(({ o, skuId, skuName, runId }) => ({ id: o.id, at: o.at.toISOString(), skuId, skuName: skuName ?? skuId, field: o.field, from: o.fromValue, to: o.toValue, reason: o.reason, runId })),
    overrideLogTotal: Number(logTotal?.n ?? 0),
  };
}
