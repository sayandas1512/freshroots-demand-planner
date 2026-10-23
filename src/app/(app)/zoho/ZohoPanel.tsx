"use client";

import { ConfirmAction } from "@/components/ConfirmAction";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ZohoStatus } from "@/zoho/status";

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 120 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

export function ZohoClientPanel({ status, canEdit, canExport }: { status: ZohoStatus; canEdit: boolean; canExport: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(key: string, url: string, body: unknown, done: (j: Record<string, unknown>) => string) {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      setMessage(res.ok ? { ok: true, text: done(j) } : { ok: false, text: String(j.error ?? "Failed.") });
      if (res.ok) router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  const sync = (force: boolean) =>
    call("sync", "/api/zoho/sync", { force }, (j) => `Synced: ${String(j.openPoRows)} open PO lines from ${String(j.posOpen)} open purchase orders, ${String(j.calls)} Zoho calls used.${Array.isArray(j.warnings) && j.warnings.length ? ` ${(j.warnings as string[]).join(" ")}` : ""}`);

  if (!status.configured) {
    return (
      <>
        <div className="page-head"><div><h1>Zoho Inventory</h1></div></div>
        <div className="card empty" data-testid="zoho-off">
          <h3>The Zoho connector is not set up</h3>
          <p>Open POs still come from the CSV upload on the Data page, and approved lines still export as a CSV. To connect Zoho, follow <code>docs/ZOHO.md</code>: it takes one grant code and four environment variables.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Zoho Inventory</h1>
          <p>Open purchase orders are read from Zoho on a schedule, before every run, and on demand. Approved lines can be created as <strong>draft</strong> purchase orders: someone still reviews and issues them in Zoho.</p>
        </div>
        {canEdit ? (
          <div className="run-controls">
            <button type="button" className="btn" onClick={() => sync(true)} disabled={busy !== null}>Full re-read</button>
            <button type="button" className="btn btn-primary" onClick={() => sync(false)} disabled={busy !== null} data-testid="zoho-sync">{busy === "sync" ? "Syncing…" : "Sync now"}</button>
          </div>
        ) : null}
      </div>
      {message ? <div className={`banner ${message.ok ? "banner-info" : "banner-bad"}`} role="status"><span>{message.text}</span></div> : null}

      <section className="grid grid-4" aria-label="Zoho status">
        <div className="card stat"><span className="stat-label">Last sync</span><span className="stat-value" data-testid="zoho-last">{status.lastSync ? (status.lastSync.ok ? "OK" : "Failed") : "None"}</span><span className="muted small">{status.lastSync ? `${ago(status.lastSync.at)} · ${status.lastSync.trigger}${status.lastSync.error ? ` · ${status.lastSync.error}` : ""}` : "Press Sync now"}</span></div>
        <div className="card stat"><span className="stat-label">Open purchase orders</span><span className="stat-value num">{status.counts.openPos}</span><span className="muted small">{status.counts.openPoRows} lines matched to SKUs</span></div>
        <div className="card stat"><span className="stat-label">Zoho calls today</span><span className="stat-value num">{status.callsToday}</span><span className="muted small">budget {status.budget} per 24 hours</span></div>
        <div className="card stat"><span className="stat-label">Items and vendors</span><span className="stat-value num">{status.counts.items} · {status.counts.vendors}</span><span className="muted small">data centre .{status.dc}</span></div>
      </section>

      <section className="card section" aria-labelledby="vm-h">
        <h2 id="vm-h">Vendor mapping</h2>
        <p className="muted small">Each <code>Distributor_ID</code> on the SKU master is ordered from one Zoho vendor. It is not yet confirmed whether that ID is the supplier or the selling distributor; this table is where that is settled.</p>
        <div className="table-wrap">
          <table className="data" data-testid="vendor-map">
            <thead><tr><th>Distributor</th><th>Region</th><th>Zoho vendor</th></tr></thead>
            <tbody>
              {status.distributors.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong> <span className="mono small muted">{d.id}</span></td>
                  <td>{d.region}</td>
                  <td>
                    <select aria-label={`Zoho vendor for ${d.id}`} value={d.vendorId ?? ""} disabled={!canEdit || busy !== null} onChange={(e) => call(`v-${d.id}`, "/api/zoho/map", { type: "vendor", key: d.id, value: e.target.value || null }, () => "Vendor mapping saved.")}>
                      <option value="">Not mapped</option>
                      {status.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card section" aria-labelledby="im-h">
        <h2 id="im-h">Item matching</h2>
        <p className="muted small">A Zoho item matches a SKU when its Zoho SKU equals our <code>SKU_ID</code>. Anything else can be matched by hand here.</p>
        {status.unmappedItems.length > 0 ? (
          <div className="banner banner-warn" role="status" data-testid="unmapped-items"><span><strong>{status.unmappedItems.length} Zoho items on open purchase orders are not matched to a SKU</strong> (their quantity is not counted): {status.unmappedItems.map((u) => `${u.name || u.itemId} (${u.openQty})`).join(", ")}.</span></div>
        ) : <p className="small ok-text">Every item on an open purchase order is matched.</p>}
        {status.skusWithoutItem.length > 0 ? (
          <div className="table-wrap">
            <table className="data" data-testid="sku-map">
              <thead><tr><th>SKU with no Zoho item</th><th>Zoho item</th></tr></thead>
              <tbody>
                {status.skusWithoutItem.slice(0, 50).map((s) => (
                  <tr key={s.skuId}>
                    <td><strong>{s.name}</strong> <span className="mono small muted">{s.skuId}</span></td>
                    <td>
                      <select aria-label={`Zoho item for ${s.skuId}`} value="" disabled={!canEdit || busy !== null} onChange={(e) => e.target.value && call(`i-${s.skuId}`, "/api/zoho/map", { type: "item", key: s.skuId, value: e.target.value }, () => "Item mapping saved. It applies at the next sync.")}>
                        <option value="">Choose an item…</option>
                        {status.items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ""}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {status.skusWithoutItem.length > 50 ? <p className="small muted">Showing 50 of {status.skusWithoutItem.length}.</p> : null}
          </div>
        ) : null}
      </section>

      <section className="card section" aria-labelledby="ph-h">
        <h2 id="ph-h">Draft purchase orders created</h2>
        {status.pushLog.length === 0 ? <p className="muted small">None yet. Drafts are created from the Export preview, once the sponsor has switched the feature on and the system is live.</p> : (
          <div className="table-wrap">
            <table className="data" data-testid="push-log">
              <thead><tr><th>When</th><th>Reference</th><th>Status</th><th>Zoho PO</th><th className="r">Lines</th><th>Detail</th><th /></tr></thead>
              <tbody>
                {status.pushLog.map((p) => (
                  <tr key={p.reference}>
                    <td className="num">{new Date(p.at).toLocaleString("en-IN")}</td>
                    <td className="mono">{p.reference}</td>
                    <td><span className={`chip ${p.status === "created" ? "chip-hold" : p.status === "failed" ? "chip-stockout" : "chip-demand"}`}>{p.status}</span></td>
                    <td className="mono">{p.zohoPoNumber ?? ""}</td>
                    <td className="num r">{p.lineCount}</td>
                    <td className="small">{p.error ?? ""}</td>
                    <td>{canExport && p.status === "unconfirmed" ? <ConfirmAction label="Not in Zoho: allow retry" message="Only continue if you have looked in Zoho and this draft purchase order is NOT there. Otherwise a duplicate will be created." confirmLabel="It is not there, allow retry" className="btn btn-sm" disabled={busy !== null} onConfirm={() => void call(`r-${p.reference}`, "/api/zoho/retry", { reference: p.reference }, () => "Retry allowed. Push again from the Export preview.")} /> : null}</td>
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
