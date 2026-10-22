export type LlmStatus = "ok" | "partial" | "failed" | "skipped";

export interface Pricing {
  inPerMTok: number;
  outPerMTok: number;
}

/** Cost in USD for the tokens used. Prices come from env so they can follow the provider's price list. */
export function costUsd(usage: { inputTokens: number; outputTokens: number }, pricing: Pricing): number {
  return (usage.inputTokens * pricing.inPerMTok + usage.outputTokens * pricing.outPerMTok) / 1_000_000;
}
