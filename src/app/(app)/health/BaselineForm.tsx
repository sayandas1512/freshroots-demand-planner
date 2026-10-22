"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BaselineForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lakh = (name: string) => Math.round(Number(form.get(name)) * 100_000);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/baseline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period: String(form.get("period")), stockoutLossInr: lakh("stockout"), writeoffInr: lakh("writeoff"), source: String(form.get("source")) }),
      });
      const json = (await res.json()) as { error?: string; saved?: string };
      if (res.ok) {
        setMessage({ ok: true, text: `Saved ${json.saved}.` });
        router.refresh();
      } else setMessage({ ok: false, text: json.error ?? "Could not save." });
    } catch {
      setMessage({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="baseline-form" aria-label="Enter a quarter">
      <label className="field">Quarter<input type="text" name="period" placeholder="2026-Q4" pattern="\d{4}-Q[1-4]" required /></label>
      <label className="field">Stockout loss (₹ lakh)<input type="number" name="stockout" step="0.1" min="0" required /></label>
      <label className="field">Write-offs (₹ lakh)<input type="number" name="writeoff" step="0.1" min="0" required /></label>
      <label className="field grow">Source<input type="text" name="source" placeholder="e.g. Finance close, Jan 2027" required minLength={3} /></label>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save quarter"}</button>
      {message ? <p role="status" className={message.ok ? "ok-text" : "form-error"}>{message.text}</p> : null}
    </form>
  );
}
