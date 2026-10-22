import type { LlmStatus } from "./status";
import { validateHeadline, validateReason } from "./guardrails";
import { templateHeadline, templateReason } from "./templates";
import type { ExplainFacts, HeadlineFacts, LlmProvider, LlmUsage } from "./types";

export const BATCH_SIZE = 25;
export const CALL_TIMEOUT_MS = 10_000;
export const MAX_ATTEMPTS = 2; // first try plus one retry

export interface Explanation {
  skuId: string;
  text: string;
  source: "llm" | "template";
}

export interface Narrative {
  explanations: Explanation[];
  headline: { lines: [string, string, string]; source: "llm" | "template" };
  llmStatus: LlmStatus;
  calls: number;
  usage: LlmUsage;
}

export interface NarrativeOptions {
  callTimeoutMs?: number;
  /** Called after each phase so the run can stream progress. */
  onPhase?: (phase: "llm_explain" | "llm_headline", degraded: boolean) => Promise<void>;
}

async function attempt<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number, counter: { calls: number }): Promise<T | null> {
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("LLM call timed out")), timeoutMs);
    counter.calls += 1;
    try {
      return await fn(controller.signal);
    } catch {
      // Network error, timeout, API error or invalid JSON: retry once, then give up and use templates.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function addUsage(total: LlmUsage, add: LlmUsage): void {
  total.inputTokens += add.inputTokens;
  total.outputTokens += add.outputTokens;
}

/**
 * Produce the reason for every flagged line and the run headline. Templates are computed first, so every
 * line always has wording; the LLM only replaces a template when its output passes the guardrails.
 * Nothing here can throw: any failure degrades to template text.
 */
export async function generateNarrative(
  provider: LlmProvider | null,
  flagged: readonly ExplainFacts[],
  headlineFacts: HeadlineFacts,
  options: NarrativeOptions = {},
): Promise<Narrative> {
  const timeout = options.callTimeoutMs ?? CALL_TIMEOUT_MS;
  const explanations: Explanation[] = flagged.map((f) => ({ skuId: f.skuId, text: templateReason(f), source: "template" }));
  const byId = new Map(explanations.map((e) => [e.skuId, e]));
  const factsById = new Map(flagged.map((f) => [f.skuId, f]));
  const headline: Narrative["headline"] = { lines: templateHeadline(headlineFacts), source: "template" };
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  const counter = { calls: 0 };

  if (!provider) {
    await options.onPhase?.("llm_explain", true);
    await options.onPhase?.("llm_headline", true);
    return { explanations, headline, llmStatus: "skipped", calls: 0, usage };
  }

  for (let i = 0; i < flagged.length; i += BATCH_SIZE) {
    const batch = flagged.slice(i, i + BATCH_SIZE);
    const res = await attempt((signal) => provider.explain([...batch], signal), timeout, counter);
    if (!res) continue;
    addUsage(usage, res.usage);
    const asked = new Set(batch.map((b) => b.skuId));
    const seen = new Set<string>();
    for (const { sku_id, reason } of res.reasons) {
      const facts = factsById.get(sku_id);
      const target = byId.get(sku_id);
      if (!facts || !target || !asked.has(sku_id) || seen.has(sku_id)) continue;
      seen.add(sku_id);
      if (validateReason(reason, facts).ok) {
        target.text = reason.trim();
        target.source = "llm";
      }
    }
  }
  const explainDegraded = explanations.some((e) => e.source === "template");
  await options.onPhase?.("llm_explain", explainDegraded);

  const hl = await attempt((signal) => provider.headline(headlineFacts, signal), timeout, counter);
  if (hl) {
    addUsage(usage, hl.usage);
    if (validateHeadline(hl.headline, headlineFacts).ok) {
      headline.lines = [hl.headline[0].trim(), hl.headline[1].trim(), hl.headline[2].trim()];
      headline.source = "llm";
    }
  }
  await options.onPhase?.("llm_headline", headline.source === "template");

  const total = explanations.length + 1;
  const good = explanations.filter((e) => e.source === "llm").length + (headline.source === "llm" ? 1 : 0);
  const llmStatus: LlmStatus = good === total ? "ok" : good === 0 ? "failed" : "partial";
  return { explanations, headline, llmStatus, calls: counter.calls, usage };
}

