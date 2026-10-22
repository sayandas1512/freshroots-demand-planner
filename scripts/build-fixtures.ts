/**
 * Regenerates /fixtures. The original SAP sample files were not available, so these are synthesised to
 * reproduce the section 7 golden table exactly (verified here and again in tests/golden.test.ts).
 * Run: npm run fixtures:build
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { GOLDEN, GOLDEN_AS_OF, roundHalfEven } from "../tests/golden-table";
import { addDays, isoWeekOf, weekStart } from "../src/engine/weeks";

interface SkuDef { name: string; category: string; std: number; unit: string; dist: string }
const DEFS: Record<string, SkuDef> = {
  SKU001: { name: "Masala Peanuts 200g", category: "Snacks", std: 600, unit: "case", dist: "D001" },
  SKU002: { name: "Rice Flour 1kg", category: "Staples", std: 800, unit: "case", dist: "D002" },
  SKU003: { name: "Poha Thick 500g", category: "Staples", std: 500, unit: "case", dist: "D001" },
  SKU004: { name: "Fresh Bhakarwadi 250g", category: "Snacks", std: 240, unit: "case", dist: "D003" },
  SKU005: { name: "Toor Dal 1kg", category: "Staples", std: 400, unit: "case", dist: "D002" },
  SKU006: { name: "Whole Wheat Atta 5kg", category: "Staples", std: 300, unit: "bag", dist: "D004" },
  SKU007: { name: "Fresh Farsan Mix 300g", category: "Snacks", std: 400, unit: "case", dist: "D003" },
  SKU008: { name: "Sunflower Oil 1L", category: "Staples", std: 500, unit: "case", dist: "D001" },
  SKU009: { name: "Sabudana 500g", category: "Staples", std: 250, unit: "case", dist: "D004" },
  SKU010: { name: "Jaggery Powder 500g", category: "Staples", std: 200, unit: "case", dist: "D002" },
  SKU011: { name: "Soft Chikki 150g", category: "Snacks", std: 600, unit: "case", dist: "D003" },
  SKU012: { name: "Banana Chips 150g", category: "Snacks", std: 300, unit: "case", dist: "D001" },
  SKU013: { name: "Roasted Chana 400g", category: "Snacks", std: 250, unit: "case", dist: "D004" },
  SKU014: { name: "Besan 1kg", category: "Staples", std: 350, unit: "case", dist: "D002" },
  SKU015: { name: "Cumin Seeds 100g", category: "Staples", std: 150, unit: "case", dist: "D001" },
};

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Split `total` into `n` integers close to total/n with +-`spread` noise. Sums exactly to `total`. */
function split(total: number, n: number, spread: number, rand: () => number): number[] {
  const base = total / n;
  const out = Array.from({ length: n }, () => Math.max(1, Math.round(base * (1 + (rand() * 2 - 1) * spread))));
  let diff = total - out.reduce((a, b) => a + b, 0);
  let i = 0;
  while (diff !== 0) {
    const step = diff > 0 ? 1 : -1;
    const idx = i % n;
    if ((out[idx] as number) + step >= 1) { out[idx] = (out[idx] as number) + step; diff -= step; }
    i += 1;
  }
  return out;
}

function findSums(row: (typeof GOLDEN)[number]): { s12: number; s4: number } {
  const noUpliftOk = (s12: number) => row.coverNoUplift === undefined || roundHalfEven(row.stock / (s12 / 12), 1) === row.coverNoUplift;
  for (let delta = 0; delta < 40; delta += 1) {
    for (const sign of [1, -1]) {
      const s12 = Math.round(row.avg12 * 12) + sign * delta;
      if (roundHalfEven(s12 / 12, 1) !== row.avg12) continue;
      if (roundHalfEven(row.stock / ((s12 / 12) * 1.25), 1) !== row.cover || !noUpliftOk(s12)) continue;
      for (let d4 = 0; d4 < 6; d4 += 1) {
        for (const sg of [1, -1]) {
          const s4 = Math.round(row.recent4 * 4) + sg * d4;
          if (roundHalfEven(s4 / 4, 1) !== row.recent4) continue;
          if (roundHalfEven(s4 / 4 / (s12 / 12), 2) !== row.ratio) continue;
          return { s12, s4 };
        }
      }
    }
  }
  throw new Error(`No integer sums reproduce ${row.skuId}`);
}

const lastWeekStart = weekStart(isoWeekOf(addDays(GOLDEN_AS_OF, -7)));
const weeks = Array.from({ length: 16 }, (_, i) => isoWeekOf(addDays(lastWeekStart, -7 * (15 - i))));
if (weeks[0] !== "2026-W27" || weeks[15] !== "2026-W42") throw new Error("Week range drifted");

const salesRows: string[] = ["SKU_ID,Week,Units_Sold"];
GOLDEN.forEach((row, idx) => {
  const rand = mulberry32(1000 + idx);
  const { s12, s4 } = findSums(row);
  const recent = split(s4, 4, 0.04, rand);
  const mid = split(s12 - s4, 8, 0.05, rand);
  const old = split(Math.round(row.avg12 * 4), 4, 0.06, rand);
  const units = [...old, ...mid, ...recent];
  weeks.forEach((w, i) => salesRows.push(`${row.skuId},${w},${units[i]}`));
});

const master = ["SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID"];
for (const row of GOLDEN) {
  const d = DEFS[row.skuId] as SkuDef;
  master.push(`${row.skuId},${d.name},${d.category},${row.perishable ? "High" : "Low"},${d.std},${d.unit},${d.dist}`);
}
const distributors = [
  "Distributor_ID,Distributor_Name,Region,Status",
  "D001,Sahyadri Agencies,Pune,Active",
  "D002,Konkan Foods Distribution,Goa,Active",
  "D003,Deccan Fresh Traders,Pune,Active",
  "D004,Marathwada Supply Co,Chhatrapati Sambhajinagar,Active",
];
const inventory = ["SKU_ID,Location,Units_On_Hand,As_Of_Date", ...GOLDEN.map((r) => `${r.skuId},Pune Central Warehouse,${r.stock},${GOLDEN_AS_OF}`)];
const festival = ["Year,Month,Year_Month,Is_Festival_Month"];
for (const year of [2025, 2026]) {
  for (let month = 1; month <= 12; month += 1) {
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    festival.push(`${year},${month},${ym},${[3, 10, 11].includes(month) ? "TRUE" : "FALSE"}`);
  }
}

mkdirSync("fixtures", { recursive: true });
const write = (name: string, lines: string[]) => writeFileSync(`fixtures/${name}`, `${lines.join("\n")}\n`);
write("sales.csv", salesRows);
write("sku_master.csv", master);
write("distributors.csv", distributors);
write("inventory.csv", inventory);
write("festival_calendar.csv", festival);
write("broken_sales.csv", [
  "SKU_ID,Week,Units_Sold",
  "SKU001,2026-W42,300", // ok
  "SKU002,2026-W99,120", // not an ISO week
  "SKU003,2026-W42,-5", // negative units
  "SKU004,2026-W42,abc", // not a number
  ",2026-W42,10", // blank SKU
  "SKU005,2026-W42,95.5", // fractional units
  "SKU005,2026-W42,90", // ok
  "SKU005,2026-W42,91", // duplicate of the previous row
  '"=HYPERLINK(""http://evil"")",2026-W42,10', // formula in the SKU column
  "SKU777,2026-W42,40", // ok, but not in the SKU master (warning)
]);
console.log(`Wrote fixtures: ${salesRows.length - 1} sales rows`);
