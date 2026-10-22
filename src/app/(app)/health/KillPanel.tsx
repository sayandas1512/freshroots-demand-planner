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
