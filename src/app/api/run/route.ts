import { after, NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { parseDate } from "@/engine/weeks";
import { todayIst } from "@/lib/dates";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { executeRun, startRun } from "@/run/execute";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const body = z.object({
  asOf: z
    .string()
    .refine((v) => {
      try {
        parseDate(v);
        return true;
      } catch {
        return false;
      }
    }, "asOf must be a real date as YYYY-MM-DD")
    .optional(),
});

/** "Run now": same code path as the cron route, trigger = manual. Returns immediately; follow progress on the events route. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "run");
  if (isResponse(actor)) return actor;
  const limit = rateLimit(`run:${clientKey(request.headers)}`, 6, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Too many runs requested. Wait a minute." }, { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } });

  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  const db = await getDb();
  const started = await startRun(db, { trigger: "manual", asOf: parsed.data.asOf ?? todayIst(), startedBy: actor.userId });
  if (started.created) after(() => executeRun(db, started.runId));
  return NextResponse.json({ runId: started.runId, reason: started.reason });
}
