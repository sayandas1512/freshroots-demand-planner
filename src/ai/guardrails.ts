import { round } from "@/engine/num";
import { parseDate } from "@/engine/weeks";
import type { Action } from "@/engine/types";
import type { ExplainFacts, HeadlineFacts } from "./types";

/**
 * Every number in LLM output must appear in the facts we supplied (after rounding), and the text must not
 * name a different action than the one the rules computed. Anything else falls back to the template.
 */

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

export function extractNumbers(text: string): number[] {
  return (text.match(NUMBER) ?? []).map((m) => Number(m.replaceAll(",", ""))).filter((n) => Number.isFinite(n));
}

function stripNames(text: string, names: readonly string[]): string {
  let out = text;
  for (const name of names) if (name) out = out.replaceAll(new RegExp(escapeRegExp(name), "gi"), " ");
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expand(values: readonly number[]): Set<number> {
  const out = new Set<number>();
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    out.add(v);
    for (const dp of [0, 1, 2]) out.add(round(v, dp));
    out.add(Math.floor(v));
  }
  return out;
}

export function allowedForExplain(f: ExplainFacts): Set<number> {
  const pctFromRatio = (f.ratio - 1) * 100;
  return expand([
    f.standardReorderQty,
    f.multiplier,
    f.baselineAvg,
    f.recentAvg,
    f.baselineWeeks,
    f.recentWeeks,
    f.ratio,
    f.ratio * 100,
    f.ratioThreshold,
    (f.ratioThreshold - 1) * 100,
    Math.abs(pctFromRatio),
    f.demandPerWeek,
    f.stockOnHand,
    f.openPoQty,
    f.coverWeeks,
    f.coverMin,
    f.coverMax,
    f.upliftPercent,
    ...(f.qty === null ? [] : [f.qty]),
  ]);
}

function dateParts(asOf: string): number[] {
  const d = parseDate(asOf);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

export function allowedForHeadline(f: HeadlineFacts): Set<number> {
  return expand([
    f.totalLines,
    f.reorderNow,
    f.reorder15x,
    f.pause,
    f.hold,
    f.urgent,
    f.exceptions,
    1.5,
    ...Object.values(f.exceptionTypes),
    ...f.topUrgent.flatMap((t) => [t.coverWeeks, ...(t.qty === null ? [] : [t.qty])]),
    ...dateParts(f.asOf),
  ]);
}

export interface Verdict {
  ok: boolean;
  problems: string[];
}

const MAX_REASON_CHARS = 420;
const MAX_SENTENCES = 3;

const REORDER_WORDS = /\b(re-?order|restock|replenish|buy more|place an order|order now|increase (?:the )?order)/i;
const PAUSE_WORDS = /\b(pause|hold off|do not order|don't order|skip (?:the )?(?:next )?order|stop ordering)/i;
const NO_ACTION_WORDS = /\b(no action|nothing to do|no change)/i;

/** Words that would contradict the computed action. */
export function conflictsWithAction(text: string, action: Action): boolean {
  switch (action) {
    case "REORDER_NOW":
    case "REORDER_1_5X":
      return PAUSE_WORDS.test(text) || NO_ACTION_WORDS.test(text);
    case "PAUSE":
      return REORDER_WORDS.test(text) || NO_ACTION_WORDS.test(text);
    case "HOLD":
      return REORDER_WORDS.test(text) || PAUSE_WORDS.test(text);
  }
}

function sentenceCount(text: string): number {
  return (text.match(/[.!?](?=\s|$)/g) ?? []).length || 1;
}

export function validateReason(reason: string, f: ExplainFacts): Verdict {
  const problems: string[] = [];
  const text = reason.trim();
  if (text.length === 0) problems.push("empty");
  if (text.length > MAX_REASON_CHARS) problems.push("too long");
  if (sentenceCount(text) > MAX_SENTENCES) problems.push("too many sentences");
  const allowed = allowedForExplain(f);
  const stripped = stripNames(text, [f.name, f.skuId]);
  for (const n of extractNumbers(stripped)) {
    if (![...allowed].some((a) => Math.abs(a - n) < 1e-9)) problems.push(`number ${n} is not in the facts`);
  }
  if (conflictsWithAction(text, f.action)) problems.push(`mentions an action other than ${f.action}`);
  return { ok: problems.length === 0, problems };
}

export function validateHeadline(lines: readonly string[], f: HeadlineFacts): Verdict {
  const problems: string[] = [];
  if (lines.length !== 3) problems.push("must be exactly three lines");
  const allowed = allowedForHeadline(f);
  const names = f.topUrgent.map((t) => t.name);
  for (const line of lines) {
    const text = line.trim();
    if (text.length === 0) problems.push("empty line");
    if (text.length > MAX_REASON_CHARS) problems.push("line too long");
    for (const n of extractNumbers(stripNames(text, names))) {
      if (![...allowed].some((a) => Math.abs(a - n) < 1e-9)) problems.push(`number ${n} is not in the facts`);
    }
  }
  return { ok: problems.length === 0, problems };
}
