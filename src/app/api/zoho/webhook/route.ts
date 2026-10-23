import { after, NextResponse } from "next/server";
import { timingSafeEqual } from "@/auth/session";
import { getDb } from "@/db/client";
import { getZohoClient, zohoConfig } from "@/zoho";
import { lastSync, syncZoho } from "@/zoho/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEBOUNCE_MS = 60_000;

/**
 * Optional nudge from a Zoho workflow webhook ("purchase order created or updated"). Zoho cannot sign in, so this one
 * route is public and protected by a shared secret in the `x-zoho-webhook-secret` header. It only triggers a normal
 * sync, at most once a minute; the payload is never trusted or stored.
 */
export async function POST(request: Request) {
  const cfg = zohoConfig();
  if (!cfg?.webhookSecret) return NextResponse.json({ error: "not enabled" }, { status: 404 });
  if (!timingSafeEqual(request.headers.get("x-zoho-webhook-secret") ?? "", cfg.webhookSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await getDb();
  const last = await lastSync(db);
  if (last && Date.now() - last.at.getTime() < DEBOUNCE_MS) return NextResponse.json({ accepted: false, reason: "synced a moment ago" }, { status: 202 });
  const client = getZohoClient(db);
  if (!client) return NextResponse.json({ error: "not enabled" }, { status: 404 });
  after(async () => {
    await syncZoho(db, client, { trigger: "webhook", force: true });
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
