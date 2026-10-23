"use client";

import { useState } from "react";
import type { BacktestSummary } from "@/backtest/compare";
import type { CompareRow } from "@/compare/compare";

interface Result {
  periods: string[];
  rows: CompareRow[];
  summary: BacktestSummary;
  notes: string[];
  rejected: number;
  disagreementCount: number;
}

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const label = (a: string) => (a.startsWith("exception:") ? `Exception: ${a.slice(10).replaceAll("_", " ")}` : a.replaceAll("_", " ").toLowerCase());

export function CompareClient() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/compare", { method: "POST", body: new FormData(event.currentTarget) });
      const json = (await res.json()) as Result | { error: string };
      if ("error" in json) setError(json.error);
      else setResult(json);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const shown = result ? (showAll ? result.rows : result.rows.filter((r) => r.agreed === false)) : [];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Compare with Raghav</h1>
          <p>
            Upload Raghav&apos;s own monthly forecast or orders and compare them with what the system recommended in the same month. The system counts as ordering a SKU if any completed run that month recommended a reorder. This is how you check the system against his own judgment.
          </p>
        </div>
      </div>

      <form className="card backtest-form" onSubmit={submit}>
        <label className="field grow">Raghav&apos;s forecast or orders (CSV)
          <input type="file" name="file" accept=".csv,text/csv" aria-label="Forecast CSV" required />
          <span className="hint">Columns: SKU_ID, Period (a month like 2026-12), Qty. A SKU with a quantity above 0 counts as &quot;order&quot;.</span>
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="run-compare">{busy ? "Comparing…" : "Compare"}</button>
      </form>
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {result ? (
        <section aria-label="Comparison results" data-testid="compare-results">
          {result.notes.map((n) => <div key={n} className="banner banner-warn" role="status"><span>{n}</span></div>)}
          {result.rejected > 0 ? <div className="banner banner-warn" role="status"><span>{result.rejected} rows in the file were rejected and ignored.</span></div> : null}
          <div className="grid grid-3 results-stats">
            <div className="card stat"><span className="stat-label">Agreement</span><span className="stat-value" data-testid="compare-rate">{pct(result.summary.overall.rate)}</span><span className="muted small">{result.summary.overall.agreed} of {result.summary.overall.compared} comparable SKU-months (order or not)</span></div>
            <div className="card stat"><span className="stat-label">Disagreements</span><span className="stat-value num">{result.disagreementCount}</span><span className="muted small">with the system&apos;s reason below</span></div>
            <div className="card stat"><span className="stat-label">Months compared</span><span className="stat-value num">{result.periods.length}</span><span className="muted small">{result.periods.join(", ")}</span></div>
          </div>
          <div className="card section">
            <div className="log-head">
              <h2>{showAll ? "Every SKU" : "Disagreements"}</h2>
              <button type="button" className="btn btn-sm" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show disagreements only" : "Show every SKU"}</button>
            </div>
            {shown.length === 0 ? <div className="empty"><h3>No disagreements</h3><p>On every comparable SKU-month the system and Raghav agree.</p></div> : (
              <div className="table-wrap">
                <table className="data" data-testid="compare-table">
                  <thead><tr><th>Month</th><th>SKU</th><th>System</th><th className="r">System qty</th><th>Raghav</th><th className="r">His qty</th><th>System&apos;s reason</th></tr></thead>
                  <tbody>
                    {shown.slice(0, 500).map((r) => (
                      <tr key={`${r.week}-${r.skuId}`} data-agreed={String(r.agreed)}>
                        <td className="num">{r.week}</td>
                        <td><strong>{r.skuName}</strong> <span className="mono small muted">{r.skuId}</span></td>
                        <td>{label(r.systemAction)}</td>
                        <td className="num r">{r.systemQty ?? ""}</td>
                        <td>{r.raghavAction === null ? "not in his file" : r.raghavAction === "ORDER" ? "ordered" : "did not order"}</td>
                        <td className="num r">{r.orderedQty ?? ""}</td>
                        <td className="small">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shown.length > 500 ? <p className="small muted">Showing the first 500 of {shown.length}.</p> : null}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}
