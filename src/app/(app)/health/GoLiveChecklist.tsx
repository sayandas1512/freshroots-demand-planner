"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Readiness } from "@/golive/readiness";

export function GoLiveChecklist({ readiness, role, canTick }: { readiness: Readiness; role: string; canTick: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: string, action: "tick" | "untick") {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/golive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, action }) });
      if (res.ok) router.refresh();
      else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <ul className="checklist" data-testid="golive-list">
        {readiness.items.map((i) => {
          const allowed = canTick && i.roles.includes(role);
          return (
            <li key={i.key} data-ticked={i.ticked} data-testid={`golive-${i.key}`}>
              <label className="check">
                <input type="checkbox" checked={i.ticked} disabled={!allowed || busy === i.key} onChange={() => toggle(i.key, i.ticked ? "untick" : "tick")} aria-label={i.label} />
                <span>
                  <strong>{i.label}</strong>
                  <span className="hint block">{i.help}</span>
                  {i.ticked ? <span className="small ok-text">Ticked by {i.tickedByName ?? "unknown"} on {new Date(i.tickedAt as string).toLocaleString("en-IN")}</span> : <span className="small faint">Can be ticked by: {i.roles.join(", ")}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="small muted">Weekly outcomes entered: <strong className="num">{readiness.weeklyOutcomeWeeks}</strong>{readiness.baselineFrozen ? " (baseline frozen)" : " (8 needed before go-live)"}.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
