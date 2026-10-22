import "./env";
import { getDb } from "../src/db/client";
import { startAndExecute } from "../src/run/execute";
import { runs, recommendations, exceptions } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { todayIst } from "../src/lib/dates";



const asOfArg = process.argv.find((a) => a.startsWith("--as-of="))?.slice("--as-of=".length);
const asOf = asOfArg ?? todayIst();

const db = await getDb();
const started = await startAndExecute(db, { trigger: "manual", asOf });
const [run] = await db.select().from(runs).where(eq(runs.id, started.runId));
const lines = await db.select().from(recommendations).where(eq(recommendations.runId, started.runId));
const exc = await db.select().from(exceptions).where(eq(exceptions.runId, started.runId));

console.log(`Run ${started.runId} (${started.reason}) as of ${asOf}: ${run?.status}, LLM ${run?.llmStatus}`);
console.log(`${lines.length} recommendation lines, ${exc.length} exceptions`);
for (const l of lines) {
  console.log(`${l.skuId.padEnd(7)} ${l.action.padEnd(13)} ${String(l.qty ?? "-").padStart(5)}  ${l.ruleFired.padEnd(36)} [${l.explanationSource}] ${l.explanation}`);
}
for (const e of exc) console.log(`${e.skuId.padEnd(7)} EXCEPTION ${e.type}: ${e.detail}`);
process.exit(0);
