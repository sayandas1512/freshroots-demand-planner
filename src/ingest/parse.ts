import Papa from "papaparse";
import { FILE_MAPPINGS, LIMITS, type ParseKind } from "./mapping";
import { rowKeys, rowSchemas, type RowFor } from "./schemas";

export interface RowIssue {
  /** Spreadsheet-style line number: the header is line 1, so the first data row is 2. */
  row: number;
  reason: string;
  raw: Record<string, string>;
}

export interface ParsedFile<K extends ParseKind> {
  kind: K;
  rows: { row: number; value: RowFor<K> }[];
  rejects: RowIssue[];
  totalRows: number;
  /** Internal field names whose column was in the file. Optional columns that are absent must not overwrite stored values. */
  columnsPresent: string[];
  fileError?: string;
}

function clip(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k.slice(0, 40)] = String(v ?? "").slice(0, 80);
  return out;
}

function fail<K extends ParseKind>(kind: K, message: string, totalRows = 0): ParsedFile<K> {
  return { kind, rows: [], rejects: [], totalRows, columnsPresent: [], fileError: message };
}

/**
 * Parse and validate one CSV. Pure: no database access. The text is treated as untrusted:
 * size and row limits apply, every row goes through Zod, and every rejected row is reported with a reason.
 */
export function parseCsv<K extends ParseKind>(kind: K, input: string): ParsedFile<K> {
  if (input.length > LIMITS.maxBytes) return fail(kind, `File is larger than ${(LIMITS.maxBytes / 1_000_000).toFixed(0)} MB.`);
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const mapping = FILE_MAPPINGS[kind];
  const headers = parsed.meta.fields ?? [];
  const missing = Object.entries(mapping.columns)
    .filter(([field, header]) => !mapping.optional.includes(field) && !headers.includes(header))
    .map(([, header]) => header);
  if (missing.length > 0) return fail(kind, `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
  if (parsed.data.length > LIMITS.maxRows) return fail(kind, `File has more than ${LIMITS.maxRows.toLocaleString("en-IN")} rows.`, parsed.data.length);

  const structuralErrors = new Map<number, string>();
  for (const e of parsed.errors) if (e.row !== undefined) structuralErrors.set(e.row, e.message);

  const schema = rowSchemas[kind];
  const keyOf = rowKeys[kind] as (row: RowFor<K>) => string;
  const seen = new Map<string, number>();
  const rows: ParsedFile<K>["rows"] = [];
  const rejects: RowIssue[] = [];

  parsed.data.forEach((record, index) => {
    const line = index + 2;
    const raw = clip(record);
    const structural = structuralErrors.get(index);
    if (structural) {
      rejects.push({ row: line, reason: structural, raw });
      return;
    }
    const mapped: Record<string, string> = {};
    for (const [field, header] of Object.entries(mapping.columns)) {
      const value = record[header];
      if (typeof value === "string" && value.length > LIMITS.maxFieldLength) {
        rejects.push({ row: line, reason: `${header} is longer than ${LIMITS.maxFieldLength} characters`, raw });
        return;
      }
      mapped[field] = typeof value === "string" ? value : "";
    }
    const result = schema.safeParse(mapped);
    if (!result.success) {
      const reason = result.error.issues
        .map((issue) => {
          const field = issue.path[0];
          const header = typeof field === "string" ? (mapping.columns[field] ?? field) : "Row";
          return `${header} ${issue.message}`;
        })
        .join("; ");
      rejects.push({ row: line, reason, raw });
      return;
    }
    const value = result.data as RowFor<K>;
    const key = keyOf(value);
    if (key !== "") {
      const first = seen.get(key);
      if (first !== undefined) {
        rejects.push({ row: line, reason: `Duplicate of row ${first} in this file (${key.replaceAll("|", " / ")})`, raw });
        return;
      }
      seen.set(key, line);
    }
    rows.push({ row: line, value });
  });

  const columnsPresent = Object.entries(mapping.columns).filter(([, header]) => headers.includes(header)).map(([field]) => field);
  return { kind, rows, rejects, totalRows: parsed.data.length, columnsPresent };
}
