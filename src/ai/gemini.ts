import { z } from "zod";
import { buildExplainPayload, buildHeadlinePayload } from "./payload";
import { EXPLAIN_SYSTEM, HEADLINE_SYSTEM } from "./prompts";
import type { ExplainFacts, ExplainResponse, HeadlineFacts, HeadlineResponse, LlmProvider, LlmUsage } from "./types";

const reasonsSchema = z.array(z.object({ sku_id: z.string().min(1), reason: z.string().min(1) }));
const headlineSchema = z.object({ headline: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]) });
const responseSchema = z.object({
  candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).default([]) }).optional() })).min(1),
  usageMetadata: z.object({ promptTokenCount: z.number().default(0), candidatesTokenCount: z.number().default(0) }).optional(),
});

function parseJson(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

/** Gemini Flash through the Generative Language REST API, behind the same interface as every other provider. */
export class GeminiProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async complete(system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<{ text: string; usage: LlmUsage }> {
    const res = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Gemini returned ${res.status}`);
    const body = responseSchema.parse(await res.json());
    const text = (body.candidates[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return { text, usage: { inputTokens: body.usageMetadata?.promptTokenCount ?? 0, outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0 } };
  }

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
