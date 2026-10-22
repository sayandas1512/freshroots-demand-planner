import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { explainFactsFor, headlineFactsFor } from "@/ai/facts";
import { generateNarrative } from "@/ai/generate";
import { AnthropicProvider } from "@/ai/anthropic";
import { EXPLAIN_SYSTEM, HEADLINE_SYSTEM, PROMPT_VERSION } from "@/ai/prompts";
import { evaluateAll } from "@/engine/evaluate";
import { GOLDEN_AS_OF } from "./golden-table";
import { config, fixtureEngineData } from "./helpers";

const data = fixtureEngineData(GOLDEN_AS_OF);
const result = evaluateAll(data, config());
const skus = new Map(data.skus.map((s) => [s.skuId, s]));
const flagged = result.lines.filter((l) => l.flags.length > 0).map((l) => explainFactsFor(l, skus.get(l.skuId)!));
const headlineFacts = headlineFactsFor(GOLDEN_AS_OF, result.lines, result.exceptions, skus, false);

interface Call {
  params: { model: string; system: string; messages: { role: string; content: string }[]; max_tokens: number };
  signal: AbortSignal | undefined;
}

function fakeClient(replies: (string | Error)[]): { client: Pick<Anthropic, "messages">; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const client = {
    messages: {
      create: async (params: Call["params"], options?: { signal?: AbortSignal }) => {
        calls.push({ params, signal: options?.signal });
        const reply = replies[Math.min(i, replies.length - 1)];
        i += 1;
        if (reply instanceof Error) throw reply;
        return { content: [{ type: "text", text: reply }], usage: { input_tokens: 1200, output_tokens: 300 } };
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  return { client, calls };
}

const reasonsFor = (ids: string[]) => JSON.stringify(ids.map((id) => ({ sku_id: id, reason: `Cover is ${flagged.find((f) => f.skuId === id)!.coverWeeks.toFixed(1)} weeks, so the rules fired.` })));

describe("AnthropicProvider", () => {
  it("sends only computed facts with the versioned system prompt, and returns validated output with usage", async () => {
    const { client, calls } = fakeClient([reasonsFor(flagged.map((f) => f.skuId))]);
    const p = new AnthropicProvider("sk-test", "model-x", client);
    const out = await p.explain(flagged, new AbortController().signal);
    expect(out.reasons).toHaveLength(flagged.length);
    expect(out.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
    const call = calls[0]!;
    expect(call.params.model).toBe("model-x");
    expect(call.params.system).toBe(EXPLAIN_SYSTEM);
    expect(EXPLAIN_SYSTEM).toMatch(/Do not recommend/);
    expect(EXPLAIN_SYSTEM).toMatch(/Do not add, derive or estimate any number/);
    expect(HEADLINE_SYSTEM).toMatch(/do not add, derive or estimate any number/i);
    expect(PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-v\d+$/);
    const sent = JSON.parse(call.params.messages[0]!.content) as Record<string, unknown>[];
    expect(Object.keys(sent[0]!).sort()).toEqual(
      ["action", "baseline_avg_units_per_week", "baseline_weeks", "category", "cover_weeks", "demand_per_week_used_for_cover", "festival", "flags", "high_demand_multiplier", "high_demand_ratio_threshold", "max_cover_weeks", "min_cover_weeks", "open_po_counted_as_stock", "open_po_qty", "perishable", "quantity", "recent_avg_units_per_week", "recent_to_baseline_ratio", "recent_weeks", "rule_fired", "sku_id", "sku_name", "standard_reorder_qty", "stock_on_hand", "uplift_percent", "urgent"].sort(),
    );
    expect(JSON.stringify(sent)).not.toMatch(/api|key|password/i);
    expect(call.signal).toBeDefined();
  });

  it("accepts JSON wrapped in a code fence", async () => {
    const ids = flagged.slice(0, 2).map((f) => f.skuId);
    const { client } = fakeClient([`\`\`\`json\n${reasonsFor(ids)}\n\`\`\``]);
    const out = await new AnthropicProvider("k", "m", client).explain(flagged.slice(0, 2), new AbortController().signal);
    expect(out.reasons.map((r) => r.sku_id)).toEqual(ids);
  });

  it("rejects prose, wrong shapes and a headline that is not exactly three lines", async () => {
    const signal = new AbortController().signal;
    await expect(new AnthropicProvider("k", "m", fakeClient(["Sure! Here are the reasons."]).client).explain(flagged, signal)).rejects.toThrow();
    await expect(new AnthropicProvider("k", "m", fakeClient(['{"reasons": []}']).client).explain(flagged, signal)).rejects.toThrow();
    await expect(new AnthropicProvider("k", "m", fakeClient(['{"headline": ["one", "two"]}']).client).headline(headlineFacts, signal)).rejects.toThrow();
    const ok = await new AnthropicProvider("k", "m", fakeClient(['{"headline": ["a", "b", "c"]}']).client).headline(headlineFacts, signal);
    expect(ok.headline).toEqual(["a", "b", "c"]);
  });

  it("falls back to templates end to end when the API errors, and uses the model's output when it is valid", async () => {
    const down = fakeClient([new Error("overloaded_error")]);
    const failed = await generateNarrative(new AnthropicProvider("k", "m", down.client), flagged, headlineFacts);
    expect(failed.llmStatus).toBe("failed");
    expect(failed.explanations.every((e) => e.source === "template")).toBe(true);
    expect(down.calls).toHaveLength(4);

    const good = fakeClient([reasonsFor(flagged.map((f) => f.skuId)), '{"headline": ["15 SKUs were reviewed.", "The lowest cover is on the urgent lines.", "Nothing goes to procurement until you approve it."]}']);
    const ok = await generateNarrative(new AnthropicProvider("k", "m", good.client), flagged, headlineFacts);
    expect(ok.llmStatus).toBe("ok");
    expect(ok.explanations.every((e) => e.source === "llm")).toBe(true);
    expect(ok.headline.source).toBe("llm");
    expect(ok.usage).toEqual({ inputTokens: 2400, outputTokens: 600 });
  });
});
