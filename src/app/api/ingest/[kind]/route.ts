import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { ingestCsv } from "@/ingest/ingest";
import { LIMITS, isIngestKind } from "@/ingest/mapping";
import { clientKey, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  if (!isIngestKind(kind)) return NextResponse.json({ error: `Unknown file kind: ${kind}` }, { status: 404 });

  const limit = rateLimit(`ingest:${clientKey(request.headers)}`, 30, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Too many uploads. Try again shortly." }, { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > LIMITS.maxBytes + 10_000) return NextResponse.json({ error: "File is too large." }, { status: 413 });

  let fileName = `${kind}.csv`;
  let text: string;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Attach a CSV file in the 'file' field." }, { status: 400 });
    if (file.size > LIMITS.maxBytes) return NextResponse.json({ error: "File is too large." }, { status: 413 });
    fileName = file.name;
    text = await file.text();
  } else {
    text = await request.text();
  }

  const report = await ingestCsv(await getDb(), kind, fileName, text);
  return NextResponse.json(report, { status: report.fileError ? 422 : 200 });
}
