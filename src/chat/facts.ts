import { desc } from "drizzle-orm";
import type { Db } from "@/db/client";
import { killChecks } from "@/db/schema";
import { getKillState } from "@/kill/state";
import { getMeasurementStart } from "@/run/measurement";
import { getActiveConfig } from "@/run/config-store";
import { systemHealth } from "@/run/healthcheck";
import { loadReview } from "@/run/queries";
import { zohoStatus } from "@/zoho/status";
import { howItWorks } from "./prompt";

/** Lines beyond this many are summarised by count only, so the prompt stays small at 400 SKUs. */
export const MAX_FACT_LINES = 120;

export interface ChatContext {
  /** Everything the assistant may quote. Plain JSON, no secrets, no personal data. */
  facts: Record<string, unknown>;
  /** The documented behaviour, with live settings. */
  knowledge: string;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Builds the only information the assistant is given: the latest run as the Review page shows it, the exceptions,
 * kill state and criteria, measurement start, Zoho status and the active settings. Read-only queries.
 */
export async function buildChatContext(db: Db): Promise<ChatContext> {
  const [review, config, kill, health, measureStart, zoho, lastCheck] = await Promise.all([
    loadReview(db),
    getActiveConfig(db),
    getKillState(db),
    systemHealth(db, { pingLlm: false }),
    getMeasurementStart(db),
    zohoStatus(db),
    db.select().from(killChecks).orderBy(desc(killChecks.at)).limit(1),
  ]);

  const rows = review?.rows ?? [];
  const byAction: Record<string, number> = {};
  const byDecision: Record<string, number> = {};
  for (const r of rows) {
    byAction[r.action] = (byAction[r.action] ?? 0) + 1;
    byDecision[r.status] = (byDecision[r.status] ?? 0) + 1;
  }
  // actionable and urgent lines first, so a truncated list still holds what matters
  const rank = (r: (typeof rows)[number]): number => (r.metrics.coverWeeks <= 0 ? 0 : 1) + (r.action === "HOLD" ? 10 : 0) + (r.flags.length === 0 ? 5 : 0);
  const shown = [...rows].sort((a, b) => rank(a) - rank(b) || a.metrics.coverWeeks - b.metrics.coverWeeks).slice(0, MAX_FACT_LINES);

  const criteria = (lastCheck[0]?.result as { criteria?: { label: string; status: string; value: string | null; threshold: string; detail: string }[] } | undefined)?.criteria ?? [];

  const facts: Record<string, unknown> = {
    latest_run: review
      ? {
          run_date: review.run.asOf,
          status: review.run.status,
          started: review.run.startedAt,
          trigger: review.run.trigger,
          rules_version: review.run.configVersion,
          festival_mode: review.run.festivalMode,
          wording_status: review.run.llmStatus,
          notes: review.run.notes.slice(0, 5),
          headline: review.headline?.lines ?? null,
          lines_total: rows.length,
          lines_by_action: byAction,
          lines_by_decision: byDecision,
          lines_shown: shown.length,
        }
      : null,
    lines: shown.map((r) => ({
      sku: r.skuId,
      name: r.name,
      category: r.category,
      perishable: r.metrics.perishable,
      action: r.action,
      qty: r.qty,
      flags: r.flags,
      rule: r.ruleFired,
      cover_weeks: r.metrics.coverWeeks,
      cover_min: r.metrics.coverMin,
      cover_max: r.metrics.coverMax,
      stock_on_hand: r.metrics.stockOnHand,
      open_po: r.metrics.openPoQty,
      baseline_avg: r.metrics.avgBaseline,
      recent_avg: r.metrics.avgRecent,
      ratio: r.metrics.ratio,
      festival_uplift_applied: r.metrics.upliftApplied,
      standard_reorder_qty: r.metrics.standardReorderQty,
      distributor: r.distributorId,
      reason: r.explanation,
      decision: r.status,
      final_qty: r.finalQty,
      decision_note: r.decidedNote,
    })),
    exceptions: (review?.exceptions ?? []).slice(0, 30).map((e) => ({ sku: e.skuId, name: e.name, type: e.type, detail: e.detail, status: e.status, note: e.handledNote })),
    system: {
      overall: health.overall,
      data: health.files,
      language_model: { provider: health.llm.provider, model: health.llm.model },
    },
    kill_switch: {
      active: kill.active,
      reason: kill.reason,
      set_by: kill.by,
      since: kill.since ? new Date(kill.since).toISOString() : null,
      last_check: lastCheck[0] ? { at: lastCheck[0].at.toISOString(), trigger: lastCheck[0].trigger, latest_week: lastCheck[0].latestWeek, levels: lastCheck[0].levels } : null,
      criteria: criteria.map((c) => ({ criterion: c.label, status: c.status, value: c.value, threshold: c.threshold, detail: c.detail })),
      measurement_start: measureStart,
    },
    settings: config.config,
    settings_version: config.version,
    zoho: {
      configured: zoho.configured,
      last_sync: zoho.lastSync ? { at: zoho.lastSync.at, ok: zoho.lastSync.ok, error: zoho.lastSync.error } : null,
      counts: zoho.counts,
      calls_today: zoho.callsToday,
      daily_budget: zoho.budget,
      distributors_mapped: zoho.distributors.filter((d) => d.vendorId).length,
      distributors_total: zoho.distributors.length,
      skus_without_zoho_item: zoho.skusWithoutItem.length,
      draft_purchase_orders: zoho.pushLog.slice(0, 5).map((p) => ({ at: p.at, reference: p.reference, status: p.status, zoho_po_number: p.zohoPoNumber, error: p.error })),
    },
  };

  // percent-above-baseline as one number per line, so the assistant never has to compute it
  for (const line of facts.lines as Record<string, unknown>[]) {
    const ratio = line.ratio as number;
    line.pct_vs_baseline = round1((ratio - 1) * 100);
  }

  return { facts, knowledge: howItWorks(config.config) };
}
