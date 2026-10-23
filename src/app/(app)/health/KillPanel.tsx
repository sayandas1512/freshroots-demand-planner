"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ClearKillForm() {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kill/clear", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note }) });
      if (res.ok) router.refresh();
      else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not clear.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="clear-kill" aria-label="Clear the kill switch">
      <label className="field grow">Why is it safe to restart? (required, logged with your name)
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} minLength={5} maxLength={500} required data-testid="clear-note" />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy || note.trim().length < 5} data-testid="clear-kill">Clear kill switch</button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>
  );
}

/** Runs the kill check now instead of waiting for the next run or the monthly check, so every criterion can be tried out. */
export function RunKillCheckButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/kill/check", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { tripped?: boolean; trippedNow?: boolean; warnings?: string[]; error?: string };
      setMessage(!res.ok ? (json.error ?? "Could not run the check.") : json.tripped ? "A kill criterion is met: the system has been stopped." : json.warnings && json.warnings.length > 0 ? `Checked: warnings on ${json.warnings.join(", ").replaceAll("_", " ")}.` : "Checked: nothing is wrong.");
      router.refresh();
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kill-check-run">
      <button type="button" className="btn btn-sm" onClick={run} disabled={busy} data-testid="run-kill-check">{busy ? "Checking…" : "Run the kill check now"}</button>
      {message ? <span role="status" className="small" data-testid="kill-check-result">{message}</span> : null}
    </div>
  );
}
