import { getDb } from "@/db/client";
import { getActiveConfig } from "@/run/config-store";
import { ShadowClient } from "./ShadowClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shadow comparison · Freshroots" };

export default async function ShadowPage() {
  const { config } = await getActiveConfig(await getDb());
  return <ShadowClient mode={config.mode} />;
}
