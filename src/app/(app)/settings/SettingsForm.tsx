"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FESTIVAL_UPLIFT_MODES, diffConfig, ruleConfigSchema, type FestivalUpliftMode, type RuleConfig } from "@/engine/config";
import type { ImpactPreview } from "@/run/preview";

interface HistoryItem {
  version: number;
  note: string;
  createdAt: string;
  isActive: boolean;
  isFirst: boolean;
  changes: { label: string; from: string; to: string }[];
}

type NumericKey = {
  [K in keyof RuleConfig]: RuleConfig[K] extends number ? K : never;
}[keyof RuleConfig];

type Perm = "rules" | "kill";

interface FieldDef {
  key: NumericKey;
  perm?: Perm;
  label: string;
  help: string;
  step: number;
}

const GROUPS: { title: string; note?: string; fields: FieldDef[] }[] = [
  {
    title: "Windows",
    fields: [
      { key: "baseline_weeks", label: "Baseline window (weeks)", help: "Average weekly sales over the last N complete weeks. The recent window sits inside it.", step: 1 },
      { key: "recent_weeks", label: "Recent window (weeks)", help: "Used for the high-demand trend check.", step: 1 },
    ],
  },
  {
    title: "Rule 1: high demand",
    fields: [
      { key: "high_demand_ratio", label: "High-demand ratio", help: "Flag when the recent average is more than this multiple of the baseline average (1.20 = more than 20% above).", step: 0.01 },
      { key: "high_demand_multiplier", label: "Order multiplier", help: "Reorder this multiple of the standard quantity when flagged.", step: 0.1 },
    ],
  },
  {
    title: "Rules 2, 3 and 5: weeks of cover",
    fields: [
      { key: "cover_min_weeks", label: "Minimum cover (weeks)", help: "Below this is stockout risk: reorder now.", step: 0.5 },
      { key: "cover_max_weeks", label: "Maximum cover (weeks)", help: "Above this is overstock risk: pause the next order.", step: 0.5 },
      { key: "perishable_min_weeks", label: "Perishable minimum (weeks)", help: "Replaces the minimum for high-perishability SKUs.", step: 0.5 },
      { key: "perishable_max_weeks", label: "Perishable maximum (weeks)", help: "Replaces the maximum for high-perishability SKUs.", step: 0.5 },
    ],
  },
  {
    title: "Data and exceptions",
    fields: [
      { key: "stale_inventory_days", label: "Stale stock limit (days)", help: "If the newest stock snapshot is older than this at run time, the run is marked degraded and a banner is shown.", step: 1 },
      { key: "anomaly_factor", label: "Anomalous jump factor", help: "The latest week more than this many times above or below the previous weeks' mean goes to Raghav.", step: 0.1 },
      { key: "anomaly_lookback_weeks", label: "Anomaly look-back (weeks)", help: "How many weeks before the latest one form the comparison mean.", step: 1 },
    ],
  },
  {
    title: "Kill and warning thresholds",
    note: "Starting proposals. The sponsor must confirm them before go-live. Only the sponsor or an admin can change them.",
    fields: [
      { key: "indicator_kill_pct", perm: "kill", label: "Weekly indicators: kill when more than this % worse", help: "4-week average of stockout incidents, or of overstock value, against the frozen 8-week baseline.", step: 1 },
      { key: "indicator_warn_pct", perm: "kill", label: "Weekly indicators: warn at this % worse", help: "A warning only.", step: 1 },
      { key: "indicator_consecutive_checks", perm: "kill", label: "Consecutive checks needed to kill", help: "Checks on different outcome weeks.", step: 1 },
      { key: "override_kill_rate", perm: "kill", label: "Override kill rate", help: "(edited + rejected) / decided lines. 0.5 = 50%. Exceptions are not counted. Not evaluated in shadow mode.", step: 0.05 },
      { key: "override_kill_runs", perm: "kill", label: "Consecutive runs above that rate", help: "Completed live runs.", step: 1 },
      { key: "rubber_override_rate", perm: "kill", label: "Rubber-stamp warning: override rate below", help: "0.02 = 2%. A warning, never a kill.", step: 0.01 },
      { key: "rubber_median_seconds", perm: "kill", label: "Rubber-stamp warning: median seconds per decision below", help: "Both conditions must hold on every run in the window.", step: 1 },
      { key: "rubber_runs", perm: "kill", label: "Rubber-stamp warning: consecutive runs", help: "Completed runs.", step: 1 },
    ],
  },
  {
    title: "Optional data (off by default)",
    fields: [{ key: "distributor_shift_pct", label: "Distributor shift threshold (%)", help: "Used only when distributor-shift exceptions are switched on below.", step: 1 }],
  },
];

