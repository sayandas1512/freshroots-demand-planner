import { after, NextResponse } from "next/server";
import { bearerMatches } from "@/auth/session";
import { getDb } from "@/db/client";
import { todayIst } from "@/lib/dates";
import { executeRun, startRun } from "@/run/execute";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel Cron, Mon and Thu 07:00 IST. Sends "Authorization: Bearer $CRON_SECRET". */
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  const started = await startRun(db, { trigger: "cron", asOf: todayIst() });
  if (started.reason === "killed") return NextResponse.json({ runId: started.runId, reason: "killed" });
  if (started.created) after(() => executeRun(db, started.runId));
  return NextResponse.json({ runId: started.runId, reason: started.reason });
}
