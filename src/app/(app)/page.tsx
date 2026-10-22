import { currentActor } from "@/auth/actor";
import { can } from "@/auth/roles";
import { getKillState } from "@/kill/state";
import { getActiveConfig } from "@/run/config-store";
import { ReviewClient } from "@/components/review/ReviewClient";
import { getDb } from "@/db/client";
import { todayIst } from "@/lib/dates";
import { loadReview } from "@/run/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review · Freshroots" };

export default async function ReviewPage() {
  const db = await getDb();
  const [data, actor, kill, active] = await Promise.all([loadReview(db), currentActor(), getKillState(db), getActiveConfig(db)]);
  // The key remounts the client when a new run (or a run's final state) arrives, so local state never goes stale.
  return <ReviewClient key={data ? `${data.run.id}:${data.run.status}` : "none"} data={data} today={todayIst()} mode={active.config.mode} killed={kill.active} canDecide={can(actor?.role, "decide")} canExport={can(actor?.role, "export")} canRun={can(actor?.role, "run")} />;
}
