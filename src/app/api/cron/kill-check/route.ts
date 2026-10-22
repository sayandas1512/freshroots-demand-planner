import { NextResponse } from "next/server";
import { bearerMatches } from "@/auth/session";
import { getDb } from "@/db/client";
import { runKillCheck } from "@/kill/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Monthly kill check, 1st of each month 02:00 UTC. Same secret as the run cron. */
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await runKillCheck(await getDb(), { trigger: "monthly" });
  return NextResponse.json({ tripped: result.tripped, trippedNow: result.trippedNow, kill: result.kill.map((c) => c.id), warnings: result.warnings.map((c) => c.id) });
}
