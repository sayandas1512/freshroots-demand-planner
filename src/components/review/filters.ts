import type { Action, Flag } from "@/engine/types";
import type { DecisionStatus, ReviewRow } from "@/run/review-types";

export interface Filters {
  action: Action | "all";
  flag: Flag | "HOLD" | "all";
  perishable: "all" | "yes" | "no";
  status: DecisionStatus | "all";
}

export const DEFAULT_FILTERS: Filters = { action: "all", flag: "all", perishable: "all", status: "all" };

export type SortKey = "priority" | "sku" | "cover" | "status";

const ACTION_RANK: Record<Action, number> = { REORDER_1_5X: 1, REORDER_NOW: 2, PAUSE: 3, HOLD: 4 };
const STATUS_RANK: Record<DecisionStatus, number> = { pending: 0, edited: 1, approved: 2, rejected: 3 };

export function matches(row: ReviewRow, f: Filters): boolean {
  if (f.action !== "all" && row.action !== f.action) return false;
  if (f.flag === "HOLD" ? row.flags.length > 0 : f.flag !== "all" && !row.flags.includes(f.flag)) return false;
  if (f.perishable !== "all" && row.metrics.perishable !== (f.perishable === "yes")) return false;
  if (f.status !== "all" && row.status !== f.status) return false;
  return true;
}

/** Urgent lines first, then the action's severity, then the lowest cover. Decided lines never jump the queue. */
export function compare(a: ReviewRow, b: ReviewRow, key: SortKey): number {
  switch (key) {
    case "sku":
      return a.skuId.localeCompare(b.skuId);
    case "cover":
      return a.metrics.coverWeeks - b.metrics.coverWeeks || a.skuId.localeCompare(b.skuId);
    case "status":
      return STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.skuId.localeCompare(b.skuId);
    case "priority":
      return (
        Number(b.metrics.urgent) - Number(a.metrics.urgent) ||
        ACTION_RANK[a.action] - ACTION_RANK[b.action] ||
        a.metrics.coverWeeks - b.metrics.coverWeeks ||
        a.skuId.localeCompare(b.skuId)
      );
  }
}

export function visibleRows(rows: readonly ReviewRow[], filters: Filters, sort: SortKey): ReviewRow[] {
  return rows.filter((r) => matches(r, filters)).sort((a, b) => compare(a, b, sort));
}

export const VIRTUALIZE_ABOVE = 100;
