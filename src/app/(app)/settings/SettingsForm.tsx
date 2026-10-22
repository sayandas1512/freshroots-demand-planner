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

interface FieldDef {
  key: NumericKey;
  label: string;
  help: string;
  step: number;
}

const GROUPS: { title: string; fields: FieldDef[] }[] = [
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

const fmt = (v: unknown): string => (typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

export function SettingsForm({ active, history }: { active: { version: number; config: RuleConfig }; history: HistoryItem[] }) {
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
        {GROUPS.map((g) => (
          <fieldset key={g.title} className="card fieldset">
            <legend><h2>{g.title}</h2></legend>
            <div className="fields-grid">
              {g.fields.map((f) => (
                <label key={f.key} className="field">
                  {f.label}
                  <input type="number" step={f.step} value={draft[f.key]} onChange={(e) => setNumber(f.key, e.target.value)} data-testid={`cfg-${f.key}`} />
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
            <input type="number" step={0.01} value={draft.festival_uplift} onChange={(e) => setNumber("festival_uplift", e.target.value)} data-testid="cfg-festival_uplift" />
            <span className="hint">0.25 = 25%. Which months count is set in the calendar below, using the month of the run date.</span>
          </label>
          <div className="banner banner-warn" role="note">
            <span><strong>Open question for Raghav.</strong> The brief says the uplift applies &quot;before any threshold checks&quot; but not to which figures. Pick the reading that matches how you work; the default is the narrowest.</span>
          </div>
          <div className="mode-list" role="radiogroup" aria-label="Festival uplift mode">
            {FESTIVAL_UPLIFT_MODES.map((m) => (
              <label key={m} className="mode" data-selected={draft.festival_uplift_mode === m}>
                <input type="radio" name="mode" value={m} checked={draft.festival_uplift_mode === m} onChange={() => { setPreview(null); setDraft((d) => ({ ...d, festival_uplift_mode: m })); }} data-testid={`mode-${m}`} />
                <span>
                  <strong>{MODE_COPY[m].title}</strong> <code>{m}</code>
                  <span className="hint block">{MODE_COPY[m].body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="card fieldset">
          <legend><h2>Open purchase orders</h2></legend>
          <label className="check">
            <input type="checkbox" checked={draft.include_open_po_in_stock} onChange={(e) => { setPreview(null); setDraft((d) => ({ ...d, include_open_po_in_stock: e.target.checked })); }} data-testid="cfg-include_open_po_in_stock" />
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
