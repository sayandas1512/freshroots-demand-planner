import type { Action } from "@/engine/types";
import type { DecisionStatus, ReviewRow } from "@/run/review-types";

export const ACTION_LABEL: Record<Action, string> = { REORDER_1_5X: "Reorder 1.5×", REORDER_NOW: "Reorder now", PAUSE: "Pause order", HOLD: "Hold" };
export const ACTION_ORDER: Action[] = ["REORDER_1_5X", "REORDER_NOW", "PAUSE", "HOLD"];
export const STATUS_ORDER: DecisionStatus[] = ["pending", "approved", "edited", "rejected"];
export const STATUS_LABEL: Record<DecisionStatus, string> = { pending: "Pending", approved: "Approved", edited: "Edited", rejected: "Rejected" };

export interface Count<K extends string> {
  key: K;
  label: string;
  value: number;
}

/** How many lines each action got, plus the exceptions that still need Raghav. */
export function actionMix(rows: readonly ReviewRow[], openExceptions: number): Count<Action | "EXCEPTION">[] {
  const out: Count<Action | "EXCEPTION">[] = ACTION_ORDER.map((a) => ({ key: a, label: ACTION_LABEL[a], value: rows.filter((r) => r.action === a).length }));
  out.push({ key: "EXCEPTION", label: "Exceptions open", value: openExceptions });
  return out;
}

export function decisionMix(rows: readonly ReviewRow[]): Count<DecisionStatus>[] {
  return STATUS_ORDER.map((s) => ({ key: s, label: STATUS_LABEL[s], value: rows.filter((r) => r.status === s).length }));
}

export type Zone = "low" | "ok" | "high";

/** Below this SKU's own minimum, inside its window, or above its maximum (perishables have tighter limits). */
export function zoneOf(row: ReviewRow): Zone {
  const m = row.metrics;
  return m.coverWeeks < m.coverMin ? "low" : m.coverWeeks > m.coverMax ? "high" : "ok";
}

export const COVER_BUCKETS: { label: string; from: number; to: number }[] = [
  { label: "< 2", from: -Infinity, to: 2 },
  { label: "2–4", from: 2, to: 4 },
  { label: "4–6", from: 4, to: 6 },
  { label: "6–10", from: 6, to: 10 },
  { label: "10–14", from: 10, to: 14 },
  { label: "14+", from: 14, to: Infinity },
];

export interface CoverColumn {
  label: string;
  zones: Record<Zone, { count: number; names: string[] }>;
}

/** Weeks of cover in buckets, each split by whether the SKU is below, inside or above its own limits. */
export function coverColumns(rows: readonly ReviewRow[]): CoverColumn[] {
  return COVER_BUCKETS.map((b) => {
    const zones: CoverColumn["zones"] = { low: { count: 0, names: [] }, ok: { count: 0, names: [] }, high: { count: 0, names: [] } };
    for (const r of rows) {
      const c = r.metrics.coverWeeks;
      if (c >= b.from && c < b.to) {
        const z = zones[zoneOf(r)];
        z.count += 1;
        z.names.push(r.name);
      }
    }
    return { label: b.label, zones };
  });
}
