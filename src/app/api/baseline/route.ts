import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { baseline } from "@/db/schema";

export const dynamic = "force-dynamic";

const money = z.number().int().min(0).max(1_000_000_000);
const body = z.object({
  period: z.string().trim().regex(/^\d{4}-Q[1-4]$/, "Use a quarter like 2026-Q4"),
  stockoutLossInr: money,
  writeoffInr: money,
  source: z.string().trim().min(3).max(200),
});

/** Manual entry for Deepa's before/after comparison. Re-entering a quarter replaces it. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "outcomes");
  if (isResponse(actor)) return actor;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid entry" }, { status: 400 });
  const v = parsed.data;
  await (await getDb())
    .insert(baseline)
    .values({ period: v.period, stockoutLossInr: v.stockoutLossInr, stockoutLossInrHigh: null, writeoffInr: v.writeoffInr, writeoffInrHigh: null, source: v.source })
    .onConflictDoUpdate({
      target: baseline.period,
      set: { stockoutLossInr: sql`excluded.stockout_loss_inr`, stockoutLossInrHigh: null, writeoffInr: sql`excluded.writeoff_inr`, writeoffInrHigh: null, source: sql`excluded.source` },
    });
  return NextResponse.json({ saved: v.period });
}
