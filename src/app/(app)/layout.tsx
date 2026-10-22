import { redirect } from "next/navigation";
import { currentActor } from "@/auth/actor";
import { getUser } from "@/auth/users";
import { Nav } from "@/components/Nav";
import { getDb } from "@/db/client";
import { getKillState } from "@/kill/state";
import { getActiveConfig } from "@/run/config-store";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const db = await getDb();
  const [user, kill, active] = await Promise.all([actor.userId ? getUser(db, actor.userId) : null, getKillState(db), getActiveConfig(db)]);
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <Nav userName={user?.name ?? "System"} role={actor.role} mode={active.config.mode} killed={kill.active} />
      {kill.active ? (
        <div className="banner banner-bad kill-banner" role="alert" data-testid="kill-banner">
          <span>
            <strong>Kill switch is ON.</strong> {kill.reason} Set by {kill.by} on {kill.since ? new Date(kill.since).toLocaleString("en-IN") : ""}.
            Scheduled runs and the purchase-order export are stopped and Review is read-only. Raghav&apos;s own process is unaffected. The sponsor or an admin can clear it on the Health page.
          </span>
        </div>
      ) : null}
      <main id="main" className="page">{children}</main>
    </>
  );
}
