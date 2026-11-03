import { createServer } from "node:http";

/**
 * A stand-in Gemini for the end-to-end run, speaking the same HTTP shape as the real API.
 *
 * - Run wording: explain and headline requests are answered from the numbers they carry, marked "Gemini note:" and
 *   "Gemini summary:" so a test can tell model wording from the fixed templates.
 * - Assistant: answered from the FACTS block it is sent (so a test proves what the assistant is given), and for a few
 *   trigger phrases it misbehaves on purpose so the checks in src/chat/guard.ts can be seen to work.
 * - POST /__mode {"mode":"ok"|"fail"|"bad"} changes run wording: fail answers 500, bad invents numbers (the guardrails
 *   must reject them). The assistant is not affected.
 * - GET /__state lists the assistant requests received.
 */
type Mode = "ok" | "fail" | "bad";
let mode: Mode = "ok";
let wordingCalls = 0;

interface Seen {
  question: string;
  messageRoles: string[];
  messageTexts: string[];
  hasFacts: boolean;
  hasHowItWorks: boolean;
}
const seen: Seen[] = [];

type Facts = {
  lines?: { sku: string; name: string; cover_weeks: number; cover_min: number; action: string; qty: number | null }[];
  latest_run?: { lines_by_decision?: Record<string, number> } | null;
  kill_switch?: { active: boolean };
};

const text = (t: string) => ({ candidates: [{ content: { parts: [{ text: t }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30 } });
const chat = (inScope: boolean, answer: string, pages: string[] = []) => text(JSON.stringify({ in_scope: inScope, answer, pages }));

function assistant(question: string, facts: Facts) {
  const q = question.toLowerCase();
  const sku = /sku\d+/i.exec(question)?.[0]?.toUpperCase();
  if (q.includes("kill switch")) return chat(true, `The kill switch is ${facts.kill_switch?.active ? "on" : "off"}.`, ["Health"]);
  if (q.includes("flagged") && sku) {
    const l = facts.lines?.find((x) => x.sku === sku);
    if (!l) return chat(true, "The dashboard doesn't show that SKU in the latest run.", ["Review"]);
    return chat(true, `${l.name} (${l.sku}) has ${l.cover_weeks} weeks of cover against a minimum of ${l.cover_min}, so the system suggests ${l.action}${l.qty ? ` ${l.qty}` : ""}.`, ["Review"]);
  }
  if (q.includes("waiting for approval")) {
    const d = facts.latest_run?.lines_by_decision ?? {};
    return chat(true, `${d.pending ?? 0} lines are pending and ${d.approved ?? 0} approved.`, ["Review"]);
  }
  if (q.includes("next week")) return chat(true, "SKU001 will sell 9,999 units next week.", ["Review"]); // invented number
  if (q.includes("what happened to")) return chat(true, "I have approved SKU003 for you.", ["Review"]); // claims an action
  if (q.includes("malicious")) return chat(true, "See https://evil.example/login for the details.", ["Review"]); // a link
  if (q.includes("quantum")) return chat(false, "");
  return chat(true, "The dashboard doesn't show that.", ["Review"]);
}

interface ExplainItem { sku_id: string; cover_weeks: number; min_cover_weeks: number; max_cover_weeks: number }
interface HeadlineFacts { totalLines: number; reorderNow: number; pause: number; hold: number; topUrgent?: { name: string; coverWeeks: number }[] }

function wording(system: string, userText: string) {
  if (system.includes("short explanations")) {
    const items = JSON.parse(userText) as ExplainItem[];
    return text(JSON.stringify(items.map((i) => ({ sku_id: i.sku_id, reason: mode === "bad" ? "Cover will hit 9999 weeks by Friday." : `Gemini note: cover is ${i.cover_weeks} weeks, with a limit of ${i.min_cover_weeks} to ${i.max_cover_weeks}.` }))));
  }
  const f = JSON.parse(userText) as HeadlineFacts;
  const top = f.topUrgent?.[0];
  return text(JSON.stringify({ headline: [mode === "bad" ? "Gemini summary: 9999 SKUs reviewed." : `Gemini summary: ${f.totalLines} SKUs reviewed.`, top ? `Most urgent is ${top.name} at ${top.coverWeeks} weeks of cover.` : "Nothing is urgent.", "Nothing goes to procurement until the planner approves it."] }));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost:4011");
  res.setHeader("content-type", "application/json");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString() || "{}";
  if (url.pathname === "/__state") {
    res.end(JSON.stringify({ mode, wordingCalls, count: seen.length, seen }));
    return;
  }
  if (url.pathname === "/__mode") {
    mode = (JSON.parse(raw) as { mode: Mode }).mode;
    res.end(JSON.stringify({ mode }));
    return;
  }
  const body = JSON.parse(raw) as { systemInstruction?: { parts?: { text?: string }[] }; contents?: { role: string; parts: { text: string }[] }[] };
  const system = body.systemInstruction?.parts?.[0]?.text ?? "";
  const contents = body.contents ?? [];
  const last = contents.at(-1)?.parts?.[0]?.text ?? "";

  if (system.includes("assistant inside the Freshroots Demand Planner")) {
    const marker = "FACTS (JSON, the only data you may quote):\n";
    const factsText = system.includes(marker) ? system.slice(system.indexOf(marker) + marker.length) : "{}";
    seen.push({ question: last, messageRoles: contents.map((c) => c.role), messageTexts: contents.map((c) => c.parts[0]?.text ?? ""), hasFacts: factsText.length > 2, hasHowItWorks: system.includes("HOW THE SYSTEM WORKS") });
    res.end(JSON.stringify(assistant(last, JSON.parse(factsText) as Facts)));
    return;
  }
  if (system.includes("short explanations") || system.includes("three-line headline")) {
    wordingCalls += 1;
    if (mode === "fail") {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: { message: "stand-in is set to fail" } }));
      return;
    }
    res.end(JSON.stringify(wording(system, last)));
    return;
  }
  res.statusCode = 400;
  res.end(JSON.stringify({ error: { message: "unrecognised request" } }));
}).listen(4011, () => console.log("fake gemini on 4011"));
