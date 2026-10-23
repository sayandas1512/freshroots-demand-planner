import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { clientRateKey } from "@/lib/ratelimit-keys";
import { rateLimit } from "@/lib/ratelimit";
import { clientOrResponse } from "@/zoho/guards";
import { syncZoho } from "@/zoho/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const body = z.object({ force: z.boolean().optional() });

/** "Sync now": pulls items, vendors and purchase orders from Zoho and rebuilds the open POs. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "upload");
  if (isResponse(actor)) return actor;
  const limit = rateLimit(clientRateKey("zoho-sync", request.headers), 6, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Too many syncs. Wait a minute." }, { status: 429 });
  const db = await getDb();
  const client = clientOrResponse(db);
  if (client instanceof NextResponse) return client;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  const report = await syncZoho(db, client, { trigger: "manual", force: parsed.success ? parsed.data.force : false });
  return NextResponse.json(report, { status: report.ok ? 200 : 502 });
}
