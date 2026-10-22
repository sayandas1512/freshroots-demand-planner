"use client";

import { useState } from "react";
import type { BacktestRow, BacktestSummary } from "@/backtest/compare";

interface Result {
  runId: string;
  weeks: string[];
  hasOrders: boolean;
  orderRowsRejected: number;
  notes: string[];
  summary: BacktestSummary;
  rows: BacktestRow[];
  disagreementCount: number;
}

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const label = (action: string) => (action.startsWith("exception:") ? `Exception: ${action.slice(10).replaceAll("_", " ")}` : action.replaceAll("_", " ").toLowerCase());

export function BacktestClient({ weeks, snapshotDates, firstSnapshot }: { weeks: string[]; snapshotDates: number; firstSnapshot: string | null }) {
  const [from, setFrom] = useState(weeks.at(-4) ?? weeks[0] ?? "");
  const [to, setTo] = useState(weeks.at(-1) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const form = new FormData(event.currentTarget);
    form.set("from", from);
    form.set("to", to);
    try {
      const res = await fetch("/api/backtest", { method: "POST", body: form });
      const json = (await res.json()) as Result | { error: string };
      if ("error" in json) setError(json.error);
      else setResult(json);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const wrong = result?.rows.filter((r) => r.agreed === false) ?? [];
  const shown = showAll || !result?.hasOrders ? (result?.rows ?? []) : wrong;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Backtest</h1>
          <p>Replay past weeks with today&apos;s rules and compare with what Raghav actually ordered. Each week is replayed as the planner would have run it on the Monday after the week ended, using only data that existed by then.</p>
        </div>
      </div>

      <div className="banner banner-info" role="note">
        <span>
          <strong>What the sample can and cannot show.</strong> It holds only 16 weeks of sales and one festival month (October), so festival behaviour cannot be judged from it.
          Stock is read from the newest snapshot dated on or before that Monday, and {snapshotDates === 0 ? "there are no snapshots yet" : `there ${snapshotDates === 1 ? "is" : "are"} ${snapshotDates} snapshot date${snapshotDates === 1 ? "" : "s"}${firstSnapshot ? ` (earliest ${firstSnapshot})` : ""}`}.
          Weeks replayed before the first snapshot show every SKU as a missing_stock exception, so with the sample only the last week (2026-W42) is fully replayed. Keep loading stock snapshots and the backtest becomes more useful each week. Open POs are left out because their history is not kept.
        </span>
      </div>

      <form className="card backtest-form" onSubmit={submit}>
        <label className="field">First week
          <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="First week" required>{weeks.map((w) => <option key={w}>{w}</option>)}</select>
        </label>
        <label className="field">Last week
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Last week" required>{weeks.map((w) => <option key={w}>{w}</option>)}</select>
        </label>
        <label className="field grow">Orders Raghav placed (optional CSV)
          <input type="file" name="orders" accept=".csv,text/csv" aria-label="Orders CSV" />
          <span className="hint">Columns: SKU_ID, Week, Ordered_Qty. Without it, only the system&apos;s lines are shown.</span>
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || weeks.length === 0} data-testid="run-backtest">{busy ? "Replaying…" : "Run backtest"}</button>
      </form>
      {weeks.length === 0 ? <div className="empty card"><h3>No sales data yet</h3><p>Load weekly sales on the Data page first.</p></div> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {result ? (
        <section aria-label="Backtest results" data-testid="backtest-results">
          {result.notes.map((n) => <div key={n} className="banner banner-warn" role="status"><span>{n}</span></div>)}
          {result.orderRowsRejected > 0 ? <div className="banner banner-warn" role="status"><span>{result.orderRowsRejected} rows in the orders file were rejected and ignored.</span></div> : null}

          {result.hasOrders ? (
            <div className="grid grid-3 results-stats">
              <div className="card stat"><span className="stat-label">Agreement</span><span className="stat-value" data-testid="agreement-rate">{pct(result.summary.overall.rate)}</span><span className="muted small">{result.summary.overall.agreed} of {result.summary.overall.compared} comparable lines (order or not)</span></div>
              <div className="card stat"><span className="stat-label">Disagreements</span><span className="stat-value num">{result.disagreementCount}</span><span className="muted small"><a href={`/api/backtest/export?run=${result.runId}`} download>Download as CSV</a></span></div>
              <div className="card stat"><span className="stat-label">Weeks replayed</span><span className="stat-value num">{result.weeks.length}</span><span className="muted small">{result.weeks[0]} to {result.weeks.at(-1)}</span></div>
            </div>
          ) : (
            <div className="banner banner-info" role="status" data-testid="no-orders-note"><span><strong>No orders file was given</strong>, so there is nothing to compare against. These are the system&apos;s own lines for each replayed week.</span></div>
          )}

          <div className="card section">
            <h2>By system action</h2>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>System action</th><th className="r">Lines</th>{result.hasOrders ? <><th className="r">Comparable</th><th className="r">Agreed</th><th className="r">Agreement</th></> : null}</tr></thead>
                <tbody>
                  {Object.entries(result.summary.byAction).map(([action, s]) => (
                    <tr key={action}><td>{label(action)}</td><td className="num r">{s.lines}</td>{result.hasOrders ? <><td className="num r">{s.compared}</td><td className="num r">{s.agreed}</td><td className="num r">{pct(s.rate)}</td></> : null}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card section">
            <div className="log-head">
              <h2>{result.hasOrders && !showAll ? "Disagreements" : "System lines"}</h2>
              {result.hasOrders ? <button type="button" className="btn btn-sm" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show disagreements only" : "Show all lines"}</button> : null}
            </div>
            {shown.length === 0 ? (
              <div className="empty"><h3>{result.hasOrders ? "No disagreements" : "No lines"}</h3><p>{result.hasOrders ? "On every comparable line the system and the orders agree." : "Nothing was produced for these weeks."}</p></div>
            ) : (
              <div className="table-wrap">
                <table className="data" data-testid="backtest-table">
                  <thead><tr><th>Week</th><th>SKU</th><th>System</th><th className="r">System qty</th>{result.hasOrders ? <><th>Raghav</th><th className="r">Ordered</th></> : null}</tr></thead>
                  <tbody>
                    {shown.slice(0, 400).map((r) => (
                      <tr key={`${r.week}-${r.skuId}`}>
                        <td className="num">{r.week}</td><td className="mono">{r.skuId}</td><td>{label(r.systemAction)}</td><td className="num r">{r.systemQty ?? ""}</td>
                        {result.hasOrders ? <><td>{r.raghavAction === null ? "no orders for this week" : r.raghavAction === "ORDER" ? "ordered" : "did not order"}</td><td className="num r">{r.orderedQty ?? ""}</td></> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shown.length > 400 ? <p className="small muted">Showing the first 400 of {shown.length}. The CSV has them all.</p> : null}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}
