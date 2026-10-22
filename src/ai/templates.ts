import { parseDate } from "@/engine/weeks";
import type { ExplainFacts, HeadlineFacts } from "./types";

/**
 * Template wording. These are the fallback when the LLM is unavailable or fails validation, so each one must read
 * well on its own and stay inside the guardrails (tests/ai.test.ts checks every template against them).
 */

const n1 = (v: number): string => v.toFixed(1);
const int = (v: number): string => Math.round(v).toLocaleString("en-IN");
const pctAbs = (ratio: number): number => Math.round(Math.abs(ratio - 1) * 100);

function trend(f: ExplainFacts): string {
  const pct = pctAbs(f.ratio);
  if (pct === 0) return `the last ${f.recentWeeks} weeks matched the ${f.baselineWeeks}-week average`;
  return `the last ${f.recentWeeks} weeks ran ${pct}% ${f.ratio > 1 ? "above" : "below"} the ${f.baselineWeeks}-week average`;
}

function festivalNote(f: ExplainFacts): string {
  return f.festival && f.upliftPercent > 0 ? `, counting a ${f.upliftPercent}% festival uplift on demand` : "";
}

function openPoSentence(f: ExplainFacts): string {
  if (f.openPoQty <= 0) return "";
  return f.openPoCounted
    ? ` Open POs of ${int(f.openPoQty)} units are counted as stock.`
    : ` Open POs of ${int(f.openPoQty)} units are not counted as stock.`;
}

export function templateReason(f: ExplainFacts): string {
  const kind = f.perishable ? "perishable " : "";
  const stock = `${int(f.stockOnHand)} units on hand`;
  const po = openPoSentence(f);

  if (f.ruleFired.startsWith("high_demand+stockout_risk")) {
    return `Urgent: ${trend(f)} and cover is only ${n1(f.coverWeeks)} weeks against a ${kind}minimum of ${f.coverMin}${festivalNote(f)}, so reorder ${f.multiplier}x the standard quantity, ${int(f.qty ?? 0)} units.${po}`;
  }
  if (f.ruleFired === "high_demand") {
    return `${trend(f).replace(/^t/, "T")} (ratio ${f.ratio.toFixed(2)} against a trigger of ${f.ratioThreshold}), so reorder ${f.multiplier}x the standard quantity, ${int(f.qty ?? 0)} units.${po}`;
  }
  if (f.ruleFired.startsWith("stockout_risk")) {
    return `Cover is ${n1(f.coverWeeks)} weeks against a ${kind}minimum of ${f.coverMin}, with ${stock}${festivalNote(f)}, so reorder the standard ${int(f.qty ?? f.standardReorderQty)} units now.${po}`;
  }
  if (f.ruleFired.startsWith("overstock_risk")) {
    return `Cover is ${n1(f.coverWeeks)} weeks against a ${kind}maximum of ${f.coverMax}, with ${stock}${festivalNote(f)}, so pause the next order.${po}`;
  }
  return `Cover is ${n1(f.coverWeeks)} weeks, inside the ${kind}${f.coverMin} to ${f.coverMax} week window, and ${trend(f)}, so no action is needed.${po}`;
}

const EXCEPTION_LABEL: Record<string, string> = {
  new_sku: "new SKU",
  short_history: "short history",
  missing_stock: "missing stock",
  zero_demand: "zero demand",
  anomalous_jump: "anomalous jump",
  unknown_sku: "unknown SKU",
  conflicting_signals: "conflicting signals",
  processing_error: "processing error",
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function longDate(asOf: string): string {
  return parseDate(asOf).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function templateHeadline(f: HeadlineFacts): [string, string, string] {
  const line1 = `${f.totalLines} ${plural(f.totalLines, "SKU", "SKUs")} reviewed for ${longDate(f.asOf)}: ${f.reorderNow} to reorder now, ${f.reorder15x} high-demand at 1.5x, ${f.pause} to pause, ${f.hold} to hold.`;

  let line2: string;
  if (f.topUrgent.length === 0) {
    line2 = "No SKU is below its minimum cover or running hot, so nothing needs reordering this run.";
  } else {
    const names = f.topUrgent.map((t) => `${t.name} (${n1(t.coverWeeks)} weeks of cover)`).join(", ");
    line2 = f.urgent > 0 ? `${f.urgent} urgent ${plural(f.urgent, "line", "lines")}. Lowest cover: ${names}.` : `Lowest cover: ${names}.`;
  }

  const types = Object.entries(f.exceptionTypes)
    .map(([type, count]) => `${count} ${EXCEPTION_LABEL[type] ?? type}`)
    .join(", ");
  const exceptionPart = f.exceptions === 0 ? "No exceptions need your judgment." : `${f.exceptions} ${plural(f.exceptions, "exception needs", "exceptions need")} your judgment (${types}).`;
  const stalePart = f.staleInventory ? " Stock data is stale, so treat cover figures with care." : "";
  const line3 = `${exceptionPart}${stalePart} Nothing goes to procurement until you approve it.`;

  return [line1, line2, line3];
}
