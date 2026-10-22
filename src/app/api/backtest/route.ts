import { NextResponse } from "next/server";
import { z } from "zod";
import { ordersFromRows, disagreements } from "@/backtest/compare";
import { runBacktest } from "@/backtest/replay";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { LIMITS } from "@/ingest/mapping";
import { parseCsv } from "@/ingest/parse";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { WEEK_PATTERN } from "@/engine/weeks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const fields = z.object({ from: z.string().regex(WEEK_PATTERN), to: z.string().regex(WEEK_PATTERN) });

export async function POST(request: Request) {
  const actor = await requirePermission(request, "backtest");
  if (isResponse(actor)) return actor;
  const limit = rateLimit(`backtest:${clientKey(request.headers)}`, 10, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Too many backtests. Wait a minute." }, { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the weeks and an optional orders file as a form." }, { status: 400 });
  const parsed = fields.safeParse({ from: form.get("from"), to: form.get("to") });
  if (!parsed.success) return NextResponse.json({ error: "Pick a first and last week like 2026-W39." }, { status: 400 });

  let orders: ReturnType<typeof ordersFromRows> | null = null;
  let orderRejects = 0;
  const file = form.get("orders");
  if (file instanceof File && file.size > 0) {
    if (file.size > LIMITS.maxBytes) return NextResponse.json({ error: "The orders file is too large." }, { status: 413 });
    const result = parseCsv("orders", await file.text());
    if (result.fileError) return NextResponse.json({ error: `Orders file: ${result.fileError}` }, { status: 422 });
    orders = ordersFromRows(result.rows);
    orderRejects = result.rejects.length;
  }

  try {
    const outcome = await runBacktest(await getDb(), { ...parsed.data, orders });
    const wrong = disagreements(outcome.rows);
    return NextResponse.json({
      runId: outcome.runId,
      weeks: outcome.weeks,
      hasOrders: outcome.hasOrders,
      orderRowsRejected: orderRejects,
      notes: outcome.notes,
      summary: outcome.summary,
      rows: outcome.rows.slice(0, 3000),
      disagreementCount: wrong.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Backtest failed" }, { status: 400 });
  }
}
