"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PushPlan } from "@/zoho/push";

interface Result {
  reference: string;
  vendorName: string;
  status: string;
  zohoPoNumber: string | null;
  error: string | null;
}

export function ZohoPushPanel({ runId, plan, enabled }: { runId: string; plan: PushPlan; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function push() {
    if (!confirm(`Create ${plan.pos.length} draft purchase order${plan.pos.length === 1 ? "" : "s"} in Zoho? They stay drafts until someone issues them in Zoho.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/zoho/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }) });
      const json = (await res.json()) as { results?: Result[]; error?: string };
      if (res.ok && json.results) {
        setResults(json.results);
        router.refresh();
      } else setError(json.error ?? "Could not create the drafts.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card section" aria-labelledby="zp-h" data-testid="zoho-push-panel">
      <h2 id="zp-h">Create draft purchase orders in Zoho</h2>
      <p className="muted small">One <strong>draft</strong> per vendor. Drafts are not orders: someone still reviews and issues them in Zoho. Creating them again never duplicates a PO.</p>
      {!enabled ? <div className="banner banner-info" role="note"><span>This feature is switched off. The sponsor or an admin can switch it on in Settings.</span></div> : null}
      {plan.pos.length === 0 && plan.blocked.length === 0 ? <p className="muted small">Nothing to create yet.</p> : null}
      {plan.pos.map((po) => (
        <div key={po.reference} className="zoho-po" data-testid={`zoho-po-${po.vendorId}`}>
          <strong>{po.vendorName}</strong> <span className="mono small muted">{po.reference}</span> <span className="small muted">· {po.lines.length} lines · {po.totalQty.toLocaleString("en-IN")} units</span>
          <ul className="issue-list small">{po.lines.map((l) => <li key={l.skuId}>{l.skuName} ({l.skuId}): {l.qty} at ₹{l.rate}</li>)}</ul>
        </div>
      ))}
      {plan.blocked.length > 0 ? (
        <div className="banner banner-warn" role="alert" data-testid="zoho-blocked">
          <span><strong>{plan.blocked.length} line{plan.blocked.length === 1 ? "" : "s"} cannot be sent and hold back the rest of their vendor:</strong> {plan.blocked.map((b) => `${b.skuName}: ${b.reason}`).join(" ")} Fix it on the Zoho page.</span>
        </div>
      ) : null}
      {results ? (
        <ul className="issue-list" data-testid="zoho-results">
          {results.map((r) => <li key={r.reference}>{r.vendorName}: <strong>{r.status.replace("_", " ")}</strong>{r.zohoPoNumber ? ` (${r.zohoPoNumber})` : ""}{r.error ? `. ${r.error}` : ""}</li>)}
        </ul>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div><button type="button" className="btn btn-primary" disabled={!enabled || busy || plan.pos.length === 0} onClick={push} data-testid="zoho-push">{busy ? "Creating…" : `Create ${plan.pos.length} draft PO${plan.pos.length === 1 ? "" : "s"} in Zoho`}</button></div>
    </section>
  );
}
