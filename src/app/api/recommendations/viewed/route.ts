import { and, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { recommendations } from "@/db/schema";

export const dynamic = "force-dynamic";

const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

/** Record the first time a row was in view for a second. Only the first view counts, so scrolling back changes nothing. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "decide");
  if (isResponse(actor)) return actor;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  await (await getDb()).update(recommendations).set({ firstViewedAt: new Date() }).where(and(inArray(recommendations.id, parsed.data.ids), isNull(recommendations.firstViewedAt)));
  return NextResponse.json({ ok: true });
}
