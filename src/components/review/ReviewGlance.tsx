"use client";

import { ColumnChart, type Column } from "@/components/charts/ColumnChart";
import { Donut, type Segment } from "@/components/charts/Donut";
import type { Action } from "@/engine/types";
import type { DecisionStatus, ReviewRow } from "@/run/review-types";
import { actionMix, coverColumns, decisionMix } from "./glance";

const ACTION_COLOR: Record<Action | "EXCEPTION", string> = {
  REORDER_1_5X: "var(--st-demand)",
  REORDER_NOW: "var(--st-stockout)",
  PAUSE: "var(--st-overstock)",
  HOLD: "var(--st-hold)",
  EXCEPTION: "var(--st-exception)",
};
const STATUS_COLOR: Record<DecisionStatus, string> = { pending: "var(--text-faint)", approved: "var(--accent)", edited: "var(--st-demand)", rejected: "var(--st-stockout)" };
const ZONE_COLOR = { low: "var(--st-stockout)", ok: "var(--accent)", high: "var(--st-overstock)" };

interface Props {
  rows: ReviewRow[];
  openExceptions: number;
  actionFilter: Action | "all";
  statusFilter: DecisionStatus | "all";
  onAction: (key: Action | "EXCEPTION") => void;
  onStatus: (key: DecisionStatus) => void;
}

/** The run at a glance: what the rules decided, how far the decisions have got, and where cover sits against the limits. */
export function ReviewGlance({ rows, openExceptions, actionFilter, statusFilter, onAction, onStatus }: Props) {
  const actions: Segment[] = actionMix(rows, openExceptions).map((c) => ({ key: c.key, label: c.label, value: c.value, color: ACTION_COLOR[c.key] }));
  const decisions: Segment[] = decisionMix(rows).map((c) => ({ key: c.key, label: c.label, value: c.value, color: STATUS_COLOR[c.key] }));
  const decided = rows.filter((r) => r.status !== "pending").length;
  const columns: Column[] = coverColumns(rows).map((c) => ({
    label: c.label,
    stacks: (["low", "ok", "high"] as const).map((z) => ({ key: z, label: z === "low" ? "Below its minimum" : z === "ok" ? "Inside its window" : "Above its maximum", value: c.zones[z].count, color: ZONE_COLOR[z], items: c.zones[z].names })),
  }));

  return (
    <section className="glance" aria-label="The run at a glance" data-testid="glance">
      <div className="card">
        <h2>What the rules decided</h2>
        <p className="chart-sub">Click a slice to filter the table.</p>
        <Donut testId="donut-actions" title="Lines by action" segments={actions} centerValue={String(rows.length)} centerLabel="SKUs reviewed" activeKey={actionFilter === "all" ? null : actionFilter} onSelect={(k) => onAction(k as Action | "EXCEPTION")} />
      </div>
      <div className="card">
        <h2>Decisions so far</h2>
        <p className="chart-sub">Updates as lines are approved, edited or rejected.</p>
        <Donut testId="donut-decisions" title="Lines by decision" segments={decisions} centerValue={`${decided}/${rows.length}`} centerLabel="decided" activeKey={statusFilter === "all" ? null : statusFilter} onSelect={(k) => onStatus(k as DecisionStatus)} />
      </div>
      <div className="card">
        <h2>Weeks of cover</h2>
        <p className="chart-sub">Each SKU against its own minimum and maximum.</p>
        <ColumnChart testId="chart-cover" title="SKUs by weeks of cover" columns={columns} legend={[{ label: "Below minimum", color: ZONE_COLOR.low }, { label: "Inside window", color: ZONE_COLOR.ok }, { label: "Above maximum", color: ZONE_COLOR.high }]} />
      </div>
    </section>
  );
}
