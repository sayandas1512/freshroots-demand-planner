import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { ruleConfigSchema } from "@/engine/config";
import { createConfigVersion } from "@/run/config-store";

export const dynamic = "force-dynamic";

const body = z.object({ config: ruleConfigSchema, note: z.string().trim().min(3, "Add a note saying why you are changing the rules").max(300) });

/** Saving never edits a version: it appends a new one and activates it. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue ? `${issue.path.join(".") || "request"}: ${issue.message}` : "Invalid settings" }, { status: 400 });
  }
  const saved = await createConfigVersion(await getDb(), parsed.data.config, parsed.data.note);
  return NextResponse.json({ version: saved.version });
}
