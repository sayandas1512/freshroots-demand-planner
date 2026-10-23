import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { parseDate } from "@/engine/weeks";
import { startMeasurement } from "@/run/measurement";

export const dynamic = "force-dynamic";

const body = z.object({
  startDate: z.string().refine((v) => {
    try {
      parseDate(v);
      return true;
    } catch {
      return false;
    }
  }, "Use a real date as YYYY-MM-DD"),
});

/** (Re)start measurement: set the date results are judged from and freeze the 8 weekly outcomes before it as the baseline. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "editKill");
  if (isResponse(actor)) return actor;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid date" }, { status: 400 });
  return NextResponse.json(await startMeasurement(await getDb(), { startDate: parsed.data.startDate, userId: actor.userId }));
}
