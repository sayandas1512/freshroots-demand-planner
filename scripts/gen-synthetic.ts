import { mkdirSync, writeFileSync } from "node:fs";
import { generateSynthetic } from "../src/synthetic/generate";

/** npm run gen:synthetic [-- --with-distributor-sales] -> fixtures/synthetic/*.csv (400 SKUs, 156 weeks, 1,200 distributors) */
const withDistributorSales = process.argv.includes("--with-distributor-sales");
const files = generateSynthetic({ withDistributorSales });
const dir = "fixtures/synthetic";
mkdirSync(dir, { recursive: true });
const write = (name: string, text: string) => {
  writeFileSync(`${dir}/${name}`, text);
  console.log(`${dir}/${name}: ${text.split("\n").length - 2} rows`);
};
write("distributors.csv", files.distributors);
write("sku_master.csv", files.sku_master);
write("sales.csv", files.sales);
write("inventory.csv", files.inventory);
write("festival_calendar.csv", files.festival_calendar);
files.sales_by_distributor.forEach((f, i) => write(`sales_by_distributor_${i + 1}.csv`, f));
console.log("Load order: distributors, sku_master, festival_calendar, sales, inventory (Data page or npm run seed -- --dir fixtures/synthetic).");
