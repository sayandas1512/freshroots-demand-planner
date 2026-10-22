import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { GO_LIVE_ITEMS } from "@/golive/items";
import { tickItem, untickItem } from "@/golive/readiness";

export const dynamic = "force-dynamic";

const body = z.object({ key: z.string().min(1).max(60), action: z.enum(["tick", "untick"]), note: z.string().trim().max(300).optional() });

/** A named user ticks an item. Some items are limited to the sponsor or an admin. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "goLive");
  if (isResponse(actor)) return actor;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const item = GO_LIVE_ITEMS.find((i) => i.key === parsed.data.key);
  if (!item) return NextResponse.json({ error: "Unknown checklist item" }, { status: 404 });
  if (!(item.roles as readonly string[]).includes(actor.role)) return NextResponse.json({ error: `Your role (${actor.role}) cannot tick "${item.label}".` }, { status: 403 });
  if (!actor.userId) return NextResponse.json({ error: "A named user must tick checklist items." }, { status: 403 });
  const db = await getDb();
  if (parsed.data.action === "tick") await tickItem(db, { key: item.key, userId: actor.userId, note: parsed.data.note ?? null });
  else await untickItem(db, item.key);
  return NextResponse.json({ ok: true });
}