const MODE_COPY: Record<FestivalUpliftMode, { title: string; body: string }> = {
  cover_demand: {
    title: "Cover only (default)",
    body: "In a festival month, weekly demand used for weeks of cover is multiplied by 1 + uplift. The high-demand trend check uses raw actuals, so a festival does not hide or invent a trend.",
  },
  both_windows: {
    title: "Both windows",
    body: "Both the recent and baseline averages are multiplied by 1 + uplift. The trend ratio is unchanged and cover is scaled the same way as the default.",
  },
  baseline_only: {
    title: "Baseline only",
    body: "Only the baseline average is multiplied by 1 + uplift. This also lowers the trend ratio, so fewer SKUs are flagged high-demand in a festival month.",
  },
};

const fmt = (v: unknown): string => (typeof v === "boolean" ? (v ? "yes" : "no") : Array.isArray(v) ? v.join(", ") : String(v));

const TOGGLES: { key: "enable_distributor_exceptions" | "enable_lead_time_flag" | "enable_moq_flag"; label: string; help: string }[] = [
  { key: "enable_distributor_exceptions", label: "Distributor-shift exceptions", help: "Flags an SKU to Raghav when a distributor's share of its volume over the last 4 weeks is well below its 12-week share. Needs the optional Distributor_ID column on sales. Never produces a recommendation." },
  { key: "enable_lead_time_flag", label: "Lead-time breach flag", help: "Informational flag when cover is shorter than the SKU's lead time. Needs lead_time_weeks on the SKU master." },
  { key: "enable_moq_flag", label: "Minimum order quantity flag", help: "Informational flag when the recommended quantity is below the SKU's MOQ. Needs moq on the SKU master." },
];

