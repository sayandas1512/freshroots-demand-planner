import type { Action, Flag } from "@/engine/types";

/** Already-computed facts for one flagged line. This is everything the LLM is ever shown about a SKU. */
export interface ExplainFacts {
  skuId: string;
  name: string;
  category: string;
  perishable: boolean;
  flags: Flag[];
  ruleFired: string;
  action: Action;
  urgent: boolean;
  qty: number | null;
  standardReorderQty: number;
  multiplier: number;
  baselineAvg: number;
  recentAvg: number;
  baselineWeeks: number;
  recentWeeks: number;
  ratio: number;
  ratioThreshold: number;
  demandPerWeek: number;
  stockOnHand: number;
  openPoQty: number;
  openPoCounted: boolean;
  coverWeeks: number;
  coverMin: number;
  coverMax: number;
  festival: boolean;
  upliftPercent: number;
}

export interface HeadlineFacts {
  asOf: string;
  totalLines: number;
  reorderNow: number;
  reorder15x: number;
  pause: number;
  hold: number;
  urgent: number;
  exceptions: number;
  exceptionTypes: Record<string, number>;
  staleInventory: boolean;
  topUrgent: { name: string; action: Action; coverWeeks: number; qty: number | null }[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ExplainResponse {
  reasons: { sku_id: string; reason: string }[];
  usage: LlmUsage;
}

export interface HeadlineResponse {
  headline: [string, string, string];
  usage: LlmUsage;
}

/** The only surface the rest of the app sees. Swap the implementation to change provider. */
export interface LlmProvider {
  readonly model: string;
  explain(facts: ExplainFacts[], signal: AbortSignal): Promise<ExplainResponse>;
  headline(facts: HeadlineFacts, signal: AbortSignal): Promise<HeadlineResponse>;
  /** Multi-turn chat for the dashboard assistant. Returns the raw text; the caller parses and validates it. */
  ask?(system: string, messages: ChatMessage[], signal: AbortSignal): Promise<{ text: string; usage: LlmUsage }>;
  /** Optional liveness check used by the Health page. */
  ping?(signal: AbortSignal): Promise<void>;
}
