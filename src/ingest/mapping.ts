/**
 * The ONE place that maps files to schemas.
 * Left side: the internal field name used by the validators. Right side: the CSV header in the file.
 * If SAP renames a column, change the right-hand string here and nothing else.
 */
export const INGEST_KINDS = ["sales", "sku_master", "distributors", "inventory", "festival_calendar", "open_pos"] as const;
export type IngestKind = (typeof INGEST_KINDS)[number];

/** Files the parser understands. `orders` is only used by the backtest and is never stored. */
export type ParseKind = IngestKind | "orders" | "outcomes_weekly" | "forecast_orders";

export interface FileMapping {
  label: string;
  source: string;
  /** internal field -> CSV header */
  columns: Record<string, string>;
  /** Internal fields that may be blank. */
  optional: readonly string[];
  /** Order in which a full reload should be applied (masters first). */
  loadOrder: number;
}

export const FILE_MAPPINGS: Record<ParseKind, FileMapping> = {
  distributors: {
    label: "Distributors",
    source: "SAP",
    columns: { distributorId: "Distributor_ID", name: "Distributor_Name", region: "Region", status: "Status" },
    optional: [],
    loadOrder: 1,
  },
  sku_master: {
    label: "SKU master",
    source: "SAP",
    columns: {
      skuId: "SKU_ID",
      name: "SKU_Name",
      category: "Category",
      perishability: "Perishability",
      standardReorderQty: "Standard_Reorder_Qty",
      unit: "Unit_of_Measure",
      distributorId: "Distributor_ID",
      leadTimeWeeks: "Lead_Time_Weeks",
      moq: "MOQ",
    },
    optional: ["leadTimeWeeks", "moq"],
    loadOrder: 2,
  },
  festival_calendar: {
    label: "Festival calendar",
    source: "Manual",
    columns: { year: "Year", month: "Month", yearMonth: "Year_Month", isFestival: "Is_Festival_Month" },
    optional: [],
    loadOrder: 3,
  },
  sales: {
    label: "Weekly sales",
    source: "SAP",
    columns: { skuId: "SKU_ID", week: "Week", units: "Units_Sold", distributorId: "Distributor_ID" },
    optional: ["distributorId"],
    loadOrder: 4,
  },
  inventory: {
    label: "Inventory snapshot",
    source: "SAP",
    columns: { skuId: "SKU_ID", location: "Location", unitsOnHand: "Units_On_Hand", asOfDate: "As_Of_Date" },
    optional: [],
    loadOrder: 5,
  },
  forecast_orders: {
    label: "Raghav's own monthly forecast or orders",
    source: "Manual",
    columns: { skuId: "SKU_ID", period: "Period", qty: "Qty" },
    optional: [],
    loadOrder: 9,
  },
  outcomes_weekly: {
    label: "Weekly outcomes",
    source: "Priya's existing weekly report",
    columns: { week: "Week", stockoutIncidents: "Stockout_Incidents", overstockValueInr: "Overstock_Value_INR" },
    optional: [],
    loadOrder: 8,
  },
  orders: {
    label: "Orders Raghav actually placed",
    source: "Manual",
    columns: { skuId: "SKU_ID", week: "Week", orderedQty: "Ordered_Qty" },
    optional: [],
    loadOrder: 7,
  },
  open_pos: {
    label: "Open purchase orders",
    source: "Zoho",
    columns: { skuId: "SKU_ID", qty: "Open_PO_Qty", expectedDate: "Expected_Date" },
    optional: ["expectedDate"],
    loadOrder: 6,
  },
};

export function isIngestKind(value: string): value is IngestKind {
  return (INGEST_KINDS as readonly string[]).includes(value);
}

export const LIMITS = {
  maxBytes: 4_000_000, // stays under the 4.5 MB request body limit of Vercel functions
  maxRows: 100_000,
  maxFieldLength: 300,
  maxRejectsReported: 500,
} as const;
