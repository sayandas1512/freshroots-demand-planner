import { addDays, isoWeekOf, lastCompleteWeeks, weekStart } from "@/engine/weeks";

/**
 * Full-size synthetic data in the real file formats: 400 SKUs, 156 weeks (3 years), 1,200 distributors, with annual
 * seasonality, the three festival months and the awkward cases a real extract has (new SKUs, short history, zero demand,
 * jumps, missing stock). Deterministic for a given seed. Used by `npm run gen:synthetic` and the scale tests.
 */
export interface SyntheticOptions {
  skus: number;
  weeks: number;
  distributors: number;
  asOf: string;
  seed: number;
  /** Also produce distributor-level sales (about 6 distributors per SKU). Large, so it is split into several files. */
  withDistributorSales: boolean;
}

export const DEFAULT_SYNTHETIC: SyntheticOptions = { skus: 400, weeks: 156, distributors: 1200, asOf: "2026-10-19", seed: 7, withDistributorSales: false };

export interface SyntheticFiles {
  distributors: string;
  sku_master: string;
  sales: string;
  inventory: string;
  festival_calendar: string;
  /** Present when `withDistributorSales` is set. Each file stays under the 100,000-row upload limit. */
  sales_by_distributor: string[];
  edgeCases: { newSkus: string[]; shortHistory: string[]; zeroDemand: string[]; jump: string[]; missingStock: string[] };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const CATEGORIES = ["Snacks", "Staples", "Beverages", "Spices", "Sweets"];

export function generateSynthetic(options: Partial<SyntheticOptions> = {}): SyntheticFiles {
  const o = { ...DEFAULT_SYNTHETIC, ...options };
  const rand = mulberry32(o.seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const weeks = lastCompleteWeeks(o.asOf, o.weeks);
  const festivalMonths = new Set([3, 10, 11]);

  const distributorIds = Array.from({ length: o.distributors }, (_, i) => `D${pad(i + 1, 4)}`);
  const distributors = ["Distributor_ID,Distributor_Name,Region,Status", ...distributorIds.map((id, i) => `${id},Distributor ${i + 1},${rand() < 0.94 ? "Maharashtra" : "Goa"},Active`)];

  const skuIds = Array.from({ length: o.skus }, (_, i) => `SKU${pad(i + 1, 4)}`);
  const edge = { newSkus: skuIds.slice(0, 5), shortHistory: skuIds.slice(5, 10), zeroDemand: skuIds.slice(10, 13), jump: skuIds.slice(13, 16), missingStock: skuIds.slice(16, 20) };
  const hot = skuIds.slice(20, 22);

  const master = ["SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID,Lead_Time_Weeks,MOQ"];
  const sales = ["SKU_ID,Week,Units_Sold"];
  const inventory = ["SKU_ID,Location,Units_On_Hand,As_Of_Date"];
  const byDistributor: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) byDistributor.push(["SKU_ID,Week,Units_Sold,Distributor_ID", ...current]);
    current = [];
  };

  skuIds.forEach((id, idx) => {
    const perishable = rand() < 0.2;
    const base = 15 + Math.exp(rand() * Math.log(25)) * 12; // roughly 27 to 700 units a week
    const amplitude = 0.08 + rand() * 0.17;
    const phase = rand() * Math.PI * 2;
    const trend = (rand() - 0.5) * 0.002;
    const category = CATEGORIES[idx % CATEGORIES.length] as string;
    master.push(`${id},${category} item ${idx + 1},${category},${perishable ? "High" : "Low"},${int(2, 12) * 50},case,${distributorIds[int(0, distributorIds.length - 1)]},${int(1, 4)},${int(0, 2) * 50 + 50}`);

    const isNew = edge.newSkus.includes(id);
    const isShort = edge.shortHistory.includes(id);
    const isZero = edge.zeroDemand.includes(id);
    const isJump = edge.jump.includes(id);
    const isHot = hot.includes(id);
    const served = Array.from({ length: 6 }, () => distributorIds[int(0, distributorIds.length - 1)] as string);
    const shares = [0.3, 0.25, 0.2, 0.12, 0.08, 0.05];

    let avgUnits = 0;
    let counted = 0;
    weeks.forEach((week, i) => {
      if (isNew) return;
      if (isShort && i < weeks.length - 8) return;
      const month = Number(weekStart(week).slice(5, 7));
      const season = 1 + amplitude * Math.sin((2 * Math.PI * i) / 52 + phase);
      const festival = festivalMonths.has(month) ? 1.25 + rand() * 0.15 : 1;
      const noise = 1 + (rand() - 0.5) * 0.16;
      let units = isZero ? 0 : Math.max(0, Math.round(base * season * festival * noise * (1 + trend * i)));
      if (isHot && i >= weeks.length - 4) units = Math.round(units * 1.45);
      if (isJump && i === weeks.length - 1) units = Math.round(units * 3.2) + 20;
      sales.push(`${id},${week},${units}`);
      if (i >= weeks.length - 12) {
        avgUnits += units;
        counted += 1;
      }
      if (o.withDistributorSales && units > 0) {
        let left = units;
        served.forEach((d, k) => {
          const part = k === served.length - 1 ? left : Math.min(left, Math.floor(units * (shares[k] as number)));
          left -= part;
          if (part > 0) current.push(`${id},${week},${part},${d}`);
        });
        if (current.length >= 90_000) flush();
      }
    });

    if (!edge.missingStock.includes(id)) {
      const avg = counted > 0 ? avgUnits / counted : base;
      const coverWeeks = perishable ? 1 + rand() * 5 : 2 + rand() * 18;
      inventory.push(`${id},Pune Central Warehouse,${Math.round(avg * coverWeeks)},${o.asOf}`);
    }
  });
  flush();

  const startYear = Number(isoWeekOf(addDays(o.asOf, -7 * o.weeks)).slice(0, 4));
  const endYear = Number(o.asOf.slice(0, 4));
  const calendar = ["Year,Month,Year_Month,Is_Festival_Month"];
  for (let y = startYear; y <= endYear; y += 1) {
    for (let m = 1; m <= 12; m += 1) calendar.push(`${y},${m},${y}-${pad(m, 2)},${festivalMonths.has(m) ? "TRUE" : "FALSE"}`);
  }

  const join = (lines: string[]) => `${lines.join("\n")}\n`;
  return {
    distributors: join(distributors),
    sku_master: join(master),
    sales: join(sales),
    inventory: join(inventory),
    festival_calendar: join(calendar),
    sales_by_distributor: byDistributor.map(join),
    edgeCases: edge,
  };
}
