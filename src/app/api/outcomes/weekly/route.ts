import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { LIMITS } from "@/ingest/mapping";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { ingestWeeklyCsv, upsertWeekly, weeklyEntrySchema } from "@/outcomes/store";

export const dynamic = "force-dynamic";

/** One week as JSON, or a CSV upload (multipart `file`) of Week, Stockout_Incidents, Overstock_Value_INR. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "outcomes");
  if (isResponse(actor)) return actor;
  const limit = rateLimit(`outcomes:${clientKey(request.headers)}`, 30, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const db = await getDb();

  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const file = (await request.formData().catch(() => null))?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Attach a CSV file in the 'file' field." }, { status: 400 });
    if (file.size > LIMITS.maxBytes) return NextResponse.json({ error: "File is too large." }, { status: 413 });
    const result = await ingestWeeklyCsv(db, file.name, await file.text(), actor.userId);
    return NextResponse.json(result, { status: result.fileError ? 422 : 200 });
  }
  const parsed = weeklyEntrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid entry" }, { status: 400 });
  return NextResponse.json(await upsertWeekly(db, [parsed.data], "Manual entry", actor.userId));
}
