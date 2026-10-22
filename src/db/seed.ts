import { readFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "./client";
import { ingestCsv, type IngestReport } from "@/ingest/ingest";
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
