import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explainFactsFor, headlineFactsFor } from "@/ai/facts";
import { GeminiProvider } from "@/ai/gemini";
import { generateNarrative } from "@/ai/generate";
import { createProvider, configuredProvider } from "@/ai";
import { EXPLAIN_FIELDS, HEADLINE_FIELDS, PayloadViolation, assertAllowed, buildExplainPayload, buildHeadlinePayload } from "@/ai/payload";
import type { ExplainFacts } from "@/ai/types";
import type { Db } from "@/db/client";
import { loadFixtures } from "@/db/seed";
import { evaluateAll } from "@/engine/evaluate";
import { startAndExecute } from "@/run/execute";
import { systemHealth } from "@/run/healthcheck";
import { tripKill } from "@/kill/state";
import { GOLDEN_AS_OF } from "./golden-table";
import { config, fixtureEngineData } from "./helpers";
import { createTestDb } from "./db";

const data = fixtureEngineData(GOLDEN_AS_OF);
const result = evaluateAll(data, config());
const skus = new Map(data.skus.map((s) => [s.skuId, s]));
const facts: ExplainFacts[] = result.lines.filter((l) => l.flags.length > 0).map((l) => explainFactsFor(l, skus.get(l.skuId)!));
const headlineFacts = headlineFactsFor(GOLDEN_AS_OF, result.lines, result.exceptions, skus, false);

describe("what may go to the LLM (allow-list)", () => {
  it("builds payloads whose keys are exactly the allow-list, for every flagged line", () => {
    const payload = buildExplainPayload(facts);
    expect(payload).toHaveLength(facts.length);
    for (const p of payload) expect(Object.keys(p).sort()).toEqual([...EXPLAIN_FIELDS].sort());
    expect(Object.keys(buildHeadlinePayload(headlineFacts)).sort()).toEqual([...HEADLINE_FIELDS].sort());
  });

  it("cannot be made to carry extra fields, user free text or distributor names", () => {
    const dirty = { ...facts[0]!, distributorName: "Sahyadri Agencies", overrideNote: "Raghav said call Suresh", distributorId: "D001" } as unknown as ExplainFacts;
    const json = JSON.stringify(buildExplainPayload([dirty]));
    expect(json).not.toMatch(/Sahyadri|Suresh|D001|overrideNote|distributor/i);
    expect(() => assertAllowed("explain", [{ ...buildExplainPayload([facts[0]!])[0], distributor_name: "x" }])).toThrow(PayloadViolation);
    expect(() => assertAllowed("explain", [{ ...buildExplainPayload([facts[0]!])[0], category: "line one\nline two" }])).toThrow(/single-line/);
    expect(() => assertAllowed("explain", [{ ...buildExplainPayload([facts[0]!])[0], sku_name: "x".repeat(500) }])).toThrow(/short single-line/);
    expect(() => assertAllowed("headline", { ...buildHeadlinePayload(headlineFacts), note: "hi" })).toThrow(PayloadViolation);
    expect(() => assertAllowed("headline", { ...buildHeadlinePayload(headlineFacts), topUrgent: [{ name: "a", comment: "b" }] })).toThrow(PayloadViolation);
  });

  it("a violation fails the call, so the run falls back to templates instead of sending anything", async () => {
    const bad = { ...facts[0]!, name: "x".repeat(500) } as ExplainFacts;
    const provider = new GeminiProvider("k", "m", (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch);
    const n = await generateNarrative(provider, [bad], headlineFacts);
    expect(n.explanations[0]?.source).toBe("template");
  });
});

describe("Gemini provider", () => {
  const reply = (text: string, usage = { promptTokenCount: 800, candidatesTokenCount: 120 }) => async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: usage }), { status: 200 });

  it("sends the key in a header, the allow-listed payload, and JSON mode; returns validated output with usage", async () => {
    const ids = facts.slice(0, 2).map((f) => f.skuId);
    const fetchMock = vi.fn(reply(JSON.stringify(ids.map((id) => ({ sku_id: id, reason: "Cover is low." })))));
    const p = new GeminiProvider("key-123", "gemini-test", fetchMock as unknown as typeof fetch);
    const out = await p.explain(facts.slice(0, 2), new AbortController().signal);
    expect(out.reasons.map((r) => r.sku_id)).toEqual(ids);
    expect(out.usage).toEqual({ inputTokens: 800, outputTokens: 120 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toContain("/models/gemini-test:generateContent");
    expect(url).not.toContain("key-123");
    expect(init.headers["x-goog-api-key"]).toBe("key-123");
    const body = JSON.parse(init.body) as { contents: { parts: { text: string }[] }[]; generationConfig: { responseMimeType: string } };
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(Object.keys((JSON.parse(body.contents[0]!.parts[0]!.text) as Record<string, unknown>[])[0]!).sort()).toEqual([...EXPLAIN_FIELDS].sort());
  });

  it("accepts fenced JSON, rejects prose, bad headlines and HTTP errors", async () => {
    const signal = new AbortController().signal;
    expect((await new GeminiProvider("k", "m", reply('```json\n{"headline":["a","b","c"]}\n```') as unknown as typeof fetch).headline(headlineFacts, signal)).headline).toEqual(["a", "b", "c"]);
    await expect(new GeminiProvider("k", "m", reply("Sure thing!") as unknown as typeof fetch).explain(facts, signal)).rejects.toThrow();
    await expect(new GeminiProvider("k", "m", reply('{"headline":["a"]}') as unknown as typeof fetch).headline(headlineFacts, signal)).rejects.toThrow();
    await expect(new GeminiProvider("k", "m", (async () => new Response("no", { status: 429 })) as unknown as typeof fetch).explain(facts, signal)).rejects.toThrow(/429/);
  });

  it("an API failure falls back to the template wording end to end", async () => {
    const down = new GeminiProvider("k", "m", (async () => new Response("err", { status: 503 })) as unknown as typeof fetch);
    const n = await generateNarrative(down, facts, headlineFacts);
    expect(n.llmStatus).toBe("failed");
    expect(n.explanations.every((e) => e.source === "template")).toBe(true);
  });
});

