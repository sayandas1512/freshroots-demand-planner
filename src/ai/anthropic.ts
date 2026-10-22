import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { EXPLAIN_SYSTEM, HEADLINE_SYSTEM } from "./prompts";
import type { ExplainFacts, ExplainResponse, HeadlineFacts, HeadlineResponse, LlmProvider, LlmUsage } from "./types";

const reasonsSchema = z.array(z.object({ sku_id: z.string().min(1), reason: z.string().min(1) }));
const headlineSchema = z.object({ headline: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]) });

/** Strip a ```json fence if the model added one, then parse. */
function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

function wireFacts(f: ExplainFacts) {
  return {
    sku_id: f.skuId,
    sku_name: f.name,
    category: f.category,
    perishable: f.perishable,
    flags: f.flags,
    rule_fired: f.ruleFired,
    action: f.action,
    urgent: f.urgent,
    quantity: f.qty,
    standard_reorder_qty: f.standardReorderQty,
    high_demand_multiplier: f.multiplier,
    baseline_weeks: f.baselineWeeks,
    baseline_avg_units_per_week: f.baselineAvg,
    recent_weeks: f.recentWeeks,
    recent_avg_units_per_week: f.recentAvg,
    recent_to_baseline_ratio: f.ratio,
    high_demand_ratio_threshold: f.ratioThreshold,
    demand_per_week_used_for_cover: f.demandPerWeek,
    stock_on_hand: f.stockOnHand,
    open_po_qty: f.openPoQty,
    open_po_counted_as_stock: f.openPoCounted,
    cover_weeks: f.coverWeeks,
    min_cover_weeks: f.coverMin,
    max_cover_weeks: f.coverMax,
    festival: f.festival,
    uplift_percent: f.upliftPercent,
  };
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

  async explain(facts: ExplainFacts[], signal: AbortSignal): Promise<ExplainResponse> {
    const { text, usage } = await this.complete(EXPLAIN_SYSTEM, JSON.stringify(facts.map(wireFacts)), 2000 + facts.length * 120, signal);
    return { reasons: reasonsSchema.parse(parseJson(text)), usage };
  }

  async headline(facts: HeadlineFacts, signal: AbortSignal): Promise<HeadlineResponse> {
    const { text, usage } = await this.complete(HEADLINE_SYSTEM, JSON.stringify(facts), 600, signal);
    return { headline: headlineSchema.parse(parseJson(text)).headline, usage };
  }
}
