import { describe, expect, it } from "vitest";
import { explainFactsFor, headlineFactsFor } from "@/ai/facts";
import { generateNarrative, BATCH_SIZE } from "@/ai/generate";
import { conflictsWithAction, extractNumbers, validateHeadline, validateReason } from "@/ai/guardrails";
import { templateHeadline, templateReason } from "@/ai/templates";
import { costUsd } from "@/ai/status";
import type { ExplainFacts, HeadlineFacts, LlmProvider } from "@/ai/types";
import { evaluateAll } from "@/engine/evaluate";
import { GOLDEN_AS_OF } from "./golden-table";
import { config, fixtureEngineData } from "./helpers";

const data = fixtureEngineData(GOLDEN_AS_OF);
const result = evaluateAll(data, config());
const skuMap = new Map(data.skus.map((s) => [s.skuId, s]));
const flaggedFacts: ExplainFacts[] = result.lines.filter((l) => l.flags.length > 0).map((l) => explainFactsFor(l, skuMap.get(l.skuId)!));
const allFacts: ExplainFacts[] = result.lines.map((l) => explainFactsFor(l, skuMap.get(l.skuId)!));
const headlineFacts: HeadlineFacts = headlineFactsFor(GOLDEN_AS_OF, result.lines, result.exceptions, skuMap, false);
const factsFor = (id: string) => allFacts.find((f) => f.skuId === id)!;

describe("templates", () => {
  it("read as the brief's example for SKU001", () => {
    const text = templateReason(factsFor("SKU001"));
    expect(text).toContain("cover is only 3.4 weeks against a minimum of 6");
    expect(text).toContain("21% above the 12-week average");
    expect(text).toContain("750 units");
  });
  it("every template passes its own guardrails, for every line in the golden data", () => {
    for (const f of allFacts) expect(validateReason(templateReason(f), f), f.skuId).toEqual({ ok: true, problems: [] });
  });
  it("mention open POs and festival uplift when present", () => {
    const f = { ...factsFor("SKU003"), openPoQty: 250, festival: true, upliftPercent: 25 };
    const text = templateReason(f);
    expect(text).toContain("Open POs of 250 units are not counted as stock");
    expect(text).toContain("25% festival uplift");
    expect(validateReason(text, f).ok).toBe(true);
  });
  it("covers the perishable, overstock, pause and hold wording", () => {
    expect(templateReason(factsFor("SKU004"))).toContain("perishable minimum of 3");
    expect(templateReason(factsFor("SKU006"))).toContain("pause the next order");
    expect(templateReason(factsFor("SKU002"))).toContain("no action is needed");
  });
  it("headline reads well, has three lines and passes its guardrails", () => {
    const lines = templateHeadline(headlineFacts);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("15 SKUs reviewed for 19 Oct 2026");
    expect(lines[1]).toContain("Lowest cover");
    expect(lines[2]).toContain("Nothing goes to procurement until you approve it");
    expect(validateHeadline(lines, headlineFacts)).toEqual({ ok: true, problems: [] });
  });
  it("headline mentions exceptions and stale stock", () => {
    const lines = templateHeadline({ ...headlineFacts, exceptions: 2, exceptionTypes: { new_sku: 1, zero_demand: 1 }, staleInventory: true });
    expect(lines[2]).toContain("2 exceptions need your judgment (1 new SKU, 1 zero demand)");
    expect(lines[2]).toContain("stale");
  });
});

describe("guardrails", () => {
  const f = factsFor("SKU001");
  it("accepts the brief's example reason", () => {
    const reason = "Cover is 3.4 weeks against a minimum of 6, and the last 4 weeks ran 21% above the 12-week average.";
    expect(validateReason(reason, f)).toEqual({ ok: true, problems: [] });
  });
  it("rejects a number that is not in the facts", () => {
    const v = validateReason("Cover is 3.4 weeks against a minimum of 6, and demand grew 37% in the last 4 weeks.", f);
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("number 37 is not in the facts");
  });
  it("accepts numbers after rounding and thousands separators", () => {
    expect(validateReason("Stock of 900 units covers about 3 weeks.", f).ok).toBe(true);
    expect(validateReason("Reorder 1,500 units.", f).ok).toBe(false);
  });
  it("ignores digits that belong to the SKU name or code", () => {
    expect(validateReason("Freshroots Mango Drink 200ml has 3.4 weeks of cover.", f).ok).toBe(true);
  });
  it("rejects an action other than the computed one", () => {
    expect(validateReason("Cover is 3.4 weeks, so pause the next order.", f).ok).toBe(false);
    expect(validateReason("Cover is 22.2 weeks, so reorder now.", { ...factsFor("SKU006"), coverWeeks: 22.2 }).ok).toBe(false);
    expect(conflictsWithAction("No action needed.", "REORDER_NOW")).toBe(true);
    expect(conflictsWithAction("Pause the next order.", "PAUSE")).toBe(false);
    expect(conflictsWithAction("Reorder now.", "HOLD")).toBe(true);
  });
  it("rejects empty, rambling and multi-paragraph output", () => {
    expect(validateReason("  ", f).ok).toBe(false);
    expect(validateReason("Cover is 3.4 weeks. It is low. It is very low. It is awful.", f).ok).toBe(false);
    expect(validateReason(`Cover is 3.4 weeks. ${"x".repeat(500)}`, f).ok).toBe(false);
  });
  it("extracts numbers with commas and decimals", () => {
    expect(extractNumbers("1,200 units, 3.4 weeks and 21%")).toEqual([1200, 3.4, 21]);
  });
  it("rejects a headline with a wrong count or invented number", () => {
    expect(validateHeadline(["a", "b"], headlineFacts).ok).toBe(false);
    expect(validateHeadline(["99 SKUs", "b", "c"], headlineFacts).ok).toBe(false);
  });
});

