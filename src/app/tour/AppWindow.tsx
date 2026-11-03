/**
 * A picture of the planner, drawn in HTML so it can be animated: a macOS-style window with three views (the day's files,
 * the review table, the kill-switch panel) and the small overlays the story needs. No data leaves the page; every figure
 * here is the golden example from the case (SKU001 at 3.4 weeks of cover, a 1.5x reorder of 750 units).
 */
const ROWS = [
  { sku: "SKU001", name: "Mango Drink 200ml", action: "Reorder 1.5×", qty: "750", cover: 3.4, pct: 17, min: 6, max: 14, chips: ["Stockout risk", "High demand"], tone: "stockout", urgent: true },
  { sku: "SKU011", name: "Multigrain Bread 400g", action: "Reorder now", qty: "500", cover: 1.8, pct: 9, min: 3, max: 4, chips: ["Stockout risk"], tone: "stockout", urgent: false },
  { sku: "SKU003", name: "Brown Rice 1kg", action: "Reorder now", qty: "300", cover: 4.4, pct: 22, min: 6, max: 14, chips: ["Stockout risk"], tone: "stockout", urgent: false },
  { sku: "SKU006", name: "Quinoa 500g", action: "Pause order", qty: "", cover: 22.2, pct: 100, min: 6, max: 14, chips: ["Overstock risk"], tone: "overstock", urgent: false },
  { sku: "SKU002", name: "Oat Cookies 150g", action: "Hold", qty: "", cover: 11.5, pct: 58, min: 6, max: 14, chips: [], tone: "hold", urgent: false },
] as const;

const FILES = ["sales.csv", "sku_master.csv", "inventory.csv", "distributors.csv", "festival_calendar.csv"];

