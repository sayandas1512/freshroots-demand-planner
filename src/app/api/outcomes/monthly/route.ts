import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { monthlyEntrySchema, upsertMonthly } from "@/outcomes/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await requirePermission(request, "outcomes");
  if (isResponse(actor)) return actor;
  const parsed = monthlyEntrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid entry" }, { status: 400 });
  const { methodChanged } = await upsertMonthly(await getDb(), parsed.data, actor.userId);
  return NextResponse.json({ saved: parsed.data.period, methodChanged });
}
