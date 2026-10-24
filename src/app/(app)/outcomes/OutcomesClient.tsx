"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { formatIst } from "@/lib/dates";

interface Props {
  canEdit: boolean;
  canRestart: boolean;
  since: string;
  weekly: { week: string; stockout: number; overstock: number; source: string }[];
  monthly: { period: string; stockoutLoss: number; writeoff: number; method: string }[];
  frozen: { week: string; stockout: number; overstock: number; at: string }[];
  methodChanges: { period: string; previous: string; note: string }[];
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function OutcomesClient({ canEdit, canRestart, since, weekly, monthly, frozen, methodChanges }: Props) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  async function send(url: string, init: RequestInit, done: (json: Record<string, unknown>) => string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, init);
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) {
        setMessage({ ok: true, text: done(json) });
        router.refresh();
      } else setMessage({ ok: false, text: String(json.error ?? json.fileError ?? "Could not save.") });
    } catch {
      setMessage({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  function addWeek(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void send("/api/outcomes/weekly", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ week: String(f.get("week")), stockoutIncidents: Number(f.get("incidents")), overstockValueInr: Math.round(Number(f.get("overstock"))) }) }, () => "Week saved.");
  }

  function addMonth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void send(
      "/api/outcomes/monthly",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ period: String(f.get("period")), stockoutLossInr: Math.round(Number(f.get("loss"))), writeoffInr: Math.round(Number(f.get("writeoff"))), methodNote: String(f.get("method")) }) },
      (j) => (j.methodChanged ? "Month saved. Warning: the method note differs from the previous month's, so the two periods may not be comparable." : "Month saved."),
    );
  }

  function upload(e: React.FormEvent) {
    e.preventDefault();
    const chosen = file.current?.files?.[0];
    if (!chosen) return;
    const body = new FormData();
    body.set("file", chosen);
    void send("/api/outcomes/weekly", { method: "POST", body }, (j) => `${String(j.saved)} weeks saved, ${String(j.rejected)} rows rejected.`);
  }

  function restart(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPendingStart(String(new FormData(e.currentTarget).get("start")));
  }

  function confirmRestart() {
    const startDate = pendingStart;
    setPendingStart(null);
    if (!startDate) return;
    void send("/api/measurement", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startDate }) }, (j) => `Measuring from ${String(j.startDate)}; ${String(j.frozenWeeks)} weeks frozen as the baseline.`);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Outcomes</h1>
          <p>The yardstick for the kill check. Weekly figures come from Priya&apos;s existing report (it already has both measures); monthly rupee losses come from finance. The loss method is recorded with every month so the comparison stays honest.</p>
        </div>
      </div>
      <section className="card section" aria-labelledby="ms-h" data-testid="measurement-panel">
        <h2 id="ms-h">Measurement start</h2>
        <p className="muted small">Results are judged from <strong className="num" data-testid="measure-date">{since}</strong>. The 8 weekly outcomes before it are the frozen baseline the kill check compares against. The date is set automatically the first time the system is used; restart it when real data replaces sample data.</p>
        {canRestart ? (
          <form onSubmit={restart} className="baseline-form" aria-label="Restart measurement">
            <label className="field">Measure from<input type="date" name="start" defaultValue={since} required /></label>
            {pendingStart ? (
              <span className="confirm-inline" role="group" aria-label="Confirm restart">
                <span className="small" role="alert">Judge results from {pendingStart}? The 8 weekly outcomes before that date become the frozen baseline, replacing the current one.</span>{" "}
                <button type="button" className="btn btn-primary btn-sm" autoFocus onClick={confirmRestart} data-testid="restart-measurement-confirm">Yes, restart</button>{" "}
                <button type="button" className="btn btn-sm" onClick={() => setPendingStart(null)}>Cancel</button>
              </span>
            ) : (
              <button type="submit" className="btn btn-sm" disabled={busy} data-testid="restart-measurement">Restart measurement</button>
            )}
          </form>
        ) : <p className="small muted">Only the sponsor or an admin can restart measurement.</p>}
      </section>
      {message ? <div className={`banner ${message.ok ? "banner-info" : "banner-bad"}`} role="status"><span>{message.text}</span></div> : null}
      {methodChanges.length > 0 ? (
        <div className="banner banner-warn" role="alert" data-testid="method-warning">
          <span><strong>The loss method changed between periods.</strong> {methodChanges.map((c) => `${c.period} differs from ${c.previous}`).join("; ")}. Do not compare those months without checking.</span>
        </div>
      ) : null}

      <div className="grid grid-2">
        <section className="card section" aria-labelledby="wk-h">
          <h2 id="wk-h">Weekly: stockout incidents and overstock value</h2>
          {canEdit ? (
            <>
              <form onSubmit={addWeek} className="baseline-form" aria-label="Add a week">
                <label className="field">Week<input type="text" name="week" placeholder="2026-W44" pattern="\d{4}-W\d{2}" required /></label>
                <label className="field">Stockout incidents<input type="number" name="incidents" min="0" step="1" required /></label>
                <label className="field">Overstock value (₹)<input type="number" name="overstock" min="0" step="1" required /></label>
                <button type="submit" className="btn btn-primary" disabled={busy}>Save week</button>
              </form>
              <form onSubmit={upload} className="upload-form" aria-label="Upload weekly outcomes">
                <input ref={file} type="file" accept=".csv,text/csv" aria-label="Weekly outcomes CSV" />
                <button type="submit" className="btn btn-sm" disabled={busy}>Upload CSV</button>
                <span className="small muted mono">Week, Stockout_Incidents, Overstock_Value_INR</span>
              </form>
            </>
          ) : <p className="small muted">Only the data analyst, sponsor or an admin can enter outcomes.</p>}
          {weekly.length === 0 ? <div className="empty"><h3>No weeks yet</h3><p>Eight weeks before the measurement start give the frozen baseline.</p></div> : (
            <div className="table-wrap"><table className="data" data-testid="weekly-table"><thead><tr><th>Week</th><th className="r">Stockout incidents</th><th className="r">Overstock value</th><th>Source</th></tr></thead>
              <tbody>{weekly.map((w) => <tr key={w.week}><td className="num">{w.week}</td><td className="num r">{w.stockout}</td><td className="num r">{inr(w.overstock)}</td><td className="small muted">{w.source}</td></tr>)}</tbody></table></div>
          )}
        </section>

        <section className="card section" aria-labelledby="mo-h">
          <h2 id="mo-h">Monthly: ₹ loss</h2>
          {canEdit ? (
            <form onSubmit={addMonth} className="baseline-form" aria-label="Add a month">
              <label className="field">Month<input type="text" name="period" placeholder="2026-11" pattern="\d{4}-\d{2}" required /></label>
              <label className="field">Stockout loss (₹)<input type="number" name="loss" min="0" step="1" required /></label>
              <label className="field">Write-offs (₹)<input type="number" name="writeoff" min="0" step="1" required /></label>
              <label className="field grow">Loss-calculation method<input type="text" name="method" placeholder="e.g. Lost units x margin, from SAP out-of-stock days" required minLength={5} /></label>
              <button type="submit" className="btn btn-primary" disabled={busy}>Save month</button>
            </form>
          ) : null}
          {monthly.length === 0 ? <div className="empty"><h3>No months yet</h3></div> : (
            <div className="table-wrap"><table className="data" data-testid="monthly-table"><thead><tr><th>Month</th><th className="r">Stockout loss</th><th className="r">Write-offs</th><th>Method</th></tr></thead>
              <tbody>{monthly.map((m) => <tr key={m.period}><td className="num">{m.period}</td><td className="num r">{inr(m.stockoutLoss)}</td><td className="num r">{inr(m.writeoff)}</td><td className="small">{m.method}</td></tr>)}</tbody></table></div>
          )}
        </section>
      </div>

      <section className="card section" aria-labelledby="fz-h">
        <h2 id="fz-h">Frozen weekly baseline</h2>
        {frozen.length === 0 ? <p className="muted small">Not frozen yet. Enter or upload at least a few weeks before the measurement start, then restart measurement above to freeze them.</p> : (
          <div className="table-wrap"><table className="data" data-testid="frozen-table"><thead><tr><th>Week</th><th className="r">Stockout incidents</th><th className="r">Overstock value</th><th>Frozen</th></tr></thead>
            <tbody>{frozen.map((f) => <tr key={f.week}><td className="num">{f.week}</td><td className="num r">{f.stockout}</td><td className="num r">{inr(f.overstock)}</td><td className="small muted">{formatIst(f.at)}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </>
  );
}
