import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { baselineWeekly, outcomesMonthly, outcomesWeekly } from "@/db/schema";
import { WEEK_PATTERN } from "@/engine/weeks";
import { parseCsv, type RowIssue } from "@/ingest/parse";

export const weeklyEntrySchema = z.object({
  week: z.string().regex(WEEK_PATTERN, "Use an ISO week like 2026-W42"),
  stockoutIncidents: z.number().int().min(0).max(1_000_000),
  overstockValueInr: z.number().int().min(0).max(100_000_000_000),
});

export const monthlyEntrySchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11"),
  stockoutLossInr: z.number().int().min(0).max(100_000_000_000),
  writeoffInr: z.number().int().min(0).max(100_000_000_000),
  methodNote: z.string().trim().min(5, "Say how stockout loss and write-offs were calculated").max(500),
});

export async function upsertWeekly(db: Db, rows: z.infer<typeof weeklyEntrySchema>[], source: string, userId: string | null): Promise<{ saved: number }> {
  for (const r of rows) {
    await db
      .insert(outcomesWeekly)
      .values({ week: r.week, stockoutIncidents: r.stockoutIncidents, overstockValueInr: r.overstockValueInr, source, enteredBy: userId })
      .onConflictDoUpdate({ target: outcomesWeekly.week, set: { stockoutIncidents: sql`excluded.stockout_incidents`, overstockValueInr: sql`excluded.overstock_value_inr`, source: sql`excluded.source`, enteredBy: userId, enteredAt: new Date() } });
  }
  return { saved: rows.length };
}

export interface WeeklyUpload {
  saved: number;
  rejected: number;
  rejects: RowIssue[];
  fileError?: string;
}

/** Weekly outcomes from Priya's existing report, as CSV: Week, Stockout_Incidents, Overstock_Value_INR. */
export async function ingestWeeklyCsv(db: Db, fileName: string, text: string, userId: string | null): Promise<WeeklyUpload> {
  const parsed = parseCsv("outcomes_weekly", text);
  if (parsed.fileError) return { saved: 0, rejected: 0, rejects: [], fileError: parsed.fileError };
  const { saved } = await upsertWeekly(db, parsed.rows.map((r) => r.value), `Upload: ${fileName.slice(0, 120)}`, userId);
  return { saved, rejected: parsed.rejects.length, rejects: parsed.rejects.slice(0, 200) };
}

const normalise = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Months are compared in order: a method note that differs from the previous month's is flagged, never blocked. */
export function methodChanges(rows: readonly { period: string; methodNote: string }[]): { period: string; previous: string; note: string }[] {
  const sorted = [...rows].sort((a, b) => a.period.localeCompare(b.period));
  const out: { period: string; previous: string; note: string }[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1] as (typeof sorted)[number];
    const cur = sorted[i] as (typeof sorted)[number];
    if (normalise(prev.methodNote) !== normalise(cur.methodNote)) out.push({ period: cur.period, previous: prev.period, note: cur.methodNote });
  }
  return out;
}

export async function upsertMonthly(db: Db, entry: z.infer<typeof monthlyEntrySchema>, userId: string | null): Promise<{ methodChanged: { previous: string; previousNote: string } | null }> {
  const existing = await db.select().from(outcomesMonthly);
  const before = existing.filter((e) => e.period < entry.period).sort((a, b) => b.period.localeCompare(a.period))[0];
  await db
    .insert(outcomesMonthly)
    .values({ ...entry, enteredBy: userId })
    .onConflictDoUpdate({ target: outcomesMonthly.period, set: { stockoutLossInr: sql`excluded.stockout_loss_inr`, writeoffInr: sql`excluded.writeoff_inr`, methodNote: sql`excluded.method_note`, enteredBy: userId, enteredAt: new Date() } });
  const changed = before && normalise(before.methodNote) !== normalise(entry.methodNote);
  return { methodChanged: changed && before ? { previous: before.period, previousNote: before.methodNote } : null };
}

export async function loadOutcomes(db: Db) {
  const [weekly, monthly, frozen] = await Promise.all([
    db.select().from(outcomesWeekly).orderBy(desc(outcomesWeekly.week)).limit(60),
    db.select().from(outcomesMonthly).orderBy(desc(outcomesMonthly.period)).limit(36),
    db.select().from(baselineWeekly).orderBy(baselineWeekly.week),
  ]);
  return { weekly, monthly, frozen, methodChanges: methodChanges(monthly) };
}
