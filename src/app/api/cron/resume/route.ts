import { after, NextResponse } from "next/server";
import { bearerMatches } from "@/auth/session";
import { getDb } from "@/db/client";
import { driveRun } from "@/run/drive";
import { findStuckRuns } from "@/run/machine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Safety net: picks up any run that stopped being worked on (a lost hand-over, a crash) and carries on from its saved step. */
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await getDb();
  const stuck = await findStuckRuns(db);
  const origin = new URL(request.url).origin;
  for (const id of stuck) after(() => driveRun(db, origin, id));
  return NextResponse.json({ resumed: stuck });
}
