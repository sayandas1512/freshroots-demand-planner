import { currentActor } from "@/auth/actor";
import { can } from "@/auth/roles";
import { getDb } from "@/db/client";
import { festivalMonths } from "@/db/schema";
import { diffConfig, DEFAULT_RULE_CONFIG } from "@/engine/config";
import { getActiveConfig, listConfigVersions } from "@/run/config-store";
import { FestivalCalendar } from "./FestivalCalendar";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Freshroots" };

export default async function SettingsPage() {
  const db = await getDb();
  const [active, versions, months, actor] = await Promise.all([getActiveConfig(db), listConfigVersions(db, 30), db.select().from(festivalMonths).orderBy(festivalMonths.yearMonth), currentActor()]);
  const role = actor?.role;
  const history = versions.map((v, i) => {
    const prev = versions[i + 1]?.config ?? null;
    const changes = (prev ? diffConfig(prev, v.config) : diffConfig(DEFAULT_RULE_CONFIG, v.config)).map((c) => ({ label: c.label, from: String(c.from), to: String(c.to) }));
    return { version: v.version, note: v.note, createdAt: v.createdAt.toISOString(), isActive: v.isActive, changes, isFirst: prev === null };
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>The rules Raghav documented, as numbers. Saving never edits a version: it adds a new one with your note, and every run records the version it used.</p>
        </div>
      </div>
      <SettingsForm active={{ version: active.version, config: active.config }} history={history} perms={{ editRules: can(role, "editRules"), editKill: can(role, "editKill"), setMode: can(role, "setMode") }} />
      <FestivalCalendar canEdit={can(role, "editRules")} months={months.map((m) => ({ yearMonth: m.yearMonth, isFestival: m.isFestival }))} />
    </>
  );
}
