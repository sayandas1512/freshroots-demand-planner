import { getEnv } from "@/config/env";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import type { LlmProvider } from "./types";

export const DEFAULT_MODELS = { anthropic: "claude-haiku-4-5-20251001", gemini: "gemini-2.5-flash" } as const;

export function configuredProvider(): "gemini" | "anthropic" | null {
  const env = getEnv();
  if (env.LLM_PROVIDER === "gemini") return env.GEMINI_API_KEY ? "gemini" : null;
  if (env.LLM_PROVIDER === "anthropic") return env.ANTHROPIC_API_KEY ? "anthropic" : null;
  return env.GEMINI_API_KEY ? "gemini" : env.ANTHROPIC_API_KEY ? "anthropic" : null;
}

/** Null when no key is configured: the run then uses template wording only (llm_status = skipped). */
export function createProvider(): LlmProvider | null {
  const env = getEnv();
  const kind = configuredProvider();
  if (kind === "gemini") return new GeminiProvider(env.GEMINI_API_KEY as string, env.LLM_MODEL ?? DEFAULT_MODELS.gemini);
  if (kind === "anthropic") return new AnthropicProvider(env.ANTHROPIC_API_KEY as string, env.LLM_MODEL ?? DEFAULT_MODELS.anthropic);
  return null;
}

export * from "./types";
export { generateNarrative } from "./generate";
