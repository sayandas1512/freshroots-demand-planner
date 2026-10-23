import { NextResponse } from "next/server";
import { bearerMatches } from "@/auth/session";
import { getDb } from "@/db/client";
import { getZohoClient } from "@/zoho";
import { syncZoho } from "@/zoho/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Every 30 minutes. Does nothing when the connector is not configured. */
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await getDb();
  const client = getZohoClient(db);
  if (!client) return NextResponse.json({ skipped: "not configured" });
  const report = await syncZoho(db, client, { trigger: "cron" });
  return NextResponse.json({ ok: report.ok, calls: report.calls, openPoRows: report.openPoRows, error: report.error ?? null });
}
