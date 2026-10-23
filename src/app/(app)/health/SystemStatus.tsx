"use client";

import { useState } from "react";
import type { SystemHealth } from "@/run/healthcheck";

const CHIP: Record<SystemHealth["overall"], string> = { ok: "chip-hold", degraded: "chip-demand", stopped: "chip-stockout", down: "chip-stockout" };

export function SystemStatus({ initial }: { initial: SystemHealth }) {
  const [h, setH] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function refresh(llm: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/health${llm ? "?llm=1" : ""}`, { cache: "no-store" });
      setH((await res.json()) as SystemHealth);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card section" aria-labelledby="sys-h" data-testid="system-status">
      <div className="log-head">
        <h2 id="sys-h">System status</h2>
        <span className={`chip ${CHIP[h.overall]}`} data-testid="overall-status">{h.overall}</span>
        <button type="button" className="btn btn-sm" onClick={() => refresh(true)} disabled={busy}>{busy ? "Checking…" : "Check now, including the LLM"}</button>
      </div>
      <div className="grid grid-3">
        <div><span className="stat-label">Database</span><p className="num">{h.db.ok ? `reachable (${h.db.ms} ms)` : "unreachable"}</p></div>
        <div><span className="stat-label">Last run</span><p className="num">{h.lastRun ? `${h.lastRun.asOf}: ${h.lastRun.status.replaceAll("_", " ")}` : "none yet"}</p></div>
        <div><span className="stat-label">Files</span><p className="num">sales {h.files.latestSalesWeek ?? "none"} · stock {h.files.latestInventoryDate ?? "none"}{h.files.inventoryStale ? " (stale)" : ""}</p></div>
        <div><span className="stat-label">Zoho</span><p className="num" data-testid="zoho-health">{!h.zoho.configured ? "not connected: CSV paths" : h.zoho.lastSyncAt === null ? "no sync yet" : `${h.zoho.lastSyncOk ? "synced" : "last sync failed"} ${h.zoho.ageMinutes} min ago${h.zoho.error ? ` (${h.zoho.error})` : ""}`}</p></div>
        <div><span className="stat-label">LLM</span><p className="num">{h.llm.provider ? `${h.llm.provider} ${h.llm.model ?? ""}: ${h.llm.reachable === null ? "not checked" : h.llm.reachable ? "reachable" : `unreachable (${h.llm.error ?? "error"})`}` : "not configured: template wording"}</p></div>
      </div>
    </section>
  );
}
