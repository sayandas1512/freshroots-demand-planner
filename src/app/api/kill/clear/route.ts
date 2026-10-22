import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getUser } from "@/auth/users";
import { getDb } from "@/db/client";
import { KillNotActiveError, clearKill } from "@/kill/state";

export const dynamic = "force-dynamic";

const body = z.object({ note: z.string().trim().min(5, "Write a note of at least 5 characters saying why it is safe to restart").max(500) });

/** Only the sponsor or an admin can clear the kill switch, and only with a written note. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "clearKill");
  if (isResponse(actor)) return actor;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const db = await getDb();
  const user = actor.userId ? await getUser(db, actor.userId) : null;
  try {
    await clearKill(db, { setBy: actor.userId, label: user ? `${user.name} (${user.role})` : "system", note: parsed.data.note });
    return NextResponse.json({ cleared: true });
  } catch (err) {
    if (err instanceof KillNotActiveError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
