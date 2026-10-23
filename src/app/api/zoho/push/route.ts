import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { exportBlocked } from "@/kill/guards";
import { todayIst } from "@/lib/dates";
import { clientRateKey } from "@/lib/ratelimit-keys";
import { rateLimit } from "@/lib/ratelimit";
import { clientOrResponse, pushDisabled } from "@/zoho/guards";
import { pushDraftPos } from "@/zoho/push";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const body = z.object({ runId: z.string().uuid() });

/**
 * Create DRAFT purchase orders in Zoho from the approved lines of a run. Same gates as the CSV export: live mode, kill
 * switch off, planner or admin role. Also needs the sponsor's "create draft purchase orders in Zoho" setting.
 */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "export");
  if (isResponse(actor)) return actor;
  const limit = rateLimit(clientRateKey("zoho-push", request.headers), 6, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Too many requests. Wait a minute." }, { status: 429 });
  const db = await getDb();
  const blocked = (await exportBlocked(db)) ?? (await pushDisabled(db));
  if (blocked) return blocked;
  const client = clientOrResponse(db);
  if (client instanceof NextResponse) return client;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "runId must be a run id" }, { status: 400 });
  const out = await pushDraftPos(db, client, { runId: parsed.data.runId, userId: actor.userId, today: todayIst() });
  return NextResponse.json({ results: out.results, blocked: out.plan.blocked });
}
