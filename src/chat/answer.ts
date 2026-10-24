import { z } from "zod";
import type { ChatMessage, LlmProvider, LlmUsage } from "@/ai/types";
import { log } from "@/lib/log";
import { cleanPages, pageHint, REFUSALS, screenQuestion, validateAnswer, type Page } from "./guard";
import { CHAT_SYSTEM } from "./prompt";

export const MAX_HISTORY_TURNS = 6;
export const CHAT_TIMEOUT_MS = 25_000;

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export type AnswerKind = "answer" | "refusal" | "unverified" | "unavailable" | "error";

export interface ChatReply {
  kind: AnswerKind;
  answer: string;
  pages: Page[];
  usage?: LlmUsage;
}

const modelReply = z.object({ in_scope: z.boolean(), answer: z.string().default(""), pages: z.array(z.string()).default([]) });

function parseModelJson(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

/** Only well-formed earlier turns, the most recent few, each trimmed. Earlier answers are context, never trusted as facts. */
export function cleanHistory(history: unknown): Turn[] {
  if (!Array.isArray(history)) return [];
  const turns: Turn[] = [];
  for (const t of history) {
    if (!t || typeof t !== "object") continue;
    const { role, text } = t as { role?: unknown; text?: unknown };
    if ((role === "user" || role === "assistant") && typeof text === "string" && text.trim()) turns.push({ role, text: text.trim().slice(0, 600) });
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

export interface AnswerInput {
  provider: Pick<LlmProvider, "ask"> | null;
  facts: Record<string, unknown>;
  knowledge: string;
  question: unknown;
  history?: unknown;
  timeoutMs?: number;
}

/**
 * One question in, one checked reply out. Order of defences: screen the question in code, let the model answer from the
 * facts only, then verify the answer in code (plain text, no actions claimed, every number from the facts). A reply that
 * fails any step is replaced by a fixed message that points to the right page. Never throws.
 */
export async function answerQuestion(input: AnswerInput): Promise<ChatReply> {
  const screened = screenQuestion(input.question);
  if (!screened.ok) return { kind: "refusal", answer: screened.reply, pages: [] };
  const { question } = screened;
  const hint = pageHint(question);
  if (!input.provider?.ask) return { kind: "unavailable", answer: REFUSALS.unavailable, pages: [hint] };

  const system = `${CHAT_SYSTEM}\n\n${input.knowledge}\n\nFACTS (JSON, the only data you may quote):\n${JSON.stringify(input.facts)}`;
  const messages: ChatMessage[] = [...cleanHistory(input.history), { role: "user", text: question }];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("assistant timed out")), input.timeoutMs ?? CHAT_TIMEOUT_MS);
    try {
      const { text, usage } = await input.provider.ask(system, messages, controller.signal);
      const parsed = modelReply.safeParse(parseModelJson(text));
      if (!parsed.success) throw new Error("reply was not the expected JSON");
      if (!parsed.data.in_scope) return { kind: "refusal", answer: REFUSALS.scope, pages: [], usage };
      const check = validateAnswer(parsed.data.answer, input.facts, `${question}\n${input.knowledge}`);
      if (!check.ok) {
        log("warn", "chat.answer_rejected", { problems: check.problems, question: question.slice(0, 120) });
        return { kind: "unverified", answer: `${REFUSALS.unverified} The ${hint} page has this information.`, pages: [hint], usage };
      }
      const pages = cleanPages(parsed.data.pages);
      return { kind: "answer", answer: parsed.data.answer.trim(), pages: pages.length > 0 ? pages : [hint], usage };
    } catch (err) {
      log("warn", "chat.call_failed", { attempt, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
    } finally {
      clearTimeout(timer);
    }
  }
  return { kind: "error", answer: REFUSALS.busy, pages: [hint] };
}
