import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { ruleConfigSchema } from "@/engine/config";
import { previewImpact } from "@/run/preview";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await requirePermission(request, "view");
  if (isResponse(actor)) return actor;
  const parsed = z.object({ config: ruleConfigSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue ? `${issue.path.join(".") || "request"}: ${issue.message}` : "Invalid settings" }, { status: 400 });
  }
  return NextResponse.json(await previewImpact(await getDb(), parsed.data.config));
}