describe("provider selection", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("prefers Gemini, honours LLM_PROVIDER, and is null without a key", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("LLM_PROVIDER", "");
    expect(configuredProvider()).toBeNull();
    expect(createProvider()).toBeNull();
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    expect(configuredProvider()).toBe("anthropic");
    vi.stubEnv("GEMINI_API_KEY", "g");
    expect(configuredProvider()).toBe("gemini");
    expect(createProvider()?.model).toBe("gemini-2.5-flash");
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    expect(createProvider()?.model).toBe("claude-haiku-4-5-20251001");
    vi.stubEnv("LLM_MODEL", "custom-model");
    expect(createProvider()?.model).toBe("custom-model");
    vi.stubEnv("LLM_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(configuredProvider()).toBeNull();
  });
});

describe("system health", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await loadFixtures(db);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await close();
  });

  it("reports ok when everything is fresh, degraded when stock is stale, and stopped when the kill switch is on", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await startAndExecute(db, { trigger: "manual", asOf: GOLDEN_AS_OF }, { provider: null });
    const fresh = await systemHealth(db, { pingLlm: false, now: new Date("2026-10-20T04:00:00Z") });
    expect(fresh).toMatchObject({ overall: "ok", db: { ok: true }, mode: "shadow", kill: { active: false }, llm: { provider: null, reachable: null } });
    expect(fresh.lastRun).toMatchObject({ status: "completed", asOf: GOLDEN_AS_OF });
    expect(fresh.files).toMatchObject({ latestSalesWeek: "2026-W42", latestInventoryDate: "2026-10-19", inventoryAgeDays: 1, inventoryStale: false });

    expect((await systemHealth(db, { pingLlm: false, now: new Date("2026-11-15T04:00:00Z") })).overall).toBe("degraded");
    await tripKill(db, { kind: "trip_manual", reason: "Drill", label: "t" });
    const stopped = await systemHealth(db, { pingLlm: false, now: new Date("2026-10-20T04:00:00Z") });
    expect(stopped).toMatchObject({ overall: "stopped", kill: { active: true, reason: "Drill" } });
  });

  it("pings the LLM only when asked, and reports an unreachable provider as degraded", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    const calls = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", calls);
    const quiet = await systemHealth(db, { pingLlm: false, now: new Date("2026-10-20T04:00:00Z") });
    expect(calls).not.toHaveBeenCalled();
    expect(quiet.llm).toMatchObject({ provider: "gemini", reachable: null });
    const pinged = await systemHealth(db, { pingLlm: true, now: new Date("2026-10-20T04:00:00Z") });
    expect(pinged.llm.reachable).toBe(false);
    expect(pinged.llm.error).toMatch(/500/);
    expect(pinged.overall).toBe("degraded");
    vi.unstubAllGlobals();
  });
});
