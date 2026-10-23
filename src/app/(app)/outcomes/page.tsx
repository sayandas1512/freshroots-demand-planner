import { currentActor } from "@/auth/actor";
import { can } from "@/auth/roles";
import { getDb } from "@/db/client";
import { todayIst } from "@/lib/dates";
import { loadOutcomes } from "@/outcomes/store";
import { ensureMeasurementStart } from "@/run/measurement";
import { OutcomesClient } from "./OutcomesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outcomes · Freshroots" };

export default async function OutcomesPage() {
  const db = await getDb();
  const [o, actor, since] = await Promise.all([loadOutcomes(db), currentActor(), ensureMeasurementStart(db, todayIst())]);
  return (
    <OutcomesClient
      canEdit={can(actor?.role, "outcomes")}
      canRestart={can(actor?.role, "editKill")}
      since={since}
      weekly={o.weekly.map((w) => ({ week: w.week, stockout: w.stockoutIncidents, overstock: w.overstockValueInr, source: w.source }))}
      monthly={o.monthly.map((m) => ({ period: m.period, stockoutLoss: m.stockoutLossInr, writeoff: m.writeoffInr, method: m.methodNote }))}
      frozen={o.frozen.map((f) => ({ week: f.week, stockout: f.stockoutIncidents, overstock: f.overstockValueInr, at: f.frozenAt.toISOString() }))}
      methodChanges={o.methodChanges}
    />
  );
}
