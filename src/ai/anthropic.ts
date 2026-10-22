import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { buildExplainPayload, buildHeadlinePayload } from "./payload";
import { EXPLAIN_SYSTEM, HEADLINE_SYSTEM } from "./prompts";
import type { ExplainFacts, ExplainResponse, HeadlineFacts, HeadlineResponse, LlmProvider, LlmUsage } from "./types";

const reasonsSchema = z.array(z.object({ sku_id: z.string().min(1), reason: z.string().min(1) }));
const headlineSchema = z.object({ headline: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]) });

/** Strip a ```json fence if the model added one, then parse. */
function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

export class AnthropicProvider implements LlmProvider {
  private readonly client: Pick<Anthropic, "messages">;

  constructor(
    apiKey: string,
    readonly model: string,
    client?: Pick<Anthropic, "messages">,
  ) {
    // Retries and the 10 s timeout are owned by src/ai/generate.ts so the budget is enforced in one place.
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 0 });
  }

  private async complete(system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<{ text: string; usage: LlmUsage }> {
    const res = await this.client.messages.create(
      { model: this.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] },
      { signal },
    );
    const text = res.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    return { text, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
  }

  /** Cheapest possible call, to show on Health that the key and model work. */
  async ping(signal: AbortSignal): Promise<void> {
    await this.complete("Reply with the single word ok.", "ping", 5, signal);
  }

  async explain(facts: ExplainFacts[], signal: AbortSignal): Promise<ExplainResponse> {
    const { text, usage } = await this.complete(EXPLAIN_SYSTEM, JSON.stringify(buildExplainPayload(facts)), 2000 + facts.length * 120, signal);
    return { reasons: reasonsSchema.parse(parseJson(text)), usage };
  }

  async headline(facts: HeadlineFacts, signal: AbortSignal): Promise<HeadlineResponse> {
    const { text, usage } = await this.complete(HEADLINE_SYSTEM, JSON.stringify(buildHeadlinePayload(facts)), 600, signal);
    return { headline: headlineSchema.parse(parseJson(text)).headline, usage };
  }
}
