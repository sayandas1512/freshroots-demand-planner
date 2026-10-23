import type { Db } from "@/db/client";
import { log } from "@/lib/log";
import { ZohoClient, dbTokenStore } from "./client";
import { zohoConfig } from "./config";
import { lastSync, syncZoho, type SyncReport } from "./sync";

export { zohoConfig };

/** The configured Zoho client, or null when the connector is not set up (the CSV paths then apply). */
export function getZohoClient(db: Db): ZohoClient | null {
  const cfg = zohoConfig();
  return cfg ? new ZohoClient(cfg, dbTokenStore(db)) : null;
}

export const RUN_SYNC_MAX_AGE_MS = 30 * 60_000;

/**
 * Called at the start of a run so the open POs are fresh. If the last good sync is recent it does nothing. A failed
 * sync never stops the run: the previously synced POs are used and the caller records a note.
 */
export async function ensureFreshOpenPos(db: Db, maxAgeMs: number = RUN_SYNC_MAX_AGE_MS, now: Date = new Date()): Promise<{ attempted: boolean; report: SyncReport | null; lastOkAt: Date | null }> {
  const client = getZohoClient(db);
  if (!client) return { attempted: false, report: null, lastOkAt: null };
  const last = await lastSync(db);
  if (last?.ok && now.getTime() - last.at.getTime() < maxAgeMs) return { attempted: false, report: null, lastOkAt: last.at };
  try {
    const report = await syncZoho(db, client, { trigger: "run", now });
    return { attempted: true, report, lastOkAt: report.ok ? now : (last?.ok ? last.at : null) };
  } catch (err) {
    log("error", "zoho sync before run failed", { error: err instanceof Error ? err.message : "unknown" });
    return { attempted: true, report: null, lastOkAt: last?.ok ? last.at : null };
  }
}
