import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { disagreementsCsv } from "@/backtest/compare";
import { getDb } from "@/db/client";
import { backtestResults } from "@/db/schema";

export const dynamic = "force-dynamic";

/** CSV of the lines where the system and the orders disagreed. */
export async function GET(request: Request) {
  const run = new URL(request.url).searchParams.get("run");
  if (!z.string().uuid().safeParse(run).success) return NextResponse.json({ error: "run must be a run id" }, { status: 400 });
  const rows = await (await getDb()).select().from(backtestResults).where(and(eq(backtestResults.runId, run as string), eq(backtestResults.agreed, false))).orderBy(backtestResults.week, backtestResults.skuId);
  const csv = disagreementsCsv(
    rows.map((r) => ({
      week: r.week,
      skuId: r.skuId,
      systemAction: r.systemAction,
      systemQty: r.systemQty,
      raghavAction: r.raghavAction === "ORDER" || r.raghavAction === "NO_ORDER" ? r.raghavAction : null,
      orderedQty: r.orderedQty,
      agreed: false,
    })),
  );
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="backtest-disagreements-${(run as string).slice(0, 8)}.csv"`, "cache-control": "no-store" } });
}