export function SettingsForm({ active, history, perms }: { active: { version: number; config: RuleConfig }; history: HistoryItem[]; perms: { editRules: boolean; editKill: boolean; setMode: boolean } }) {
  const router = useRouter();
  const [draft, setDraft] = useState<RuleConfig>(active.config);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const changes = useMemo(() => diffConfig(active.config, draft), [active.config, draft]);
  const validation = useMemo(() => ruleConfigSchema.safeParse(draft), [draft]);
  const issues = validation.success ? [] : validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

  function setNumber(key: NumericKey, raw: string) {
    setPreview(null);
    const value = Number(raw);
    setDraft((d) => ({ ...d, [key]: raw === "" || Number.isNaN(value) ? 0 : value }));
  }

  async function call<T>(url: string, body: unknown): Promise<T | null> {
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as T & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "The server rejected that request.");
        return null;
      }
      return json;
    } catch {
      setError("Could not reach the server.");
      return null;
    }
  }

  async function runPreview() {
    setBusy("preview");
    setSaved(null);
    const result = await call<ImpactPreview>("/api/settings/preview", { config: draft });
    setBusy(null);
    if (result) setPreview(result);
  }

  async function save() {
    setBusy("save");
    const result = await call<{ version: number }>("/api/settings/config", { config: draft, note });
    setBusy(null);
    if (result) {
      setSaved(result.version);
      setNote("");
      setPreview(null);
      router.refresh();
    }
  }

  return (
    <div className="settings-layout">
      <div className="settings-fields">
        <fieldset className="card fieldset" disabled={!perms.setMode} data-testid="mode-group">
          <legend><h2>Operating mode</h2></legend>
          <div className="mode-list" role="radiogroup" aria-label="Operating mode">
            {(["shadow", "live"] as const).map((m) => (
              <label key={m} className="mode" data-selected={draft.mode === m}>
                <input type="radio" name="op-mode" value={m} checked={draft.mode === m} onChange={() => { setPreview(null); setDraft((d) => ({ ...d, mode: m })); }} data-testid={`op-mode-${m}`} />
                <span>
                  <strong>{m === "shadow" ? "Shadow" : "Live"}</strong>
                  <span className="hint block">{m === "shadow" ? "Runs, sheets, reviews and overrides all work. The purchase-order export is blocked. Used for the first weeks to compare with Raghav's own forecast." : "The export works. Switching to live needs the go-live checklist on the Health page to be complete, and freezes the weekly baseline."}</span>
                </span>
              </label>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={draft.zoho_push_enabled} onChange={(e) => { setPreview(null); setDraft((d) => ({ ...d, zoho_push_enabled: e.target.checked })); }} data-testid="cfg-zoho_push_enabled" />
            <span><strong>Allow creating draft purchase orders in Zoho</strong><span className="hint block">Off by default. When on, the planner can send approved lines to Zoho as drafts from the Export preview. Drafts are never issued by the system. Needs the Zoho connector and live mode.</span></span>
          </label>
          {!perms.setMode ? <p className="small muted">Only the sponsor or an admin can change the mode and this switch.</p> : null}
        </fieldset>

        {GROUPS.map((g) => (
          <fieldset key={g.title} className="card fieldset">
            <legend><h2>{g.title}</h2></legend>
            {g.note ? <p className="small muted">{g.note}</p> : null}
            <div className="fields-grid">
              {g.fields.map((f) => (
                <label key={f.key} className="field">
                  {f.label}
                  <input type="number" step={f.step} value={draft[f.key]} disabled={f.perm === "kill" ? !perms.editKill : !perms.editRules} onChange={(e) => setNumber(f.key, e.target.value)} data-testid={`cfg-${f.key}`} />
                  <span className="hint">{f.help}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <fieldset className="card fieldset">
          <legend><h2>Rule 4: festival months</h2></legend>
          <label className="field narrow">
            Demand uplift in festival months
            <input type="number" step={0.01} disabled={!perms.editRules} value={draft.festival_uplift} onChange={(e) => setNumber("festival_uplift", e.target.value)} data-testid="cfg-festival_uplift" />
            <span className="hint">0.25 = 25%. Which months count is set in the calendar below, using the month of the run date.</span>
          </label>
          <div className="banner banner-warn" role="note">
            <span><strong>Open question for Raghav.</strong> The brief says the uplift applies &quot;before any threshold checks&quot; but not to which figures. Pick the reading that matches how you work; the default is the narrowest.</span>
          </div>
          <div className="mode-list" role="radiogroup" aria-label="Festival uplift mode">
            {FESTIVAL_UPLIFT_MODES.map((m) => (
              <label key={m} className="mode" data-selected={draft.festival_uplift_mode === m}>
                <input type="radio" name="mode" value={m} disabled={!perms.editRules} checked={draft.festival_uplift_mode === m} onChange={() => { setPreview(null); setDraft((d) => ({ ...d, festival_uplift_mode: m })); }} data-testid={`mode-${m}`} />
                <span>
                  <strong>{MODE_COPY[m].title}</strong> <code>{m}</code>
                  <span className="hint block">{MODE_COPY[m].body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="card fieldset" disabled={!perms.editRules}>
          <legend><h2>Optional features and export</h2></legend>
          {TOGGLES.map((t) => (
            <label key={t.key} className="check">
              <input type="checkbox" checked={draft[t.key]} onChange={(e) => { setPreview(null); setDraft((d) => ({ ...d, [t.key]: e.target.checked })); }} data-testid={`cfg-${t.key}`} />
              <span><strong>{t.label}</strong><span className="hint block">{t.help}</span></span>
            </label>
          ))}
          <label className="field">
            Expected distributor regions
            <input type="text" value={draft.expected_regions.join(", ")} onChange={(e) => { setPreview(null); setDraft((d) => ({ ...d, expected_regions: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })); }} data-testid="cfg-expected_regions" />
            <span className="hint">Comma-separated. A distributor outside these regions gets a warning on upload (not an error).</span>
          </label>
          <label className="field">
            Export label for the distributor column
            <input type="text" value={draft.export_id_label} onChange={(e) => { setPreview(null); setDraft((d) => ({ ...d, export_id_label: e.target.value })); }} data-testid="cfg-export_id_label" />
            <span className="hint">It is not confirmed whether the SKU master&apos;s Distributor_ID is the supplier we order from or the selling distributor.</span>
          </label>
        </fieldset>

        <fieldset className="card fieldset">
          <legend><h2>Open purchase orders</h2></legend>
          <label className="check">
            <input type="checkbox" disabled={!perms.editRules} checked={draft.include_open_po_in_stock} onChange={(e) => { setPreview(null); setDraft((d) => ({ ...d, include_open_po_in_stock: e.target.checked })); }} data-testid="cfg-include_open_po_in_stock" />
            <span><strong>Count open POs as stock</strong><span className="hint block">Off by default. Open PO quantity is always shown next to stock either way.</span></span>
          </label>
        </fieldset>
      </div>

      <aside className="settings-side" aria-label="Review and save">
        <div className="card side-card">
          <h2>Changes from version {active.version}</h2>
          {changes.length === 0 ? (
            <p className="muted">No changes yet.</p>
          ) : (
            <ul className="diff" data-testid="config-diff">
              {changes.map((c) => (
                <li key={c.key}><span>{c.label}</span><span className="num"><s>{fmt(c.from)}</s> → <strong>{fmt(c.to)}</strong></span></li>
              ))}
            </ul>
          )}
          {issues.length > 0 ? <ul className="form-error">{issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}

          <button type="button" className="btn" onClick={runPreview} disabled={busy !== null || issues.length > 0 || changes.length === 0} data-testid="preview-impact">
            {busy === "preview" ? "Calculating…" : "Preview impact"}
          </button>
          {preview ? (
            <div className="preview" role="status" data-testid="impact-result">
              <p>
                <strong className="num" data-testid="impact-count">{preview.changed.length}</strong> of <span className="num">{preview.totalSkus}</span> lines would change on the latest run date (<span className="num">{preview.asOf}</span>).
              </p>
              {preview.changed.length > 0 ? (
                <ul className="diff">
                  {preview.changed.map((c) => <li key={c.skuId}><span className="mono">{c.skuId}</span><span className="num">{c.before} → <strong>{c.after}</strong></span></li>)}
                </ul>
              ) : null}
              <p className="small muted">Nothing was saved.</p>
            </div>
          ) : null}

          <label className="field">
            Note for this version
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why are you changing the rules?" data-testid="config-note" />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {saved ? <p role="status" className="ok-text">Saved as version {saved}. It applies from the next run.</p> : null}
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy !== null || changes.length === 0 || issues.length > 0 || note.trim().length < 3} data-testid="save-config">
            {busy === "save" ? "Saving…" : "Save as new version"}
          </button>
        </div>

        <div className="card side-card">
          <h2>Version history</h2>
          <ol className="history">
            {history.map((h) => (
              <li key={h.version} data-testid={`version-${h.version}`}>
                <div className="history-head">
                  <strong>v{h.version}</strong>
                  {h.isActive ? <span className="chip chip-hold">Active</span> : null}
                  <span className="faint small">{new Date(h.createdAt).toLocaleString("en-IN")}</span>
                </div>
                <p className="small">{h.note || "No note"}</p>
                {h.isFirst ? <p className="faint small">First version.</p> : h.changes.length === 0 ? <p className="faint small">No rule changes.</p> : (
                  <ul className="diff small">{h.changes.map((c) => <li key={c.label}><span>{c.label}</span><span className="num"><s>{c.from}</s> → {c.to}</span></li>)}</ul>
                )}
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
