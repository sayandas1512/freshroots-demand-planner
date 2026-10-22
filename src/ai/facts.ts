import { round } from "@/engine/num";
import type { ExceptionItem, RecommendationLine, SkuMaster } from "@/engine/types";
import type { ExplainFacts, HeadlineFacts } from "./types";

export function explainFactsFor(line: RecommendationLine, sku: SkuMaster): ExplainFacts {
  const m = line.metrics;
  return {
    skuId: sku.skuId,
    name: sku.name,
    category: sku.category,
    perishable: m.perishable,
    flags: line.flags,
    ruleFired: line.ruleFired,
    action: line.action,
    urgent: m.urgent,
    qty: line.qty,
    standardReorderQty: m.standardReorderQty,
    multiplier: m.highDemandMultiplier,
    baselineAvg: round(m.avgBaseline, 1),
    recentAvg: round(m.avgRecent, 1),
    baselineWeeks: m.baselineWeeks,
    recentWeeks: m.recentWeeks,
    ratio: round(m.ratio, 2),
    ratioThreshold: m.ratioThreshold,
    demandPerWeek: round(m.demandPerWeek, 1),
    stockOnHand: m.stockOnHand,
    openPoQty: m.openPoQty,
    openPoCounted: m.includeOpenPoInStock,
    coverWeeks: round(m.coverWeeks, 1),
    coverMin: m.coverMin,
    coverMax: m.coverMax,
    festival: m.festival,
    upliftPercent: round(m.upliftApplied * 100, 0),
  };
}

export function headlineFactsFor(
  asOf: string,
  lines: readonly RecommendationLine[],
  exceptions: readonly ExceptionItem[],
  skus: ReadonlyMap<string, SkuMaster>,
  staleInventory: boolean,
): HeadlineFacts {
  const count = (a: RecommendationLine["action"]) => lines.filter((l) => l.action === a).length;
  const exceptionTypes: Record<string, number> = {};
  for (const e of exceptions) exceptionTypes[e.type] = (exceptionTypes[e.type] ?? 0) + 1;
  const topUrgent = lines
    .filter((l) => l.action === "REORDER_NOW" || l.action === "REORDER_1_5X")
    .sort((a, b) => Number(b.metrics.urgent) - Number(a.metrics.urgent) || a.metrics.coverWeeks - b.metrics.coverWeeks)
    .slice(0, 3)
    .map((l) => ({ name: skus.get(l.skuId)?.name ?? l.skuId, action: l.action, coverWeeks: round(l.metrics.coverWeeks, 1), qty: l.qty }));
  return {
    asOf,
    totalLines: lines.length,
    reorderNow: count("REORDER_NOW"),
    reorder15x: count("REORDER_1_5X"),
    pause: count("PAUSE"),
    hold: count("HOLD"),
    urgent: lines.filter((l) => l.metrics.urgent).length,
    exceptions: exceptions.length,
    exceptionTypes,
    staleInventory,
    topUrgent,
  };
}
