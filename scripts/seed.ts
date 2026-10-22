import "./env";
import { getDb } from "../src/db/client";
import { loadFixtures } from "../src/db/seed";

const dirArg = process.argv.indexOf("--dir");
const db = await getDb();
for (const r of await loadFixtures(db, dirArg >= 0 ? process.argv[dirArg + 1] : undefined)) {
  console.log(`${r.kind.padEnd(18)} accepted ${String(r.accepted).padStart(4)}  rejected ${String(r.rejected).padStart(3)}  replaced ${String(r.replaced).padStart(4)}`);
}
process.exit(0);
