import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { runKillCheck } from "@/kill/run";

export const dynamic = "force-dynamic";

/** Evaluate the kill criteria now. If one is met the system stops, exactly as when the check runs after a run. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "run");
  if (isResponse(actor)) return actor;
  const result = await runKillCheck(await getDb(), { trigger: "manual" });
  return NextResponse.json({ tripped: result.tripped, trippedNow: result.trippedNow, kill: result.kill.map((c) => c.id), warnings: result.warnings.map((c) => c.id) });
}
