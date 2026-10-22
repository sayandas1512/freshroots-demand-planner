"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Manual stop, open to everyone signed in. It only ever removes automation, so it asks for a reason and nothing else. */
export function StopControl() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kill/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      if (res.ok) {
        setOpen(false);
        setReason("");
        router.refresh();
      } else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not stop.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stop-control">
      <button type="button" className="btn btn-sm btn-danger" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="stop-button">Stop</button>
      {open ? (
        <form className="stop-form card" onSubmit={submit} aria-label="Stop the system">
          <strong>Stop the system</strong>
          <p className="small muted">Scheduled runs and the export stop, and Review becomes read-only, until the sponsor or an admin clears it.</p>
          <label className="field">Why are you stopping it?<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required minLength={3} data-testid="stop-reason" /></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="inline-panel-actions">
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-sm btn-danger" disabled={busy || reason.trim().length < 3} data-testid="stop-confirm">Stop now</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
