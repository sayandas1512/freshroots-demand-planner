import { readFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "./client";
import { ingestCsv, type IngestReport } from "@/ingest/ingest";
import { ingestWeeklyCsv } from "@/outcomes/store";
import { startMeasurement } from "@/run/measurement";
import type { IngestKind } from "@/ingest/mapping";

const FIXTURE_FILES: [IngestKind, string][] = [
  ["distributors", "distributors.csv"],
  ["sku_master", "sku_master.csv"],
  ["festival_calendar", "festival_calendar.csv"],
  ["sales", "sales.csv"],
  ["inventory", "inventory.csv"],
];

/** Load the five sample files from /fixtures through the normal ingestion layer. */
export async function loadFixtures(db: Db, dir: string = path.join(process.cwd(), "fixtures")): Promise<IngestReport[]> {
  const reports: IngestReport[] = [];
  for (const [kind, file] of FIXTURE_FILES) {
    reports.push(await ingestCsv(db, kind, file, readFileSync(path.join(dir, file), "utf8")));
  }
  return reports;
}

/**
 * Sample outcomes so the kill check can be tried out: eight baseline weeks (2026-W34 to W41) and measurement starting on
 * 2026-10-12, the Monday of W42. Separate from `loadFixtures` because it is demonstration data, not an SAP file.
 */
export async function loadDemoOutcomes(db: Db, dir: string = path.join(process.cwd(), "fixtures")): Promise<{ weeks: number; frozenWeeks: number }> {
  const report = await ingestWeeklyCsv(db, "weekly_outcomes_sample.csv", readFileSync(path.join(dir, "weekly_outcomes_sample.csv"), "utf8"), null);
  const { frozenWeeks } = await startMeasurement(db, { startDate: "2026-10-12", userId: null });
  return { weeks: report.saved, frozenWeeks };
}
