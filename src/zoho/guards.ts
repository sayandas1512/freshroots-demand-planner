import { NextResponse } from "next/server";
import type { Db } from "@/db/client";
import { getActiveConfig } from "@/run/config-store";
import { getZohoClient } from "./index";
import type { ZohoClient } from "./client";

export function notConfigured(): NextResponse {
  return NextResponse.json({ error: "The Zoho connector is not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN and ZOHO_ORG_ID." }, { status: 409 });
}

export function clientOrResponse(db: Db): ZohoClient | NextResponse {
  return getZohoClient(db) ?? notConfigured();
}

/** Draft PO creation must be switched on by the sponsor (or an admin) on Settings. */
export async function pushDisabled(db: Db): Promise<NextResponse | null> {
  const { config } = await getActiveConfig(db);
  return config.zoho_push_enabled ? null : NextResponse.json({ error: "Creating draft purchase orders in Zoho is switched off. The sponsor can switch it on in Settings." }, { status: 423 });
}
