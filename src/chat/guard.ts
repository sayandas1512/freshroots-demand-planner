import { round } from "@/engine/num";
import { extractNumbers } from "@/ai/guardrails";

/**
 * Guardrails for the dashboard assistant. Everything here is plain code, so it can be tested without a model:
 * what may be asked (screenQuestion) and what may be said (validateAnswer).
 */

export const PAGES = ["Review", "Settings", "Data", "Outcomes", "Zoho", "Health", "Backtest", "Compare", "Export"] as const;
export type Page = (typeof PAGES)[number];

export const MAX_QUESTION_CHARS = 500;
export const MAX_ANSWER_CHARS = 1200;

export const REFUSALS = {
  empty: "Ask me a question about the dashboard, for example why a SKU was flagged.",
  tooLong: `Please keep the question under ${MAX_QUESTION_CHARS} characters.`,
  scope: "I can only answer questions about this dashboard: the latest run, its recommendations and reasons, exceptions, the kill switch, outcomes, Zoho and the settings.",
  injection: "I can only answer questions about this dashboard, and I can't change how I work or share my instructions.",
  action: "I'm read-only: I can't approve, edit, run, export, stop or change anything. Use the controls on the page for that. I can explain what the dashboard shows, though.",
  unverified: "I couldn't check that answer against the dashboard, so I won't give it.",
  unavailable: "The assistant isn't switched on for this deployment (no language-model key is set).",
  busy: "The assistant is busy or unreachable right now. The dashboard pages have the same information.",
  rate: "You're asking quickly. Please wait a moment and try again.",
} as const;

export type ScreenResult = { ok: true; question: string } | { ok: false; reply: string; reason: "empty" | "too_long" | "injection" | "action" | "scope" };

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const INJECTION = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b.{0,30}\b(instructions?|rules?|prompt|guardrails?|restrictions?|guidelines?)\b/i,
  /\b(reveal|show|print|repeat|display|leak|tell me|what (is|are))\b.{0,40}\b(system prompt|your prompt|your instructions|hidden (prompt|instructions)|initial instructions)\b/i,
  /\b(you are now|from now on you|act as|pretend (to be|you)|role-?play|jailbreak|developer mode|do anything now|dan mode)\b/i,
  /<\s*\/?\s*(system|assistant|instructions?)\s*>/i,
  /\[\s*(system|inst)\s*\]/i,
];

const ACTION_VERBS = "approve|reject|edit|change|update|delete|remove|run|start|trigger|export|send|push|create|stop|clear|trip|restart|upload|override|enable|disable|switch|turn|set|reset|mark|add|save";
const ACTION = [
  new RegExp(`^\\s*(please\\s+)?(${ACTION_VERBS})\\b`, "i"),
  new RegExp(`\\b(can|could|would|will|should) you (please )?(go ahead and )?(${ACTION_VERBS})\\b`, "i"),
  /\b(go ahead and|i want you to|i need you to|i'?d like you to|do it for me|do that for me)\b/i,
];

const OFF_TOPIC = [
  /\b(write|generate|compose|draft|make|give me)\b.{0,30}\b(code|script|program|poem|story|essay|joke|song|sql|query|regex|cover letter|tweet|lyrics)\b/i,
  /\b(weather|bitcoin|crypto|election|recipe|football|cricket|movie|horoscope|lottery|translate)\b/i,
  /\b(who is|who was|capital of|president of|prime minister)\b/i,
];

/** Cheap checks that run before any model call. Anything that passes still has to be in scope according to the model. */
export function screenQuestion(raw: unknown): ScreenResult {
  if (typeof raw !== "string") return { ok: false, reply: REFUSALS.empty, reason: "empty" };
  const question = raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!question) return { ok: false, reply: REFUSALS.empty, reason: "empty" };
  if (question.length > MAX_QUESTION_CHARS) return { ok: false, reply: REFUSALS.tooLong, reason: "too_long" };
  if (INJECTION.some((p) => p.test(question))) return { ok: false, reply: REFUSALS.injection, reason: "injection" };
  if (ACTION.some((p) => p.test(question))) return { ok: false, reply: REFUSALS.action, reason: "action" };
  if (OFF_TOPIC.some((p) => p.test(question))) return { ok: false, reply: REFUSALS.scope, reason: "scope" };
  return { ok: true, question };
}

