import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { LIMITS } from "@/ingest/mapping";
import { parseCsv } from "@/ingest/parse";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { disagreements } from "@/backtest/compare";
import { ordersFromShadowRows, shadowComparison } from "@/shadow/compare";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Upload Raghav's own monthly forecast or orders (SKU_ID, Period, Qty) and compare with the system's shadow runs. Nothing is stored. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "backtest");
  if (isResponse(actor)) return actor;
  const limit = rateLimit(`shadow:${clientKey(request.headers)}`, 10, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Too many requests. Wait a minute." }, { status: 429 });
  const file = (await request.formData().catch(() => null))?.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Attach a CSV with SKU_ID, Period, Qty." }, { status: 400 });
  if (file.size > LIMITS.maxBytes) return NextResponse.json({ error: "The file is too large." }, { status: 413 });
  const parsed = parseCsv("shadow_orders", await file.text());
  if (parsed.fileError) return NextResponse.json({ error: parsed.fileError }, { status: 422 });
  const result = await shadowComparison(await getDb(), ordersFromShadowRows(parsed.rows));
  return NextResponse.json({ ...result, rejected: parsed.rejects.length, rejects: parsed.rejects.slice(0, 50), disagreementCount: disagreements(result.rows).length });
}
