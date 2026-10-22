import Link from "next/link";
import { BarChart } from "@/components/health/BarChart";
import { CountUp } from "@/components/health/CountUp";
import { RangeChart } from "@/components/health/RangeChart";
import { Sparkline } from "@/components/health/Sparkline";
import { desc } from "drizzle-orm";
import { currentActor } from "@/auth/actor";
import { can } from "@/auth/roles";
import { getDb } from "@/db/client";
import { killState } from "@/db/schema";
import { goLiveReadiness } from "@/golive/readiness";
import { decisionStats } from "@/kill/gather";
import { previewKill } from "@/kill/run";
import { getKillState } from "@/kill/state";
import { getActiveConfig } from "@/run/config-store";
import { systemHealth } from "@/run/healthcheck";
import { compareToRange, formatLakh } from "@/run/baseline";
import { loadHealth, type HealthRun } from "@/run/health";
import { BaselineForm } from "./BaselineForm";
import { GoLiveChecklist } from "./GoLiveChecklist";
import { SystemStatus } from "./SystemStatus";
import { ClearKillForm } from "./KillPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Health · Freshroots" };

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const STATUS_LABEL: Record<string, string> = { running: "Running", completed: "Completed", completed_degraded: "Degraded", failed: "Failed" };
const STATUS_CHIP: Record<string, string> = { running: "chip-plain", completed: "chip-hold", completed_degraded: "chip-demand", failed: "chip-stockout" };
const RULE_COLOR = (rule: string): string =>
  rule.startsWith("exception") ? "var(--st-exception)" : rule.startsWith("stockout") || rule.includes("+stockout") ? "var(--st-stockout)" : rule.startsWith("high_demand") ? "var(--st-demand-mark)" : rule.startsWith("overstock") ? "var(--st-overstock)" : "var(--st-hold)";

