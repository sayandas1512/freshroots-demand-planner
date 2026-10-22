import type { RowFor } from "@/ingest/schemas";

/** period -> sku -> quantity, summed if a SKU appears twice. */
export function ordersFromShadowRows(rows: readonly { value: RowFor<"shadow_orders"> }[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const { value } of rows) {
    const period = out.get(value.period) ?? new Map<string, number>();
    period.set(value.skuId, (period.get(value.skuId) ?? 0) + value.qty);
    out.set(value.period, period);
  }
  return out;
}
