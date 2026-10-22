import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getUser } from "@/auth/users";
import { getDb } from "@/db/client";
import { tripKill } from "@/kill/state";

export const dynamic = "force-dynamic";

const body = z.object({ reason: z.string().trim().min(3, "Say why you are stopping it").max(300) });

/** Any signed-in user may stop the system. Stopping is always safe: it only removes automation. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "stop");
  if (isResponse(actor)) return actor;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const db = await getDb();
  const user = actor.userId ? await getUser(db, actor.userId) : null;
  const tripped = await tripKill(db, { kind: "trip_manual", reason: parsed.data.reason, setBy: actor.userId, label: user ? `${user.name} (${user.role})` : "system" });
  return NextResponse.json({ tripped });
}
