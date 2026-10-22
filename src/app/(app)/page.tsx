import { ReviewClient } from "@/components/review/ReviewClient";
import { getDb } from "@/db/client";
import { todayIst } from "@/lib/dates";
import { loadReview } from "@/run/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review · Freshroots" };

export default async function ReviewPage() {
  const data = await loadReview(await getDb());
  // The key remounts the client when a new run (or a run's final state) arrives, so local state never goes stale.
  return <ReviewClient key={data ? `${data.run.id}:${data.run.status}` : "none"} data={data} today={todayIst()} />;
}