function RunRow({ r }: { r: HealthRun }) {
  return (
    <tr>
      <td className="num">{new Date(r.startedAt).toLocaleString("en-IN")}</td>
      <td className="num">{r.asOf}</td>
      <td>{r.trigger}</td>
      <td><span className={`chip ${STATUS_CHIP[r.status] ?? "chip-plain"}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
      <td className="num r">{r.lines}</td>
      <td className="num r">{r.exceptions}</td>
      <td className="num r">{pct(r.overrideRate)}</td>
      <td>{r.llmStatus}</td>
      <td className="num r">{r.llmCalls}</td>
      <td className="num r">{r.llmCostUsd === null ? "n/a" : `$${r.llmCostUsd.toFixed(4)}`}</td>
      <td className="num r">{r.configVersion === null ? "n/a" : `v${r.configVersion}`}</td>
    </tr>
  );
}

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const params = await searchParams;
  const q = (Array.isArray(params.q) ? params.q[0] : params.q) ?? "";
  const db = await getDb();
  const [h, kill, killCheck, readiness, active, actor, history, timing, sys] = await Promise.all([
    loadHealth(db, q.slice(0, 100)),
    getKillState(db),
    previewKill(db),
    goLiveReadiness(db),
    getActiveConfig(db),
    currentActor(),
    db.select().from(killState).orderBy(desc(killState.at)).limit(8),
    decisionStats(db, 4),
    systemHealth(db),
  ]);
  const role = actor?.role ?? "planner";
  const chronological = [...h.runs].reverse();
  const brief = h.baseline.find((b) => b.stockoutLossInrHigh !== null && b.writeoffInrHigh !== null);
  const entries = h.baseline.filter((b) => b.stockoutLossInrHigh === null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Health</h1>
          <p>Is the system behaving, are the rules being overridden, and is it moving stockouts and write-offs? Built for Deepa.</p>
        </div>
      </div>

      {h.alerts.length > 0 ? (
        <section className="banner banner-bad" role="alert" aria-label="Runs needing attention" data-testid="health-alerts">
          <div>
            <strong>{h.alerts.some((a) => a.status === "failed") ? "A run failed or degraded recently." : "A run completed with warnings recently."}</strong>
            <ul className="alert-list">
              {h.alerts.map((a) => (
                <li key={a.id}>
                  <span className="num">{a.asOf}</span> · {STATUS_LABEL[a.status]} · {a.note ?? (a.llmStatus === "failed" || a.llmStatus === "partial" ? "Wording fell back to templates." : "See the run notes.")}
                </li>
              ))}
            </ul>
            <p className="small">What to do: see the runbook in the README. Numbers and actions are never affected by an LLM failure.</p>
          </div>
        </section>
      ) : null}

      <SystemStatus initial={sys} />

      <section className="card section kill-section" aria-labelledby="kill-h" data-testid="kill-section">
        <div className="log-head">
          <h2 id="kill-h">Kill switch and criteria</h2>
          <span className={`chip ${kill.active ? "chip-stockout" : "chip-hold"}`} data-testid="kill-status">{kill.active ? "ON: system stopped" : "Off"}</span>
          <span className={`chip ${active.config.mode === "shadow" ? "chip-demand" : "chip-hold"}`}>{active.config.mode === "shadow" ? "SHADOW mode" : "LIVE mode"}</span>
        </div>
        {kill.active ? (
          <div className="banner banner-bad" role="status"><span><strong>Stopped.</strong> {kill.reason} Set by {kill.by} on {new Date(kill.since as string).toLocaleString("en-IN")}.</span></div>
        ) : null}
        {kill.active && can(role, "clearKill") ? <ClearKillForm /> : null}
        {kill.active && !can(role, "clearKill") ? <p className="small muted">Only the sponsor or an admin can clear the kill switch.</p> : null}
        {active.config.mode === "shadow" ? <p className="small muted">Shadow mode: the quarterly loss, weekly indicator and override tests are not evaluated. Only the rubber-stamp warning runs.</p> : null}
        <div className="table-wrap">
          <table className="data" data-testid="kill-criteria">
            <thead><tr><th>Criterion</th><th>Current value</th><th>Threshold</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>
              {killCheck.criteria.map((c) => (
                <tr key={c.id} data-status={c.status}>
                  <td><strong>{c.label}</strong></td>
                  <td className="num">{c.value ?? "n/a"}</td>
                  <td className="small">{c.threshold}</td>
                  <td><span className={`chip ${c.status === "kill" ? "chip-stockout" : c.status === "warn" ? "chip-demand" : c.status === "ok" ? "chip-hold" : "chip-plain"}`}>{c.status.replace("_", " ")}</span></td>
                  <td className="small muted">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {history.length > 0 ? (
          <details>
            <summary>Kill switch history</summary>
            <ul className="issue-list small">
              {history.map((e) => <li key={e.id}>{new Date(e.at).toLocaleString("en-IN")}: {e.kind === "clear" ? "cleared" : "tripped"} by {e.setByLabel}. {e.kind === "clear" ? `Note: ${e.note ?? ""}` : e.reason}</li>)}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="card section" aria-labelledby="golive-h" data-testid="golive-section">
        <h2 id="golive-h">Go-live checklist</h2>
        <p className="muted small">Mode changes to live only when every item is ticked by a named user and the sponsor saves the change on Settings. {readiness.ready ? "All items are ticked." : `${readiness.missing.length} still open.`}</p>
        <GoLiveChecklist readiness={readiness} role={role} canTick={can(role, "goLive")} />
      </section>

      <section className="grid grid-4" aria-label="Key figures">
        <div className="card stat"><span className="stat-label">Runs (last 40)</span><span className="stat-value"><CountUp value={h.totals.runs} /></span><span className="muted small">{h.totals.lines} lines reviewed</span></div>
        <div className="card stat"><span className="stat-label">Override rate</span><span className="stat-value">{h.totals.overrideRate === null ? "n/a" : <CountUp value={h.totals.overrideRate * 100} decimals={1} suffix="%" testId="kpi-override" />}</span><span className="muted small">edits + rejections over all lines{h.totals.overrideRateDecided !== null ? ` · ${pct(h.totals.overrideRateDecided)} of decided lines` : ""}</span></div>
        <div className="card stat" data-testid="kpi-timing"><span className="stat-label">Decision time (last {timing.runs || 4} runs)</span><span className="stat-value">{timing.medianSeconds === null ? "n/a" : <CountUp value={timing.medianSeconds} decimals={1} suffix=" s" />}</span><span className="muted small">median per decision · override rate {pct(timing.overrideRate)} over {timing.decided} decided lines</span></div>
        <div className="card stat"><span className="stat-label">Template fallback</span><span className="stat-value">{h.totals.templateRate === null ? "n/a" : <CountUp value={h.totals.templateRate * 100} decimals={1} suffix="%" />}</span><span className="muted small">flagged lines using template wording</span></div>
        <div className="card stat"><span className="stat-label">Exceptions per run</span><span className="stat-value">{h.totals.avgExceptions === null ? "n/a" : <CountUp value={h.totals.avgExceptions} decimals={1} />}</span><span className="muted small">routed to Raghav</span></div>
        <div className="card stat"><span className="stat-label">LLM calls</span><span className="stat-value"><CountUp value={h.totals.llmCalls} /></span><span className="muted small">across the last 40 runs</span></div>
        <div className="card stat"><span className="stat-label">LLM cost</span><span className="stat-value"><CountUp value={h.totals.llmCostUsd} decimals={4} prefix="$" /></span><span className="muted small">from logged tokens and env prices</span></div>
      </section>

      <section className="grid grid-3 trends" aria-label="Trends by run">
        <div className="card"><h3>Override rate by run</h3><Sparkline values={chronological.map((r) => r.overrideRate)} label="Override rate by run" /></div>
        <div className="card"><h3>Exceptions by run</h3><Sparkline values={chronological.map((r) => r.exceptions)} label="Exceptions by run" /></div>
        <div className="card"><h3>LLM cost by run</h3><Sparkline values={chronological.map((r) => r.llmCostUsd)} label="LLM cost by run" unit=" USD" /></div>
      </section>

      <div className="grid grid-2">
        <section className="card" aria-labelledby="flags-h">
          <h2 id="flags-h">Flags by rule</h2>
          <BarChart title="Lines by rule fired" rows={h.flagsByRule.map((r) => ({ label: r.rule, value: r.count }))} barColor={RULE_COLOR} />
        </section>
        <section className="card" aria-labelledby="exc-h">
          <h2 id="exc-h">Exceptions by type</h2>
          <BarChart title="Exceptions by type" rows={h.exceptionsByType.map((r) => ({ label: r.type, value: r.count }))} barColor={() => "var(--st-exception)"} />
        </section>
      </div>

      <section className="card section" aria-labelledby="runs-h">
        <h2 id="runs-h">Runs</h2>
        {h.runs.length === 0 ? (
          <div className="empty"><h3>No runs yet</h3><p>Run the planner from the <Link href="/">Review</Link> page.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="data" data-testid="runs-table">
              <thead><tr><th>Started</th><th>As of</th><th>Trigger</th><th>Status</th><th className="r">Lines</th><th className="r">Exceptions</th><th className="r">Override rate</th><th>LLM</th><th className="r">Calls</th><th className="r">Cost</th><th className="r">Rules</th></tr></thead>
              <tbody>{h.runs.map((r) => <RunRow key={r.id} r={r} />)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card section" aria-labelledby="base-h">
        <h2 id="base-h">Stockouts and write-offs against baseline</h2>
        <p className="muted small">The brief gives ranges, not points: ₹18 to 22 lakh of stockout loss and ₹10 to 12 lakh of write-offs per quarter. Enter each quarter&apos;s actuals to compare. Lower is better.</p>
        {brief ? (
          <div className="grid grid-2">
            <div><h3>Stockout loss per quarter (₹ lakh)</h3><RangeChart title="Stockout loss" low={brief.stockoutLossInr} high={brief.stockoutLossInrHigh ?? brief.stockoutLossInr} entries={entries.map((e) => ({ label: e.period, value: e.stockoutLossInr }))} /></div>
            <div><h3>Write-offs per quarter (₹ lakh)</h3><RangeChart title="Write-offs" low={brief.writeoffInr} high={brief.writeoffInrHigh ?? brief.writeoffInr} entries={entries.map((e) => ({ label: e.period, value: e.writeoffInr }))} /></div>
          </div>
        ) : null}
        {entries.length === 0 ? <p className="small muted">No quarters entered yet. The shaded band is the brief&apos;s range.</p> : null}
        <div className="table-wrap">
          <table className="data" data-testid="baseline-table">
            <thead><tr><th>Period</th><th className="r">Stockout loss</th><th>vs brief</th><th className="r">Write-offs</th><th>vs brief</th><th>Source</th></tr></thead>
            <tbody>
              {h.baseline.map((b) => {
                const isRange = b.stockoutLossInrHigh !== null && b.writeoffInrHigh !== null;
                const so = brief && !isRange ? compareToRange(b.stockoutLossInr, brief.stockoutLossInr, brief.stockoutLossInrHigh ?? brief.stockoutLossInr) : null;
                const wo = brief && !isRange ? compareToRange(b.writeoffInr, brief.writeoffInr, brief.writeoffInrHigh ?? brief.writeoffInr) : null;
                const show = (c: typeof so) => (c ? `${c.verdict} the range (${c.pctFromMidpoint > 0 ? "+" : ""}${c.pctFromMidpoint}% vs midpoint)` : "baseline");
                return (
                  <tr key={b.period}>
                    <td className="mono">{isRange ? "Brief baseline" : b.period}</td>
                    <td className="num r">{isRange ? `${formatLakh(b.stockoutLossInr)} to ${formatLakh(b.stockoutLossInrHigh ?? 0)}` : formatLakh(b.stockoutLossInr)}</td>
                    <td>{show(so)}</td>
                    <td className="num r">{isRange ? `${formatLakh(b.writeoffInr)} to ${formatLakh(b.writeoffInrHigh ?? 0)}` : formatLakh(b.writeoffInr)}</td>
                    <td>{show(wo)}</td>
                    <td className="small muted">{b.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <BaselineForm />
      </section>

      <section className="card section" aria-labelledby="log-h">
        <div className="log-head">
          <h2 id="log-h">Override log</h2>
          <form method="get" className="log-search" role="search">
            <input type="search" name="q" defaultValue={q} placeholder="Search reason, SKU or value" aria-label="Search the override log" />
            <button type="submit" className="btn btn-sm">Search</button>
            {q ? <Link className="btn btn-sm btn-ghost" href="/health">Clear</Link> : null}
          </form>
        </div>
        <p className="muted small">Every edit and rejection with the reason given. This is how the undocumented 15 to 20% becomes documented. Showing {h.overrideLog.length} of {h.overrideLogTotal}{q ? ` matching "${q}"` : ""}.</p>
        {h.overrideLog.length === 0 ? (
          <div className="empty"><h3>{q ? "No matching entries" : "No overrides yet"}</h3><p>{q ? "Try a different word." : "Edits and rejections on the Review page appear here with their reasons."}</p></div>
        ) : (
          <div className="table-wrap">
            <table className="data" data-testid="override-log">
              <thead><tr><th>When</th><th>SKU</th><th>Change</th><th>Reason</th></tr></thead>
              <tbody>
                {h.overrideLog.map((o) => (
                  <tr key={o.id}>
                    <td className="num">{new Date(o.at).toLocaleString("en-IN")}</td>
                    <td><strong>{o.skuName}</strong> <span className="mono muted small">{o.skuId}</span></td>
                    <td className="num">{o.field}: {o.from ?? "none"} → <strong>{o.to ?? "none"}</strong></td>
                    <td>{o.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
