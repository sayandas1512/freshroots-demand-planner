import { after, NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { driveRun } from "@/run/drive";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Do the next bounded piece of a run, then chain to the next invocation. Answers at once; the work happens after the response. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission(request, "run");
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const db = await getDb();
  const origin = new URL(request.url).origin;
  after(() => driveRun(db, origin, id));
  return NextResponse.json({ accepted: true }, { status: 202 });
}
