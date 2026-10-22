import type { Db } from "@/db/client";
import { compareResults, evaluateAll, type LineChange } from "@/engine/evaluate";
import type { RuleConfig } from "@/engine/config";
import { todayIst } from "@/lib/dates";
import { getActiveConfig } from "./config-store";
import { loadEngineData } from "./load";
import { latestRun } from "./queries";

export interface ImpactPreview {
  asOf: string;
  totalSkus: number;
  changed: LineChange[];
  activeVersion: number;
}

/** Recompute the latest run date with a draft config and count the lines that would change. Nothing is saved. */
export async function previewImpact(db: Db, draft: RuleConfig): Promise<ImpactPreview> {
  const active = await getActiveConfig(db);
  const last = await latestRun(db);
  const asOf = last?.asOf ?? todayIst();
  const { data } = await loadEngineData(db, asOf, { includeOpenPos: true, includeDistributors: draft.enable_distributor_exceptions || active.config.enable_distributor_exceptions });
  const before = evaluateAll(data, active.config);
  const after = evaluateAll(data, draft);
  return { asOf, totalSkus: data.skus.length, changed: compareResults(before, after), activeVersion: active.version };
}
