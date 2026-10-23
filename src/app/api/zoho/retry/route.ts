import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { log } from "@/lib/log";
import { allowRetry } from "@/zoho/push";

export const dynamic = "force-dynamic";

const body = z.object({ reference: z.string().regex(/^FR-[0-9a-f]{8}-.{1,12}$/) });

/** A person has looked in Zoho and confirms the draft PO is not there, so the push may try that PO again. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "export");
  if (isResponse(actor)) return actor;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid reference" }, { status: 400 });
  const ok = await allowRetry(await getDb(), parsed.data.reference);
  log("warn", "zoho retry confirmed", { reference: parsed.data.reference, userId: actor.userId, ok });
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Nothing to reset: that PO is created or unknown." }, { status: 409 });
}
