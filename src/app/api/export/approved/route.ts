import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { exportLog } from "@/db/schema";
import { toPurchaseOrderCsv } from "@/export/csv";
import { approvedExportLines } from "@/export/query";
import { exportBlocked } from "@/kill/guards";
import { log } from "@/lib/log";
import { getActiveConfig } from "@/run/config-store";

export const dynamic = "force-dynamic";

/** Purchase-order CSV of approved and edited lines only. Blocked while the kill switch is on. Every download is logged. */
export async function GET(request: Request) {
  const actor = await requirePermission(request, "export");
  if (isResponse(actor)) return actor;
  const db = await getDb();
  const blocked = await exportBlocked(db);
  if (blocked) return blocked;
  const run = new URL(request.url).searchParams.get("run");
  if (!z.string().uuid().safeParse(run).success) return NextResponse.json({ error: "run must be a run id" }, { status: 400 });
  const lines = await approvedExportLines(db, run as string);
  const { config } = await getActiveConfig(db);
  const csv = toPurchaseOrderCsv(lines, config.export_id_label);
  const totalQty = lines.reduce((a, l) => a + l.quantity, 0);
  await db.insert(exportLog).values({ runId: run as string, userId: actor.userId, lineCount: lines.length, totalQty, kind: "download" });
  log("info", "export downloaded", { runId: run, lines: lines.length, totalQty, userId: actor.userId });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="freshroots-po-${(run as string).slice(0, 8)}.csv"`,
      "cache-control": "no-store",
      "x-line-count": String(lines.length),
    },
  });
}
