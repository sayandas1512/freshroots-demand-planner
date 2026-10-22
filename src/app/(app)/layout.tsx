import { redirect } from "next/navigation";
import { currentActor } from "@/auth/actor";
import { getUser } from "@/auth/users";
import { Nav } from "@/components/Nav";
import { getDb } from "@/db/client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const user = actor.userId ? await getUser(await getDb(), actor.userId) : null;
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <Nav userName={user?.name ?? "System"} role={actor.role} />
      <main id="main" className="page">{children}</main>
    </>
  );
}
