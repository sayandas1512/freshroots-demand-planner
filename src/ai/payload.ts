import type { ExplainFacts, HeadlineFacts } from "./types";

/**
 * Data handling: the ONLY thing that ever leaves for the LLM provider. Computed numbers, SKU names and categories,
 * and fixed enumerations. No user free text (notes, reasons, override comments), no distributor names or ids,
 * no raw tables. Both providers build their request through here, and `assertAllowed` fails closed.
 */
export const EXPLAIN_FIELDS = [
  "sku_id",
  "sku_name",
  "category",
  "perishable",
  "flags",
  "rule_fired",
  "action",
  "urgent",
  "quantity",
  "standard_reorder_qty",
  "high_demand_multiplier",
  "baseline_weeks",
  "baseline_avg_units_per_week",
  "recent_weeks",
  "recent_avg_units_per_week",
  "recent_to_baseline_ratio",
  "high_demand_ratio_threshold",
  "demand_per_week_used_for_cover",
  "stock_on_hand",
  "open_po_qty",
  "open_po_counted_as_stock",
  "cover_weeks",
  "min_cover_weeks",
  "max_cover_weeks",
  "festival",
  "uplift_percent",
] as const;

export const HEADLINE_FIELDS = ["asOf", "totalLines", "reorderNow", "reorder15x", "pause", "hold", "urgent", "exceptions", "exceptionTypes", "staleInventory", "topUrgent"] as const;
const HEADLINE_TOP_FIELDS = ["name", "action", "coverWeeks", "qty"] as const;

const MAX_TEXT = 120;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;

export class PayloadViolation extends Error {}

function checkValue(path: string, value: unknown): void {
  if (value === null || typeof value === "number" || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > MAX_TEXT || CONTROL.test(value)) throw new PayloadViolation(`${path} is not a short single-line value`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkValue(`${path}[${i}]`, v));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) checkValue(`${path}.${k}`, v);
    return;
  }
  throw new PayloadViolation(`${path} has an unsupported type`);
}

function assertKeys(path: string, obj: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) throw new PayloadViolation(`${path}.${key} is not on the allow-list`);
}

/** Throws if the payload has a key off the allow-list or a value that could carry free text. */
export function assertAllowed(kind: "explain" | "headline", payload: unknown): void {
  if (kind === "explain") {
    if (!Array.isArray(payload)) throw new PayloadViolation("explain payload must be a list");
    payload.forEach((p, i) => {
      assertKeys(`[${i}]`, p as Record<string, unknown>, EXPLAIN_FIELDS);
      checkValue(`[${i}]`, p);
    });
    return;
  }
  const obj = payload as Record<string, unknown>;
  assertKeys("headline", obj, HEADLINE_FIELDS);
  for (const [i, t] of ((obj.topUrgent as Record<string, unknown>[] | undefined) ?? []).entries()) assertKeys(`topUrgent[${i}]`, t, HEADLINE_TOP_FIELDS);
  checkValue("headline", payload);
}

export function buildExplainPayload(facts: readonly ExplainFacts[]) {
  const payload = facts.map((f) => ({
    sku_id: f.skuId,
    sku_name: f.name,
    category: f.category,
    perishable: f.perishable,
    flags: f.flags,
    rule_fired: f.ruleFired,
    action: f.action,
    urgent: f.urgent,
    quantity: f.qty,
    standard_reorder_qty: f.standardReorderQty,
    high_demand_multiplier: f.multiplier,
    baseline_weeks: f.baselineWeeks,
    baseline_avg_units_per_week: f.baselineAvg,
    recent_weeks: f.recentWeeks,
    recent_avg_units_per_week: f.recentAvg,
    recent_to_baseline_ratio: f.ratio,
    high_demand_ratio_threshold: f.ratioThreshold,
    demand_per_week_used_for_cover: f.demandPerWeek,
    stock_on_hand: f.stockOnHand,
    open_po_qty: f.openPoQty,
    open_po_counted_as_stock: f.openPoCounted,
    cover_weeks: f.coverWeeks,
    min_cover_weeks: f.coverMin,
    max_cover_weeks: f.coverMax,
    festival: f.festival,
    uplift_percent: f.upliftPercent,
  }));
  assertAllowed("explain", payload);
  return payload;
}

export function buildHeadlinePayload(f: HeadlineFacts) {
  const payload = {
    asOf: f.asOf,
    totalLines: f.totalLines,
    reorderNow: f.reorderNow,
    reorder15x: f.reorder15x,
    pause: f.pause,
    hold: f.hold,
    urgent: f.urgent,
    exceptions: f.exceptions,
    exceptionTypes: f.exceptionTypes,
    staleInventory: f.staleInventory,
    topUrgent: f.topUrgent.map((t) => ({ name: t.name, action: t.action, coverWeeks: t.coverWeeks, qty: t.qty })),
  };
  assertAllowed("headline", payload);
  return payload;
}
