/**
 * Purchase-order CSV columns. The real Zoho import template is not confirmed yet (see ASSUMPTIONS.md),
 * so this is the single place to rename or reorder columns once it is.
 */
export interface ExportLine {
  skuId: string;
  skuName: string;
  quantity: number;
  unit: string;
  distributorId: string;
  runId: string;
  approvedAt: Date;
}

export const EXPORT_COLUMNS: { header: string; value: (line: ExportLine) => string | number }[] = [
  { header: "SKU_ID", value: (l) => l.skuId },
  { header: "SKU_Name", value: (l) => l.skuName },
  { header: "Quantity", value: (l) => l.quantity },
  { header: "Unit", value: (l) => l.unit },
  { header: "Distributor_ID", value: (l) => l.distributorId },
  { header: "Run_ID", value: (l) => l.runId },
  { header: "Approved_At", value: (l) => l.approvedAt.toISOString() },
];