function Icon({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function AppWindow({ variant }: { variant: "hero" | "story" }) {
  return (
    <div className={`w w-${variant}`} role="img" aria-label="The Freshroots planner: the day's files arrive, the rules decide, a person approves, drafts go to Zoho, and the kill switch can stop it all.">
      <div className="w-bar">
        <span className="w-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="w-title">Freshroots</span>
        <span className="w-pill-user">Guest · open access</span>
      </div>

      <div className="w-body">
        <nav className="w-side" aria-hidden="true">
          {["M3 12l9-9 9 9M5 10v10h14V10", "M4 6h16M4 12h16M4 18h10", "M12 3v18M3 12h18", "M4 20V10M10 20V4M16 20v-7M22 20H2", "M5 12l5 5L20 7"].map((d, i) => (
            <span key={i} className={i === 0 ? "on" : ""}><Icon d={d} /></span>
          ))}
        </nav>

        <div className="w-main">
          {/* view: the day's files */}
          <div className="w-view w-view-data">
            <p className="w-h">Data <em>· the day&apos;s files</em></p>
            <div className="w-dz">
              <span className="w-dz-label">Drop the SAP and Zoho extracts</span>
              <span className="w-count"><b data-count>0</b> rows accepted · <b>0</b> rejected</span>
            </div>
            <ul className="w-files">
              {FILES.map((f) => (
                <li key={f} className="w-file">
                  <span className="w-file-name"><Icon d="M6 3h8l4 4v14H6z" />{f}</span>
                  <span className="w-file-bar"><span /></span>
                  <span className="w-file-ok" aria-hidden="true">✓</span>
                </li>
              ))}
            </ul>
          </div>

          {/* view: the review table */}
          <div className="w-view w-view-review">
            <div className="w-head">
              <p className="w-h">Review <em>· run for 19 Oct</em></p>
              <span className="w-tabs"><b>Recommendations <i>5</i></b><span>Exceptions <i className="w-exc-count">0</i></span></span>
            </div>
            <div className="w-strip" aria-hidden="true">{["Run now", "Data", "Rules", "Exceptions", "Wording", "Sheet"].map((s) => <span key={s}><i />{s}</span>)}</div>
            <ul className="w-rows">
              {ROWS.map((r) => (
                <li key={r.sku} className={`w-row ${r.urgent ? "is-urgent" : ""}`} data-tone={r.tone}>
                  <span className="w-sku"><b>{r.name}</b><small>{r.sku}</small></span>
                  <span className="w-act"><b>{r.action}</b>{r.qty ? <small>{r.qty} units</small> : <small>no order</small>}</span>
                  <span className="w-chips">{r.chips.map((c) => <em key={c} className={`w-chip ${r.tone}`}>{c}</em>)}</span>
                  <span className="w-gauge" style={{ ["--pct" as string]: `${r.pct}%`, ["--min" as string]: `${(r.min / 16) * 100}%`, ["--max" as string]: `${(r.max / 16) * 100}%` }}>
                    <span className="w-track"><span className="w-band" /><span className="w-fill" data-tone={r.tone} /><span className="w-marker" data-tone={r.tone} /></span>
                    <b className="w-cover" data-to={r.cover}>{r.cover}</b>
                  </span>
                  <span className="w-status"><span className="w-st-pending">Pending</span><span className="w-st-approved">✓ Approved</span><span className="w-st-rejected">Rejected</span></span>
                </li>
              ))}
              <li className="w-row w-row-exc" data-tone="exception">
                <span className="w-sku"><b>Peanut Butter 300g</b><small>SKU015</small></span>
                <span className="w-act"><b>Exception</b><small>to Raghav</small></span>
                <span className="w-chips"><em className="w-chip exception">Anomalous jump</em></span>
                <span className="w-exc-text">Latest week sold 300 units against a 4-week mean of 30.</span>
              </li>
            </ul>
            <div className="w-foot">
              <span className="w-progress"><i /></span>
              <span><b className="w-decided">0</b> of 5 decided</span>
              <span className="w-spacer" />
              <span className="w-export">Export approved (<b className="w-export-n">0</b>)</span>
            </div>
          </div>

          {/* view: the kill switch */}
          <div className="w-view w-view-health">
            <p className="w-h">Health <em>· kill criteria</em></p>
            <div className="w-banner"><b>STOPPED</b> Weekly stockout incidents 34.1% worse than the baseline at 2 consecutive checks. Scheduled runs and exports are blocked.</div>
            <div className="w-chart">
              <svg viewBox="0 0 400 140" preserveAspectRatio="none" aria-hidden="true">
                <line className="w-limit" x1="0" y1="52" x2="400" y2="52" />
                <path className="w-spark" d="M0 104 L50 98 L100 106 L150 96 L200 90 L250 70 L300 48 L350 30 L400 22" />
                <circle className="w-dot" cx="300" cy="48" r="5" />
                <circle className="w-dot w-dot-2" cx="400" cy="22" r="5" />
              </svg>
              <span className="w-limit-label">limit: 20% worse</span>
            </div>
            <p className="w-clear"><b>Cleared by the sponsor</b> · &ldquo;Supplier is back and confirmed in writing&rdquo;</p>
          </div>

          {/* the explanation card (wording and the guardrail) */}
          <div className="w-explain">
            <div className="w-explain-head"><b>Reason · SKU001</b><em className="w-src"><span className="s-t">Template</span><span className="s-l">Gemini</span></em></div>
            <p className="w-reason">
              <span className="w-reason-text" data-full="Urgent: the last 4 weeks ran 21% above the 12-week average, and cover is only 3.4 weeks against a minimum of 6, so reorder 750 units." />
            </p>
            <p className="w-verify"><span className="w-v-item">✓ 4</span><span className="w-v-item">✓ 21%</span><span className="w-v-item">✓ 12</span><span className="w-v-item">✓ 3.4</span><span className="w-v-item">✓ 6</span><span className="w-v-item">✓ 750</span><b>every number is in the facts</b></p>
            <p className="w-bad"><s>“Cover will hit 9999 weeks by Friday.”</s> <b>Rejected</b>: 9999 is not in the facts. The fixed wording is used instead.</p>
          </div>

          {/* overlays */}
          <span className="w-cursor" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8-6 2 4 7-3 1.5-4-7-5 4z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" /></svg><i className="w-ripple" /></span>
          <div className="w-csv"><Icon d="M6 3h8l4 4v14H6z" />orders.csv <small>1 line</small></div>
          <div className="w-po"><small>Zoho Inventory</small><b>PO-00001</b><span>Test Distributor · 750 × ₹40</span><em className="w-stamp">DRAFT</em><span className="w-issue"><s>Issue</s> only a person, in Zoho</span></div>
        </div>
      </div>
    </div>
  );
}
