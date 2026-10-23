import { redirect } from "next/navigation";
import Link from "next/link";
import { currentActor } from "@/auth/actor";
import { publicViewEnabled } from "@/auth/public-view";
import { getUser } from "@/auth/users";
import { Nav } from "@/components/Nav";
import { getDb } from "@/db/client";
import { getKillState } from "@/kill/state";
import { getActiveConfig } from "@/run/config-store";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  if (!actor && !publicViewEnabled()) redirect("/login");
  const db = await getDb();
  const [user, kill, active] = await Promise.all([actor?.userId ? getUser(db, actor.userId) : null, getKillState(db), getActiveConfig(db)]);
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <Nav userName={user?.name ?? "System"} role={actor?.role ?? null} mode={active.config.mode} killed={kill.active} guest={actor?.guest === true} />
      {actor?.guest ? (
        <div className="banner banner-warn view-banner" role="note" data-testid="guest-banner">
          <span><strong>Open access.</strong> Anyone with this link can approve, run, export and use the kill switch as a guest administrator; actions are logged as &quot;Guest&quot;. This is for demonstration and marking: do not use it with real data. <Link href="/login">Sign in</Link> to act under your own name.</span>
        </div>
      ) : null}
      {!actor ? (
        <div className="banner banner-info view-banner" role="note" data-testid="view-banner">
          <span><strong>You are viewing without signing in.</strong> Everything is read-only. <Link href="/login">Sign in</Link> to approve, edit, run, upload or change settings.</span>
        </div>
      ) : null}
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
