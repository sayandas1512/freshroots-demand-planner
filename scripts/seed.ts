import "./env";
import { getDb } from "../src/db/client";
import { loadDemoOutcomes, loadFixtures } from "../src/db/seed";

const dirArg = process.argv.indexOf("--dir");
const db = await getDb();
for (const r of await loadFixtures(db, dirArg >= 0 ? process.argv[dirArg + 1] : undefined)) {
  console.log(`${r.kind.padEnd(18)} accepted ${String(r.accepted).padStart(4)}  rejected ${String(r.rejected).padStart(3)}  replaced ${String(r.replaced).padStart(4)}`);
}
const demo = await loadDemoOutcomes(db);
console.log(`outcomes            ${demo.weeks} baseline weeks, ${demo.frozenWeeks} frozen; measuring from 2026-10-12`);
process.exit(0);