function provider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    model: "test-model",
    explain: async (facts) => ({
      reasons: facts.map((x) => ({ sku_id: x.skuId, reason: `Cover is ${x.coverWeeks.toFixed(1)} weeks against a ${x.perishable ? "perishable " : ""}${x.action === "PAUSE" ? `maximum of ${x.coverMax}, so pause the next order.` : `minimum of ${x.coverMin}, so reorder.`}` })),
      usage: { inputTokens: 1000, outputTokens: 200 },
    }),
    headline: async () => ({ headline: ["15 SKUs were reviewed.", "Lowest cover is in the flagged lines.", "Nothing goes to procurement until you approve it."], usage: { inputTokens: 300, outputTokens: 60 } }),
    ...overrides,
  };
}

describe("generateNarrative", () => {
  it("uses LLM wording when it passes the guardrails, marks the source, and sums usage", async () => {
    const n = await generateNarrative(provider(), flaggedFacts, headlineFacts);
    expect(n.llmStatus).toBe("ok");
    expect(n.explanations.every((e) => e.source === "llm")).toBe(true);
    expect(n.headline.source).toBe("llm");
    expect(n.calls).toBe(2);
    expect(n.usage).toEqual({ inputTokens: 1300, outputTokens: 260 });
  });
  it("falls back to the template for any reason that fails validation (partial)", async () => {
    const p = provider({
      explain: async (facts) => ({
        reasons: facts.map((x, i) => ({ sku_id: x.skuId, reason: i === 0 ? "Demand is up 777% this quarter." : `Cover is ${x.coverWeeks.toFixed(1)} weeks, so ${x.action === "PAUSE" ? "pause the next order" : "reorder"}.` })),
        usage: { inputTokens: 10, outputTokens: 10 },
      }),
    });
    const n = await generateNarrative(p, flaggedFacts, headlineFacts);
    expect(n.llmStatus).toBe("partial");
    expect(n.explanations[0]?.source).toBe("template");
    expect(n.explanations[0]?.text).toBe(templateReason(flaggedFacts[0]!));
    expect(n.explanations[1]?.source).toBe("llm");
  });
  it("retries once, then falls back when the provider keeps failing (status failed)", async () => {
    let calls = 0;
    const failing = provider({
      explain: async () => { calls += 1; throw new Error("503"); },
      headline: async () => { calls += 1; throw new Error("503"); },
    });
    const n = await generateNarrative(failing, flaggedFacts, headlineFacts);
    expect(calls).toBe(4); // explain x2, headline x2
    expect(n.calls).toBe(4);
    expect(n.llmStatus).toBe("failed");
    expect(n.explanations.every((e) => e.source === "template")).toBe(true);
    expect(n.headline.source).toBe("template");
    expect(n.headline.lines).toEqual(templateHeadline(headlineFacts));
  });
  it("recovers when the retry succeeds", async () => {
    let tries = 0;
    const flaky = provider({
      explain: async (facts, signal) => {
        tries += 1;
        if (tries === 1) throw new Error("blip");
        return provider().explain(facts, signal);
      },
    });
    const n = await generateNarrative(flaky, flaggedFacts, headlineFacts);
    expect(n.llmStatus).toBe("ok");
    expect(n.calls).toBe(3);
  });
  it("times out a slow call and falls back", async () => {
    const slow = provider({
      explain: (_f, signal) => new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))),
    });
    const n = await generateNarrative(slow, flaggedFacts, headlineFacts, { callTimeoutMs: 20 });
    expect(n.explanations.every((e) => e.source === "template")).toBe(true);
    expect(n.headline.source).toBe("llm");
    expect(n.llmStatus).toBe("partial");
  });
  it("ignores unknown, duplicate and unasked sku ids in the response", async () => {
    const p = provider({
      explain: async (facts) => ({
        reasons: [{ sku_id: "NOPE", reason: "Cover is 3.4 weeks." }, ...facts.slice(0, 1).flatMap((x) => [{ sku_id: x.skuId, reason: `Cover is ${x.coverWeeks.toFixed(1)} weeks, reorder.` }, { sku_id: x.skuId, reason: "Cover is 1 weeks." }])],
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    });
    const n = await generateNarrative(p, flaggedFacts, headlineFacts);
    expect(n.explanations.filter((e) => e.source === "llm")).toHaveLength(1);
  });
  it("is skipped without a provider and still returns full template wording", async () => {
    const n = await generateNarrative(null, flaggedFacts, headlineFacts);
    expect(n.llmStatus).toBe("skipped");
    expect(n.calls).toBe(0);
    expect(n.explanations).toHaveLength(flaggedFacts.length);
  });
  it("batches 25 SKUs per call", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...flaggedFacts[0]!, skuId: `X${i}` }));
    const sizes: number[] = [];
    const p = provider({ explain: async (facts) => { sizes.push(facts.length); return { reasons: [], usage: { inputTokens: 0, outputTokens: 0 } }; } });
    await generateNarrative(p, many, headlineFacts);
    expect(BATCH_SIZE).toBe(25);
    expect(sizes).toEqual([25, 25, 10]);
  });
});

describe("cost", () => {
  it("prices tokens per million", () => {
    expect(costUsd({ inputTokens: 2_000_000, outputTokens: 1_000_000 }, { inPerMTok: 1, outPerMTok: 5 })).toBe(7);
  });
});
