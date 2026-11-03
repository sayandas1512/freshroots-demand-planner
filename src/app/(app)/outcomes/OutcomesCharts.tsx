"use client";

import { ArcGauge } from "@/components/charts/ArcGauge";
import { ColumnChart } from "@/components/charts/ColumnChart";
import { Donut } from "@/components/charts/Donut";
import { TrendChart } from "@/components/charts/TrendChart";
import { indicatorView, lossSplit, weekSeries } from "@/outcomes/summary";

interface Props {
  since: string;
  weekly: { week: string; stockout: number; overstock: number }[];
  frozen: { week: string; stockout: number; overstock: number }[];
  monthly: { period: string; stockoutLoss: number; writeoff: number }[];
  warnPct: number;
  killPct: number;
}

const lakh = (v: number) => `₹${(v / 100_000).toFixed(1)}L`;
const num1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** The weekly outcomes against the frozen baseline, how far the four-week average has moved, and the monthly losses. */
export function OutcomesCharts({ since, weekly, frozen, monthly, warnPct, killPct }: Props) {
  const stockout = weekSeries(frozen, weekly, since, (r) => r.stockout);
  const overstock = weekSeries(frozen, weekly, since, (r) => r.overstock);
  const sv = indicatorView(stockout.filter((p) => p.kind === "baseline").map((p) => p.value), stockout.filter((p) => p.kind === "live").map((p) => p.value), warnPct, killPct);
  const ov = indicatorView(overstock.filter((p) => p.kind === "baseline").map((p) => p.value), overstock.filter((p) => p.kind === "live").map((p) => p.value), warnPct, killPct);
  const detail = (v: typeof sv, f: (n: number) => string) =>
    v.changePct === null ? (v.baselineAvg === null ? "The baseline has not been frozen yet." : `Needs 4 live weeks; ${v.liveWeeks} entered.`) : `Last 4 weeks average ${f(v.recentAvg as number)} against a baseline of ${f(v.baselineAvg as number)}.`;
  const months = [...monthly].sort((a, b) => a.period.localeCompare(b.period));
  const split = lossSplit(months);

  return (
    <section className="section" aria-labelledby="glance-h" data-testid="outcome-charts">
      <h2 id="glance-h">Outcomes at a glance</h2>
      <div className="dials">
        <ArcGauge testId="gauge-stockout" title="Weekly stockout incidents" value={sv.changePct} warnPct={warnPct} killPct={killPct} detail={detail(sv, num1)} />
        <ArcGauge testId="gauge-overstock" title="Weekly overstock value" value={ov.changePct} warnPct={warnPct} killPct={killPct} detail={detail(ov, lakh)} />
      </div>
      <div className="charts-grid">
        <div className="card chart-card">
          <h2>Stockout incidents per week</h2>
          <p className="chart-sub">Grey is the frozen baseline, green is live. Lower is better.</p>
          <TrendChart testId="trend-stockout" title="Stockout incidents per week" points={stockout.map((p) => ({ label: p.week, value: p.value, kind: p.kind }))} baseline={sv.baselineAvg} warnPct={warnPct} killPct={killPct} format={num1} tick={(v) => String(+v.toFixed(1))} />
        </div>
        <div className="card chart-card">
          <h2>Overstock value per week</h2>
          <p className="chart-sub">In lakh rupees. The dashed lines are where the kill check warns and stops.</p>
          <TrendChart testId="trend-overstock" title="Overstock value per week" points={overstock.map((p) => ({ label: p.week, value: p.value, kind: p.kind }))} baseline={ov.baselineAvg} warnPct={warnPct} killPct={killPct} format={lakh} tick={(v) => `${+(v / 100_000).toFixed(1)}L`} />
        </div>
      </div>
      <div className="charts-grid">
        <div className="card chart-card">
          <h2>Monthly losses</h2>
          <p className="chart-sub">Stockout loss and write-offs, from finance.</p>
          {months.length === 0 ? <p className="muted small">No months entered yet.</p> : (
            <ColumnChart testId="chart-monthly" title="Monthly losses" columns={months.map((m) => ({ label: m.period, stacks: [{ key: "stockout", label: "Stockout loss", value: m.stockoutLoss, color: "var(--st-stockout)" }, { key: "writeoff", label: "Write-offs", value: m.writeoff, color: "var(--st-demand)" }] }))} format={lakh} legend={[{ label: "Stockout loss", color: "var(--st-stockout)" }, { label: "Write-offs", color: "var(--st-demand)" }]} />
          )}
        </div>
        <div className="card chart-card">
          <h2>Where the money goes</h2>
          <p className="chart-sub">All months entered, split by kind of loss.</p>
          {split.total === 0 ? <p className="muted small">Nothing to split yet.</p> : (
            <Donut testId="donut-loss" title="Loss by kind" segments={[{ key: "stockout", label: "Stockout loss", value: split.stockoutLoss, color: "var(--st-stockout)" }, { key: "writeoff", label: "Write-offs", value: split.writeoff, color: "var(--st-demand)" }]} centerValue={lakh(split.total)} centerLabel="all months" format={lakh} />
          )}
        </div>
      </div>
    </section>
  );
}
