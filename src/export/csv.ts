import { EXPORT_COLUMNS, type ExportLine } from "./mapping";

const FORMULA_START = /^[=+\-@\t\r]/;

/** Spreadsheets run text that starts with = + - @ as a formula. Prefix such cells with an apostrophe. */
export function neutraliseCell(value: string | number): string {
  const text = String(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
}

export function quoteCell(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toPurchaseOrderCsv(lines: readonly ExportLine[]): string {
  const header = EXPORT_COLUMNS.map((c) => c.header).join(",");
  const rows = lines.map((l) => EXPORT_COLUMNS.map((c) => quoteCell(typeof c.value(l) === "number" ? String(c.value(l)) : neutraliseCell(c.value(l)))).join(","));
  return `${[header, ...rows].join("\r\n")}\r\n`;
}
