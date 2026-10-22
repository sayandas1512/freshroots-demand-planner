import { neutraliseCell, quoteCell } from "@/export/csv";
import type { RowFor } from "@/ingest/schemas";

/** What the system recommended for one SKU in one replayed week. */
export interface SystemLine {
  week: string;
  skuId: string;
  /** An action, or `exception:<type>` when the rules routed the SKU to Raghav. */
  systemAction: string;
  systemQty: number | null;
}

export type RaghavAction = "ORDER" | "NO_ORDER";

export interface BacktestRow extends SystemLine {
  raghavAction: RaghavAction | null;
  orderedQty: number | null;
  /** null when there is nothing to compare: no orders for that week, or the system made no recommendation. */
  agreed: boolean | null;
}

export type OrdersByWeek = ReadonlyMap<string, ReadonlyMap<string, number>>;

export function ordersFromRows(rows: readonly { value: RowFor<"orders"> }[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const { value } of rows) {
    const week = out.get(value.week) ?? new Map<string, number>();
    week.set(value.skuId, (week.get(value.skuId) ?? 0) + value.orderedQty);
    out.set(value.week, week);
  }
  return out;
}

const systemOrders = (action: string): boolean => action === "REORDER_NOW" || action === "REORDER_1_5X";

/**
 * Compare at the level of "order or not". If the orders file has rows for a week, a SKU missing from it counts as
 * not ordered. If it has no rows for that week at all, that week is left uncompared rather than guessed.
 */
export function compareLines(lines: readonly SystemLine[], orders: OrdersByWeek | null): BacktestRow[] {
  return lines.map((line) => {
    const weekOrders = orders?.get(line.week);
    if (!weekOrders) return { ...line, raghavAction: null, orderedQty: null, agreed: null };
    const ordered = weekOrders.get(line.skuId) ?? 0;
    const raghavAction: RaghavAction = ordered > 0 ? "ORDER" : "NO_ORDER";
    const isException = line.systemAction.startsWith("exception:");
    return { ...line, raghavAction, orderedQty: ordered, agreed: isException ? null : systemOrders(line.systemAction) === (raghavAction === "ORDER") };
  });
}

export interface ActionSummary {
  lines: number;
  compared: number;
  agreed: number;
  rate: number | null;
}

export interface BacktestSummary {
  overall: ActionSummary;
  byAction: Record<string, ActionSummary>;
}

function tally(rows: readonly BacktestRow[]): ActionSummary {
  const compared = rows.filter((r) => r.agreed !== null);
  const agreed = compared.filter((r) => r.agreed).length;
  return { lines: rows.length, compared: compared.length, agreed, rate: compared.length === 0 ? null : agreed / compared.length };
}

export function summarise(rows: readonly BacktestRow[]): BacktestSummary {
  const byAction: Record<string, BacktestRow[]> = {};
  for (const r of rows) (byAction[r.systemAction] ??= []).push(r);
  return { overall: tally(rows), byAction: Object.fromEntries(Object.entries(byAction).map(([k, v]) => [k, tally(v)])) };
}

export function disagreements(rows: readonly BacktestRow[]): BacktestRow[] {
  return rows.filter((r) => r.agreed === false);
}

export function disagreementsCsv(rows: readonly BacktestRow[]): string {
  const header = "Week,SKU_ID,System_Action,System_Qty,Raghav_Action,Ordered_Qty";
  const lines = rows.map((r) => [r.week, r.skuId, r.systemAction, r.systemQty ?? "", r.raghavAction ?? "", r.orderedQty ?? ""].map((v) => quoteCell(neutraliseCell(v))).join(","));
  return `${[header, ...lines].join("\r\n")}\r\n`;
}
