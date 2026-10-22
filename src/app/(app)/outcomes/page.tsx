import { currentActor } from "@/auth/actor";
import { can } from "@/auth/roles";
import { getDb } from "@/db/client";
import { loadOutcomes } from "@/outcomes/store";
import { OutcomesClient } from "./OutcomesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outcomes · Freshroots" };

export default async function OutcomesPage() {
  const db = await getDb();
  const [o, actor] = await Promise.all([loadOutcomes(db), currentActor()]);
  return (
    <OutcomesClient
      canEdit={can(actor?.role, "outcomes")}
      weekly={o.weekly.map((w) => ({ week: w.week, stockout: w.stockoutIncidents, overstock: w.overstockValueInr, source: w.source }))}
      monthly={o.monthly.map((m) => ({ period: m.period, stockoutLoss: m.stockoutLossInr, writeoff: m.writeoffInr, method: m.methodNote }))}
      frozen={o.frozen.map((f) => ({ week: f.week, stockout: f.stockoutIncidents, overstock: f.overstockValueInr, at: f.frozenAt.toISOString() }))}
      methodChanges={o.methodChanges}
    />
  );
}
