import { z } from "zod";

export const FESTIVAL_UPLIFT_MODES = ["cover_demand", "both_windows", "baseline_only"] as const;
export type FestivalUpliftMode = (typeof FESTIVAL_UPLIFT_MODES)[number];

export const ruleConfigSchema = z
  .object({
    recent_weeks: z.number().int().min(1).max(26),
    baseline_weeks: z.number().int().min(2).max(52),
    high_demand_ratio: z.number().gt(1).max(5),
    high_demand_multiplier: z.number().gt(0).max(10),
    cover_min_weeks: z.number().gt(0).max(52),
    cover_max_weeks: z.number().gt(0).max(104),
    perishable_min_weeks: z.number().gt(0).max(52),
    perishable_max_weeks: z.number().gt(0).max(104),
    festival_uplift: z.number().min(0).max(2),
    festival_uplift_mode: z.enum(FESTIVAL_UPLIFT_MODES),
    include_open_po_in_stock: z.boolean(),
    stale_inventory_days: z.number().int().min(0).max(60),
    anomaly_factor: z.number().gt(1).max(20),
    anomaly_lookback_weeks: z.number().int().min(1).max(12),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.recent_weeks >= c.baseline_weeks) {
      ctx.addIssue({ code: "custom", path: ["recent_weeks"], message: "Recent window must be shorter than the baseline window" });
    }
    if (c.cover_min_weeks >= c.cover_max_weeks) {
      ctx.addIssue({ code: "custom", path: ["cover_min_weeks"], message: "Minimum cover must be below maximum cover" });
    }
    if (c.perishable_min_weeks >= c.perishable_max_weeks) {
      ctx.addIssue({ code: "custom", path: ["perishable_min_weeks"], message: "Perishable minimum must be below perishable maximum" });
    }
  });

export type RuleConfig = z.infer<typeof ruleConfigSchema>;

/** Raghav's documented defaults. Every value here is shown on the Settings page. */
export const DEFAULT_RULE_CONFIG: RuleConfig = {
  recent_weeks: 4,
  baseline_weeks: 12,
  high_demand_ratio: 1.2,
  high_demand_multiplier: 1.5,
  cover_min_weeks: 6,
  cover_max_weeks: 14,
  perishable_min_weeks: 3,
  perishable_max_weeks: 4,
  festival_uplift: 0.25,
  festival_uplift_mode: "cover_demand",
  include_open_po_in_stock: false,
  stale_inventory_days: 7,
  anomaly_factor: 2.0,
  anomaly_lookback_weeks: 4,
};

export const CONFIG_LABELS: Record<keyof RuleConfig, string> = {
  recent_weeks: "Recent window (weeks)",
  baseline_weeks: "Baseline window (weeks)",
  high_demand_ratio: "High-demand ratio",
  high_demand_multiplier: "High-demand order multiplier",
  cover_min_weeks: "Minimum cover (weeks)",
  cover_max_weeks: "Maximum cover (weeks)",
  perishable_min_weeks: "Perishable minimum cover (weeks)",
  perishable_max_weeks: "Perishable maximum cover (weeks)",
  festival_uplift: "Festival demand uplift",
  festival_uplift_mode: "Festival uplift mode",
  include_open_po_in_stock: "Count open POs as stock",
  stale_inventory_days: "Stale inventory limit (days)",
  anomaly_factor: "Anomalous jump factor",
  anomaly_lookback_weeks: "Anomaly look-back (weeks)",
};

export interface ConfigChange {
  key: keyof RuleConfig;
  label: string;
  from: RuleConfig[keyof RuleConfig];
  to: RuleConfig[keyof RuleConfig];
}

export function diffConfig(prev: RuleConfig, next: RuleConfig): ConfigChange[] {
  const keys = Object.keys(CONFIG_LABELS) as (keyof RuleConfig)[];
  return keys
    .filter((k) => prev[k] !== next[k])
    .map((k) => ({ key: k, label: CONFIG_LABELS[k], from: prev[k], to: next[k] }));
}
