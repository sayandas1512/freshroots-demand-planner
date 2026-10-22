import type { UpliftCheck } from "@/backtest/festival";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Informational only. It never changes the configured uplift. */
export function FestivalCheck({ check, weeksOfHistory }: { check: UpliftCheck; weeksOfHistory: number }) {
  return (
    <section className="card section" aria-labelledby="fu-h" data-testid="festival-check">
      <h2 id="fu-h">Festival uplift check</h2>
      <p className="muted small">
        For each past festival month (October, November, March), actual weekly demand against the average of the 12 weeks before it, by category, beside the configured uplift of <strong className="num">{check.configuredPct.toFixed(0)}%</strong>.
        This is informational: it never changes the configuration. History available: {weeksOfHistory} weeks.
      </p>
      {check.rows.length === 0 ? (
        <div className="empty"><h3>No festival month can be measured yet</h3><p>{weeksOfHistory === 0 ? "Load weekly sales first." : "Each month needs 3 weeks of sales inside it and 12 weeks of sales before it."}</p></div>
      ) : (
        <div className="table-wrap">
          <table className="data" data-testid="festival-table">
            <thead><tr><th>Month</th><th>Category</th><th className="r">Festival weekly avg</th><th className="r">Previous 12-week avg</th><th className="r">Actual uplift</th><th className="r">Configured</th></tr></thead>
            <tbody>
              {check.rows.map((r) => (
                <tr key={`${r.month}-${r.category}`}>
                  <td>{label(r.month)}{r.baselineIncludesFestival ? <span className="chip chip-plain" title="The 12 weeks before included another festival month, so this understates the uplift."> baseline includes festival</span> : null}</td>
                  <td>{r.category}</td>
                  <td className="num r">{r.festivalAvg.toFixed(1)}</td>
                  <td className="num r">{r.baselineAvg.toFixed(1)}</td>
                  <td className="num r"><strong>{r.upliftPct >= 0 ? "+" : ""}{r.upliftPct.toFixed(1)}%</strong></td>
                  <td className="num r">+{check.configuredPct.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {check.skipped.length > 0 ? (
        <details>
          <summary>{check.skipped.length} festival month{check.skipped.length > 1 ? "s" : ""} could not be measured</summary>
          <ul className="issue-list small">{check.skipped.map((s) => <li key={s.month}>{label(s.month)}: {s.reason}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}
