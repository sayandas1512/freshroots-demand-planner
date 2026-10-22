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

export interface HeadlineResult {
  lines: [string, string, string];
  source: "llm" | "template";
}

export interface Narrative {
  explanations: Explanation[];
  headline: HeadlineResult;
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

export interface ExplainChunk {
  explanations: Explanation[];
  calls: number;
  usage: LlmUsage;
}

/**
 * Reasons for a chunk of flagged lines, 25 per LLM call. Every line starts with its template; the LLM only replaces
 * it when its output passes the guardrails. Never throws: any failure leaves the template in place.
 * The run machine calls this a few batches at a time so no single invocation has to do the whole sheet.
 */
export async function explainChunk(provider: LlmProvider | null, flagged: readonly ExplainFacts[], callTimeoutMs: number = CALL_TIMEOUT_MS): Promise<ExplainChunk> {
  const explanations: Explanation[] = flagged.map((f) => ({ skuId: f.skuId, text: templateReason(f), source: "template" }));
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  const counter = { calls: 0 };
  if (!provider) return { explanations, calls: 0, usage };

  const byId = new Map(explanations.map((e) => [e.skuId, e]));
  const factsById = new Map(flagged.map((f) => [f.skuId, f]));
  for (let i = 0; i < flagged.length; i += BATCH_SIZE) {
    const batch = flagged.slice(i, i + BATCH_SIZE);
    const res = await attempt((signal) => provider.explain([...batch], signal), callTimeoutMs, counter);
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
  return { explanations, calls: counter.calls, usage };
}

/** The three-line run headline, template first, LLM only when it passes the guardrails. Never throws. */
export async function headlineFor(provider: LlmProvider | null, facts: HeadlineFacts, callTimeoutMs: number = CALL_TIMEOUT_MS): Promise<HeadlineResult & { calls: number; usage: LlmUsage }> {
  const result: HeadlineResult = { lines: templateHeadline(facts), source: "template" };
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  const counter = { calls: 0 };
  if (!provider) return { ...result, calls: 0, usage };
  const hl = await attempt((signal) => provider.headline(facts, signal), callTimeoutMs, counter);
  if (hl) {
    addUsage(usage, hl.usage);
    if (validateHeadline(hl.headline, facts).ok) {
      result.lines = [hl.headline[0].trim(), hl.headline[1].trim(), hl.headline[2].trim()];
      result.source = "llm";
    }
  }
  return { ...result, calls: counter.calls, usage };
}

/** Overall status from how many pieces of wording (lines plus the headline) came from the LLM. */
export function llmStatusFor(good: number, total: number, hasProvider: boolean): LlmStatus {
  if (!hasProvider) return "skipped";
  return good === total ? "ok" : good === 0 ? "failed" : "partial";
}

/** Reasons for every flagged line and the headline in one go. Used by tests and the backtest-free paths. */
export async function generateNarrative(
  provider: LlmProvider | null,
  flagged: readonly ExplainFacts[],
  headlineFacts: HeadlineFacts,
  options: NarrativeOptions = {},
): Promise<Narrative> {
  const timeout = options.callTimeoutMs ?? CALL_TIMEOUT_MS;
  const explained = await explainChunk(provider, flagged, timeout);
  await options.onPhase?.("llm_explain", !provider || explained.explanations.some((e) => e.source === "template"));
  const headline = await headlineFor(provider, headlineFacts, timeout);
  await options.onPhase?.("llm_headline", !provider || headline.source === "template");

  const usage: LlmUsage = { inputTokens: explained.usage.inputTokens + headline.usage.inputTokens, outputTokens: explained.usage.outputTokens + headline.usage.outputTokens };
  const good = explained.explanations.filter((e) => e.source === "llm").length + (headline.source === "llm" ? 1 : 0);
  return {
    explanations: explained.explanations,
    headline: { lines: headline.lines, source: headline.source },
    llmStatus: llmStatusFor(good, explained.explanations.length + 1, provider !== null),
    calls: explained.calls + headline.calls,
    usage,
  };
}
