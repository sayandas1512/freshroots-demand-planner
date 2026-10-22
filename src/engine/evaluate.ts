import type { RuleConfig } from "./config";
import { detectDistributorShift } from "./distributors";
import { gt, lt, mean } from "./num";
import type { Action, EngineData, EvaluationResult, ExceptionItem, Flag, InfoFlag, LineMetrics, RecommendationLine, SkuMaster, SkuOutcome } from "./types";
import { lastCompleteWeeks, yearMonthOf } from "./weeks";

/**
 * Flag and action precedence (also shown in the UI help):
 *   1. OVERSTOCK_RISK together with HIGH_DEMAND -> no recommendation, routed as exception `conflicting_signals`.
 *   2. HIGH_DEMAND (with or without STOCKOUT_RISK) -> REORDER_1_5X. With STOCKOUT_RISK the line is urgent.
 *   3. STOCKOUT_RISK alone -> REORDER_NOW at the standard quantity.
 *   4. OVERSTOCK_RISK alone -> PAUSE.
 *   5. Otherwise HOLD.
 * Perishable SKUs use the perishable min/max windows instead of the general ones.
 */

export interface SkuContext {
  asOf: string;
  config: RuleConfig;
  festival: boolean;
  /** The baseline window, oldest first. */
  weeks: readonly string[];
  sales: ReadonlyMap<string, number> | undefined;
  stock: number | undefined;
  openPo: number;
  /** distributor -> week -> units, when distributor data is available and the rule is on. */
  distributorSales?: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

const FLAG_ORDER: Flag[] = ["STOCKOUT_RISK", "HIGH_DEMAND", "OVERSTOCK_RISK"];

function exception(sku: SkuMaster, type: ExceptionItem["type"], detail: string): SkuOutcome {
  return { kind: "exception", exception: { skuId: sku.skuId, type, detail } };
}

const fmt = (n: number, dp = 1): string => n.toFixed(dp);

export function evaluateSku(sku: SkuMaster, ctx: SkuContext): SkuOutcome {
  const { config: cfg, weeks } = ctx;
  const firstWeek = weeks[0];
  const lastWeek = weeks[weeks.length - 1];
  if (firstWeek === undefined || lastWeek === undefined) throw new Error("Empty baseline window");

  const sales = ctx.sales;
  const hasHistory = sales !== undefined && [...sales.keys()].some((w) => w <= lastWeek);
  if (!sales || !hasHistory) return exception(sku, "new_sku", "In the SKU master but has no sales history yet.");

  const inWindow = weeks.map((w) => sales.get(w));
  const present = inWindow.filter((v): v is number => v !== undefined);
  if (present.length < cfg.baseline_weeks) {
    return exception(sku, "short_history", `Only ${present.length} of the last ${cfg.baseline_weeks} weeks have sales data.`);
  }

  if (ctx.stock === undefined) return exception(sku, "missing_stock", "No inventory snapshot for this SKU.");

  const avgBaseline = mean(present);
  if (avgBaseline === 0) return exception(sku, "zero_demand", `No units sold in the last ${cfg.baseline_weeks} weeks, so weeks of cover is undefined.`);

  const latest = present[present.length - 1] as number;
  const prev = present.slice(-1 - cfg.anomaly_lookback_weeks, -1);
  const prevMean = mean(prev);
  const jumped = prevMean === 0 ? latest > 0 : gt(latest / prevMean, cfg.anomaly_factor) || lt(latest / prevMean, 1 / cfg.anomaly_factor);
  if (jumped) {
    return exception(
      sku,
      "anomalous_jump",
      `Latest week sold ${latest} units against a ${cfg.anomaly_lookback_weeks}-week mean of ${fmt(prevMean)} (more than ${fmt(cfg.anomaly_factor)}x apart).`,
    );
  }

  if (cfg.enable_distributor_exceptions && ctx.distributorSales) {
    const shifts = detectDistributorShift(ctx.distributorSales, weeks, cfg.recent_weeks, cfg.distributor_shift_pct);
    if (shifts.length > 0) {
      const text = shifts
        .map((s) => `Distributor ${s.distributorId} supplied ${(s.baselineShare * 100).toFixed(1)}% of this SKU over the last ${cfg.baseline_weeks} weeks but ${(s.recentShare * 100).toFixed(1)}% over the last ${cfg.recent_weeks} (${s.dropPct.toFixed(0)}% lower)`)
        .join("; ");
      return exception(sku, "distributor_shift", `${text}. Unusual distributor behaviour is a judgment call, so no recommendation was made.`);
    }
  }

  const avgRecent = mean(present.slice(-cfg.recent_weeks));
  const uplift = ctx.festival ? cfg.festival_uplift : 0;
  const scale = 1 + uplift;
  let demand: number;
  let ratio: number;
  switch (cfg.festival_uplift_mode) {
    case "cover_demand":
      demand = avgBaseline * scale;
      ratio = avgRecent / avgBaseline;
      break;
    case "both_windows":
      demand = avgBaseline * scale;
      ratio = (avgRecent * scale) / (avgBaseline * scale);
      break;
    case "baseline_only":
      demand = avgBaseline * scale;
      ratio = avgRecent / (avgBaseline * scale);
      break;
  }

  const stockUsed = ctx.stock + (cfg.include_open_po_in_stock ? ctx.openPo : 0);
  const cover = stockUsed / demand;
  const perishable = sku.perishability === "high";
  const coverMin = perishable ? cfg.perishable_min_weeks : cfg.cover_min_weeks;
  const coverMax = perishable ? cfg.perishable_max_weeks : cfg.cover_max_weeks;
  const kind = perishable ? "perishable" : "general";

  const stockout = lt(cover, coverMin);
  const high = gt(ratio, cfg.high_demand_ratio);
  const over = gt(cover, coverMax);

  const metrics: LineMetrics = {
    asOf: ctx.asOf,
    windowFirstWeek: firstWeek,
    windowLastWeek: lastWeek,
    recentWeeks: cfg.recent_weeks,
    baselineWeeks: cfg.baseline_weeks,
    avgBaseline,
    avgRecent,
    ratio,
    ratioThreshold: cfg.high_demand_ratio,
    demandPerWeek: demand,
    stockOnHand: ctx.stock,
    openPoQty: ctx.openPo,
    stockUsed,
    coverWeeks: cover,
    coverMin,
    coverMax,
    perishable,
    festival: ctx.festival,
    upliftApplied: uplift,
    upliftMode: cfg.festival_uplift_mode,
    standardReorderQty: sku.standardReorderQty,
    highDemandMultiplier: cfg.high_demand_multiplier,
    includeOpenPoInStock: cfg.include_open_po_in_stock,
    urgent: false,
    leadTimeWeeks: sku.leadTimeWeeks ?? null,
    moq: sku.moq ?? null,
    infoFlags: [],
  };

  if (over && high) {
    return exception(
      sku,
      "conflicting_signals",
      `Demand is ${fmt((ratio - 1) * 100, 0)}% above the ${cfg.baseline_weeks}-week average, yet cover is ${fmt(cover)} weeks against a maximum of ${coverMax}. The rules cannot judge both.`,
    );
  }

  const flags = FLAG_ORDER.filter((f) => (f === "STOCKOUT_RISK" ? stockout : f === "HIGH_DEMAND" ? high : over));
  let action: Action;
  let ruleFired: string;
  let qty: number | null;
  if (high) {
    action = "REORDER_1_5X";
    qty = Math.round(cfg.high_demand_multiplier * sku.standardReorderQty);
    ruleFired = stockout ? `high_demand+stockout_risk.${kind}` : "high_demand";
    metrics.urgent = stockout;
  } else if (stockout) {
    action = "REORDER_NOW";
    qty = sku.standardReorderQty;
    ruleFired = `stockout_risk.${kind}`;
  } else if (over) {
    action = "PAUSE";
    qty = null;
    ruleFired = `overstock_risk.${kind}`;
  } else {
    action = "HOLD";
    qty = null;
    ruleFired = "hold";
  }

  const info: InfoFlag[] = [];
  if (cfg.enable_lead_time_flag && metrics.leadTimeWeeks !== null && lt(cover, metrics.leadTimeWeeks)) info.push("LEAD_TIME_BREACH");
  if (cfg.enable_moq_flag && metrics.moq !== null && qty !== null && qty < metrics.moq) info.push("BELOW_MOQ");
  metrics.infoFlags = info;

  const line: RecommendationLine = { skuId: sku.skuId, action, flags, ruleFired, qty, metrics };
  return { kind: "line", line };
}

export function evaluateAll(data: EngineData, config: RuleConfig): EvaluationResult {
  const weeks = lastCompleteWeeks(data.asOf, config.baseline_weeks);
  const festival = data.festivalMonths.has(yearMonthOf(data.asOf));
  const lines: RecommendationLine[] = [];
  const exceptions: ExceptionItem[] = [];

  for (const sku of data.skus) {
    try {
      const outcome = evaluateSku(sku, {
        asOf: data.asOf,
        config,
        festival,
        weeks,
        sales: data.sales.get(sku.skuId),
        stock: data.stock.get(sku.skuId),
        openPo: data.openPo.get(sku.skuId) ?? 0,
        distributorSales: data.distributorSales?.get(sku.skuId),
      });
      if (outcome.kind === "line") lines.push(outcome.line);
      else exceptions.push(outcome.exception);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      exceptions.push({ skuId: sku.skuId, type: "processing_error", detail: `Could not evaluate this SKU: ${message}` });
    }
  }

  const known = new Set(data.skus.map((s) => s.skuId));
  const unknown = new Set<string>();
  for (const id of data.sales.keys()) if (!known.has(id)) unknown.add(id);
  for (const id of data.stock.keys()) if (!known.has(id)) unknown.add(id);
  for (const id of [...unknown].sort()) {
    exceptions.push({ skuId: id, type: "unknown_sku", detail: "Sales or stock rows exist for this SKU, but it is not in the SKU master." });
  }

  return { lines, exceptions };
}

/** Lines that would change between two configs on the same data. Used by the Settings impact preview. */
export interface LineChange {
  skuId: string;
  before: string;
  after: string;
}

function summarise(result: EvaluationResult): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of result.lines) out.set(l.skuId, `${l.action}${l.qty === null ? "" : ` ${l.qty}`}`);
  for (const e of result.exceptions) out.set(e.skuId, `exception:${e.type}`);
  return out;
}

export function compareResults(before: EvaluationResult, after: EvaluationResult): LineChange[] {
  const a = summarise(before);
  const b = summarise(after);
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort();
  const changes: LineChange[] = [];
  for (const id of ids) {
    const x = a.get(id) ?? "none";
    const y = b.get(id) ?? "none";
    if (x !== y) changes.push({ skuId: id, before: x, after: y });
  }
  return changes;
}
