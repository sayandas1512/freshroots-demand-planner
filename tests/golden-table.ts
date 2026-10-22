import type { Flag } from "@/engine/types";

/** Section 7 of the brief: as of 2026-10-19, run date in October, mode cover_demand, default thresholds. */
export interface GoldenRow {
  skuId: string;
  perishable: boolean;
  avg12: number;
  recent4: number;
  ratio: number;
  stock: number;
  cover: number;
  flags: Flag[];
  /** Cover with no uplift, only asserted where the brief states it. */
  coverNoUplift?: number;
}

export const GOLDEN_AS_OF = "2026-10-19";

export const GOLDEN: GoldenRow[] = [
  { skuId: "SKU001", perishable: false, avg12: 214.9, recent4: 261.0, ratio: 1.21, stock: 900, cover: 3.4, flags: ["HIGH_DEMAND", "STOCKOUT_RISK"] },
  { skuId: "SKU002", perishable: false, avg12: 83.8, recent4: 83.8, ratio: 1.0, stock: 1200, cover: 11.5, flags: [], coverNoUplift: 14.3 },
  { skuId: "SKU003", perishable: false, avg12: 150.5, recent4: 150.8, ratio: 1.0, stock: 820, cover: 4.4, flags: ["STOCKOUT_RISK"] },
  { skuId: "SKU004", perishable: true, avg12: 79.8, recent4: 81.0, ratio: 1.01, stock: 180, cover: 1.8, flags: ["STOCKOUT_RISK"] },
  { skuId: "SKU005", perishable: false, avg12: 59.5, recent4: 58.2, ratio: 0.98, stock: 600, cover: 8.1, flags: [] },
  { skuId: "SKU006", perishable: false, avg12: 39.6, recent4: 40.2, ratio: 1.02, stock: 1100, cover: 22.2, flags: ["OVERSTOCK_RISK"] },
  { skuId: "SKU007", perishable: true, avg12: 121.5, recent4: 133.5, ratio: 1.1, stock: 620, cover: 4.1, flags: ["OVERSTOCK_RISK"] },
  { skuId: "SKU008", perishable: false, avg12: 108.8, recent4: 103.0, ratio: 0.95, stock: 950, cover: 7.0, flags: [] },
  { skuId: "SKU009", perishable: false, avg12: 34.1, recent4: 34.8, ratio: 1.02, stock: 400, cover: 9.4, flags: [] },
  { skuId: "SKU010", perishable: false, avg12: 24.4, recent4: 24.8, ratio: 1.01, stock: 260, cover: 8.5, flags: [] },
  { skuId: "SKU011", perishable: true, avg12: 204.3, recent4: 209.2, ratio: 1.02, stock: 460, cover: 1.8, flags: ["STOCKOUT_RISK"] },
  { skuId: "SKU012", perishable: false, avg12: 56.8, recent4: 60.0, ratio: 1.06, stock: 480, cover: 6.8, flags: [] },
  { skuId: "SKU013", perishable: false, avg12: 45.4, recent4: 44.8, ratio: 0.99, stock: 180, cover: 3.2, flags: ["STOCKOUT_RISK"] },
  { skuId: "SKU014", perishable: false, avg12: 72.4, recent4: 77.5, ratio: 1.07, stock: 620, cover: 6.8, flags: [] },
  { skuId: "SKU015", perishable: false, avg12: 29.8, recent4: 28.8, ratio: 0.96, stock: 360, cover: 9.7, flags: [] },
];

/** The brief's figures come from a tool that rounds half to even (209.25 -> 209.2), so tests use the same rule. */
export function roundHalfEven(value: number, decimals: number): number {
  const f = 10 ** decimals;
  const y = value * f;
  const floor = Math.floor(y);
  const diff = y - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return (floor % 2 === 0 ? floor : floor + 1) / f;
  return Math.round(y) / f;
}
