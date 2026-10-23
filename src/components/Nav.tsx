"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ROLE_LABEL, type Role } from "@/auth/roles";
import { StopControl } from "./StopControl";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Review" },
  { href: "/settings", label: "Settings" },
  { href: "/data", label: "Data" },
  { href: "/outcomes", label: "Outcomes" },
  { href: "/zoho", label: "Zoho" },
  { href: "/health", label: "Health" },
  { href: "/backtest", label: "Backtest" },
  { href: "/compare", label: "Compare" },
];

export function Nav({ userName, role, killed, guest = false }: { userName: string; role: Role | null; killed: boolean; guest?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="shell-top">
      <Link href="/" className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 21v-9" /><path d="M12 12c0-4 3-7 8-7 0 5-3 8-8 7z" /><path d="M12 15c0-3-2-5-6-5 0 4 2 6 6 5z" />
        </svg>
        Freshroots
      </Link>
      <nav className="nav" aria-label="Main">
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}>
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div className="shell-spacer" />
      {killed ? <span className="chip chip-stockout" data-testid="killed-chip">STOPPED</span> : role ? <StopControl /> : null}
      <span className="user-chip" data-testid="user-chip">{guest ? "Guest · open access" : role ? `${userName} · ${ROLE_LABEL[role]}` : "Viewing only"}</span>
      <ThemeToggle />
      {role && !guest ? <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button> : <Link href="/login" className="btn btn-sm" data-testid="nav-signin">Sign in</Link>}
    </header>
  );
}
