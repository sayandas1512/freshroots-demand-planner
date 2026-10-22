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

export interface ExportColumn {
  header: string;
  value: (line: ExportLine) => string | number;
}

/** `idLabel` is the header for the distributor column (config `export_id_label`): it may be the supplier we order from or the selling distributor, and that is unconfirmed. */
export const exportColumns = (idLabel: string): ExportColumn[] => [
  { header: "SKU_ID", value: (l) => l.skuId },
  { header: "SKU_Name", value: (l) => l.skuName },
  { header: "Quantity", value: (l) => l.quantity },
  { header: "Unit", value: (l) => l.unit },
  { header: idLabel, value: (l) => l.distributorId },
  { header: "Run_ID", value: (l) => l.runId },
  { header: "Approved_At", value: (l) => l.approvedAt.toISOString() },
];

export const DEFAULT_ID_LABEL = "Distributor_ID";
