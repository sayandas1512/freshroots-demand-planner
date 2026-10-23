import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { ruleConfigSchema } from "@/engine/config";
import { ForbiddenError, saveConfigChange } from "@/run/config-save";

export const dynamic = "force-dynamic";

const body = z.object({ config: ruleConfigSchema, note: z.string().trim().min(3, "Add a note saying why you are changing the settings").max(300) });

/** Saving never edits a version: it appends a new one and activates it. What you may change depends on your role. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "view");
  if (isResponse(actor)) return actor;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue ? `${issue.path.join(".") || "request"}: ${issue.message}` : "Invalid settings" }, { status: 400 });
  }
  try {
    const saved = await saveConfigChange(await getDb(), { config: parsed.data.config, note: parsed.data.note, actor });
    return NextResponse.json({ version: saved.version });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
