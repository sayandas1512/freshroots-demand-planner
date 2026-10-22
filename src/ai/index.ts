import { getEnv } from "@/config/env";
import { AnthropicProvider } from "./anthropic";
import type { LlmProvider } from "./types";

/** Null when no API key is configured: the run then uses template wording only (llm_status = skipped). */
export function createProvider(): LlmProvider | null {
  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) return null;
  return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.LLM_MODEL);
}

export * from "./types";
export { generateNarrative } from "./generate";
