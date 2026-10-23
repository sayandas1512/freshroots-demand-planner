import { currentActor } from "@/auth/actor";
import { can } from "@/auth/roles";
import { getDb } from "@/db/client";
import { zohoStatus } from "@/zoho/status";
import { ZohoClientPanel } from "./ZohoPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zoho · Freshroots" };

export default async function ZohoPage() {
  const db = await getDb();
  const [status, actor] = await Promise.all([zohoStatus(db), currentActor()]);
  return <ZohoClientPanel status={status} canEdit={can(actor?.role, "upload")} canExport={can(actor?.role, "export")} />;
}
