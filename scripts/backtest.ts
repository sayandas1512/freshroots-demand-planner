import "./env";
import { readFileSync, writeFileSync } from "node:fs";
import { disagreements, disagreementsCsv, ordersFromRows } from "../src/backtest/compare";
import { runBacktest } from "../src/backtest/replay";
import { getDb } from "../src/db/client";
import { parseCsv } from "../src/ingest/parse";

/** npm run backtest -- --from 2026-W39 --to 2026-W42 [--orders orders.csv] [--out disagreements.csv] */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const from = arg("from");
const to = arg("to");
if (!from || !to) {
  console.error("Usage: npm run backtest -- --from 2026-W39 --to 2026-W42 [--orders orders.csv] [--out disagreements.csv]");
  process.exit(1);
}

let orders = null;
const ordersPath = arg("orders");
if (ordersPath) {
  const parsed = parseCsv("orders", readFileSync(ordersPath, "utf8"));
  if (parsed.fileError) {
    console.error(`Orders file: ${parsed.fileError}`);
    process.exit(1);
  }
  if (parsed.rejects.length > 0) console.warn(`${parsed.rejects.length} order rows were rejected (first: row ${parsed.rejects[0]?.row}: ${parsed.rejects[0]?.reason}).`);
  orders = ordersFromRows(parsed.rows);
}

const outcome = await runBacktest(await getDb(), { from, to, orders });
console.log(`Backtest ${outcome.runId}: ${outcome.weeks.length} weeks (${from} to ${to}), ${outcome.rows.length} lines`);
for (const note of outcome.notes) console.log(`  note: ${note}`);

if (!outcome.hasOrders) {
  console.log("\nNo orders file given, so there is nothing to compare against. Showing the system's lines only.\n");
  for (const r of outcome.rows) console.log(`${r.week}  ${r.skuId.padEnd(8)} ${r.systemAction.padEnd(32)} ${r.systemQty ?? ""}`);
} else {
  const { overall, byAction } = outcome.summary;
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  console.log(`\nAgreement: ${pct(overall.rate)} (${overall.agreed} of ${overall.compared} comparable lines)`);
  for (const [action, s] of Object.entries(byAction)) console.log(`  ${action.padEnd(32)} ${pct(s.rate).padStart(7)}  (${s.agreed}/${s.compared} of ${s.lines} lines)`);
  const wrong = disagreements(outcome.rows);
  const out = arg("out") ?? "backtest-disagreements.csv";
  writeFileSync(out, disagreementsCsv(wrong));
  console.log(`\n${wrong.length} disagreements written to ${out}`);
}
process.exit(0);
