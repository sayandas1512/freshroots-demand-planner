import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { DEFAULT_RULE_CONFIG, type RuleConfig } from "@/engine/config";
import type { EngineData, SkuMaster } from "@/engine/types";
import { lastCompleteWeeks } from "@/engine/weeks";

export function csvRows(file: string): Record<string, string>[] {
  const text = readFileSync(`fixtures/${file}`, "utf8");
  return Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true }).data;
}

export function fixtureEngineData(asOf: string): EngineData {
  const skus: SkuMaster[] = csvRows("sku_master.csv").map((r) => ({
    skuId: r.SKU_ID as string,
    name: r.SKU_Name as string,
    category: r.Category as string,
    perishability: (r.Perishability as string).toLowerCase() === "high" ? "high" : "low",
    standardReorderQty: Number(r.Standard_Reorder_Qty),
    unit: r.Unit_of_Measure as string,
    distributorId: r.Distributor_ID as string,
  }));
  const sales = new Map<string, Map<string, number>>();
  for (const r of csvRows("sales.csv")) {
    const m = sales.get(r.SKU_ID as string) ?? new Map<string, number>();
    m.set(r.Week as string, Number(r.Units_Sold));
    sales.set(r.SKU_ID as string, m);
  }
  const stock = new Map<string, number>();
  for (const r of csvRows("inventory.csv")) stock.set(r.SKU_ID as string, (stock.get(r.SKU_ID as string) ?? 0) + Number(r.Units_On_Hand));
  const festivalMonths = new Set(csvRows("festival_calendar.csv").filter((r) => r.Is_Festival_Month === "TRUE").map((r) => r.Year_Month as string));
  return { asOf, skus, sales, stock, openPo: new Map(), festivalMonths };
}

export function config(overrides: Partial<RuleConfig> = {}): RuleConfig {
  return { ...DEFAULT_RULE_CONFIG, ...overrides };
}

/** Build engine data for one SKU with explicit weekly sales (oldest first, ending at the last complete week). */
export function singleSku(opts: {
  asOf?: string;
  units: number[];
  stock: number | undefined;
  perishable?: boolean;
  std?: number;
  openPo?: number;
  festival?: boolean;
  weeksBack?: number;
}): EngineData {
  const asOf = opts.asOf ?? "2026-05-18";
  const weeks = lastCompleteWeeks(asOf, opts.units.length);
  const sales = new Map<string, Map<string, number>>([["S1", new Map(weeks.map((w, i) => [w, opts.units[i] as number]))]]);
  const stock = new Map<string, number>();
  if (opts.stock !== undefined) stock.set("S1", opts.stock);
  return {
    asOf,
    skus: [{ skuId: "S1", name: "Test SKU", category: "Snacks", perishability: opts.perishable ? "high" : "low", standardReorderQty: opts.std ?? 100, unit: "case", distributorId: "D1" }],
    sales,
    stock,
    openPo: new Map(opts.openPo === undefined ? [] : [["S1", opts.openPo]]),
    festivalMonths: new Set(opts.festival ? [asOf.slice(0, 7)] : []),
  };
}

export const flat = (value: number, n = 12): number[] => Array.from({ length: n }, () => value);