/** The page a question most likely belongs on, used when an answer cannot be given. */
export function pageHint(question: string): Page {
  const q = question.toLowerCase();
  if (/kill|stop|breach|criteri|rubber|override rate/.test(q)) return "Health";
  if (/zoho|vendor|draft po|purchase order/.test(q)) return "Zoho";
  if (/export|csv|distributor_id/.test(q)) return "Export";
  if (/outcome|baseline|measure|incident|overstock value/.test(q)) return "Outcomes";
  if (/setting|threshold|rule value|version|ratio|cover min|cover max/.test(q)) return "Settings";
  if (/upload|file|stale|stock snapshot|sales data/.test(q)) return "Data";
  if (/backtest|replay/.test(q)) return "Backtest";
  if (/compare|raghav's own/.test(q)) return "Compare";
  return "Review";
}

function expand(values: Iterable<number>): Set<number> {
  const out = new Set<number>();
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    out.add(v);
    for (const dp of [0, 1, 2]) out.add(round(v, dp));
    out.add(Math.floor(v));
    out.add(Math.abs(v));
    // ratios and fractions are quoted as percentages ("21% above", "0.5 as 50%")
    if (Math.abs(v) <= 5) {
      for (const dp of [0, 1]) {
        out.add(round(v * 100, dp));
        out.add(round(Math.abs(v - 1) * 100, dp));
      }
    }
  }
  return out;
}

/** Every number found anywhere in the facts, in the question, plus the rounded and percentage forms of each. */
export function allowedNumbers(facts: unknown, question: string): Set<number> {
  const nums: number[] = [...extractNumbers(question)];
  const walk = (node: unknown): void => {
    if (typeof node === "number") nums.push(node);
    else if (typeof node === "string") nums.push(...extractNumbers(node));
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(facts);
  return expand(nums);
}

export interface Validation {
  ok: boolean;
  problems: string[];
}

/** An answer is shown only if it is plain text, stays inside the dashboard, claims no action and uses only supplied numbers. */
export function validateAnswer(answer: string, facts: unknown, question: string): Validation {
  const problems: string[] = [];
  const text = answer.trim();
  if (!text) problems.push("empty");
  if (text.length > MAX_ANSWER_CHARS) problems.push("too long");
  if (/https?:\/\/|www\./i.test(text)) problems.push("contains a link");
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) problems.push("contains an email address");
  if (/```|<\/?[a-z][^>]*>/i.test(text)) problems.push("contains code or markup");
  if (/system prompt|my instructions|as an ai\b|language model|i am programmed/i.test(text)) problems.push("talks about its own instructions");
  if (/\bi(?:'ve| have)?\s+(approved|rejected|edited|ran|run|stopped|cleared|exported|changed|updated|sent|created|pushed)\b/i.test(text)) problems.push("claims to have acted");
  const allowed = allowedNumbers(facts, question);
  const stray = extractNumbers(text).filter((n) => !allowed.has(n) && !allowed.has(round(n, 1)) && !allowed.has(round(n, 0)));
  if (stray.length > 0) problems.push(`numbers not in the facts: ${[...new Set(stray)].slice(0, 5).join(", ")}`);
  return { ok: problems.length === 0, problems };
}

export function cleanPages(pages: unknown): Page[] {
  if (!Array.isArray(pages)) return [];
  return [...new Set(pages.filter((p): p is Page => typeof p === "string" && (PAGES as readonly string[]).includes(p)))].slice(0, 3);
}
