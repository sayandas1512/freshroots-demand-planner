import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { festivalMonths } from "@/db/schema";

export const dynamic = "force-dynamic";

const body = z.object({
  months: z.array(z.object({ yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), isFestival: z.boolean() })).min(1).max(240),
});

/** The festival calendar is reference data: changes apply to every run from now on. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a list of { yearMonth: 'YYYY-MM', isFestival } entries." }, { status: 400 });
  const db = await getDb();
  await db
    .insert(festivalMonths)
    .values(parsed.data.months)
    .onConflictDoUpdate({ target: festivalMonths.yearMonth, set: { isFestival: sql`excluded.is_festival` } });
  return NextResponse.json({ saved: parsed.data.months.length });
}
