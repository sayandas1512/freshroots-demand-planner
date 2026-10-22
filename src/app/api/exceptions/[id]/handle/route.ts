import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { lockedByKill } from "@/kill/guards";
import { NotFoundError, applyExceptionAction, handleExceptionSchema } from "@/run/decisions";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission(request, "decide");
  if (isResponse(actor)) return actor;
  const locked = await lockedByKill(await getDb());
  if (locked) return locked;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = handleExceptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const row = await applyExceptionAction(await getDb(), id, parsed.data, actor.userId);
    return NextResponse.json({ id: row.id, status: row.status, handledNote: row.handledNote });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
