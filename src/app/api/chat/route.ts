import { NextResponse } from "next/server";
import { createProvider } from "@/ai";
import { isResponse, requirePermission } from "@/auth/actor";
import { answerQuestion } from "@/chat/answer";
import { buildChatContext } from "@/chat/facts";
import { REFUSALS } from "@/chat/guard";
import { getDb } from "@/db/client";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/ratelimit";
import { clientRateKey } from "@/lib/ratelimit-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 8_000;

/**
 * The dashboard assistant. Read-only: it builds a facts packet from the database and answers from that alone.
 * Questions are screened and answers verified in code (see src/chat/guard.ts); the model never sees raw tables and
 * has no tools, so it cannot change anything.
 */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "view");
  if (isResponse(actor)) return actor;
  const limit = rateLimit(clientRateKey("chat", request.headers), 12, 60_000);
  if (!limit.ok) return NextResponse.json({ kind: "refusal", answer: REFUSALS.rate, pages: [] }, { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ kind: "refusal", answer: REFUSALS.tooLong, pages: [] }, { status: 413 });
  let body: { question?: unknown; history?: unknown } = {};
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: "Send JSON with a question." }, { status: 400 });
  }

  const provider = createProvider();
  const db = await getDb();
  const { facts, knowledge } = await buildChatContext(db);
  const reply = await answerQuestion({ provider, facts, knowledge, question: body.question, history: body.history });
  log("info", "chat", { kind: reply.kind, by: actor.userId ?? "guest", q: typeof body.question === "string" ? body.question.slice(0, 160) : null, tokens_in: reply.usage?.inputTokens, tokens_out: reply.usage?.outputTokens });
  return NextResponse.json({ kind: reply.kind, answer: reply.answer, pages: reply.pages });
}
