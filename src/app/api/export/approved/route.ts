import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { toPurchaseOrderCsv } from "@/export/csv";
import { approvedExportLines } from "@/export/query";

export const dynamic = "force-dynamic";

/** Purchase-order CSV of approved and edited lines only. Rejected, pending and quantity-less lines are never included. */
export async function GET(request: Request) {
  const run = new URL(request.url).searchParams.get("run");
  if (!z.string().uuid().safeParse(run).success) return NextResponse.json({ error: "run must be a run id" }, { status: 400 });
  const lines = await approvedExportLines(await getDb(), run as string);
  const csv = toPurchaseOrderCsv(lines);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="freshroots-po-${(run as string).slice(0, 8)}.csv"`,
      "cache-control": "no-store",
      "x-line-count": String(lines.length),
    },
  });
}
