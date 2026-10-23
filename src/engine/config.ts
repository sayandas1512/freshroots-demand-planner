import { z } from "zod";

export const FESTIVAL_UPLIFT_MODES = ["cover_demand", "both_windows", "baseline_only"] as const;
export const OPERATING_MODES = ["shadow", "live"] as const;
export type OperatingMode = (typeof OPERATING_MODES)[number];
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
    // ---- v2 additions. Defaults let config versions saved before v2 keep parsing.
    mode: z.enum(OPERATING_MODES).default("shadow"),
    indicator_kill_pct: z.number().min(0).max(500).default(20),
    indicator_warn_pct: z.number().min(0).max(500).default(10),
    indicator_consecutive_checks: z.number().int().min(1).max(12).default(2),
    override_kill_rate: z.number().min(0).max(1).default(0.5),
    override_kill_runs: z.number().int().min(1).max(20).default(4),
    rubber_override_rate: z.number().min(0).max(1).default(0.02),
    rubber_median_seconds: z.number().min(0).max(600).default(5),
    rubber_runs: z.number().int().min(1).max(20).default(4),
    enable_distributor_exceptions: z.boolean().default(false),
    distributor_shift_pct: z.number().min(1).max(100).default(30),
    enable_lead_time_flag: z.boolean().default(false),
    enable_moq_flag: z.boolean().default(false),
    zoho_push_enabled: z.boolean().default(false),
    expected_regions: z.array(z.string().trim().min(1).max(60)).max(30).default(["Maharashtra", "Goa"]),
    export_id_label: z.string().trim().min(1).max(40).default("Distributor_ID"),
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
  mode: "shadow",
  indicator_kill_pct: 20,
  indicator_warn_pct: 10,
  indicator_consecutive_checks: 2,
  override_kill_rate: 0.5,
  override_kill_runs: 4,
  rubber_override_rate: 0.02,
  rubber_median_seconds: 5,
  rubber_runs: 4,
  enable_distributor_exceptions: false,
  distributor_shift_pct: 30,
  enable_lead_time_flag: false,
  enable_moq_flag: false,
  zoho_push_enabled: false,
  expected_regions: ["Maharashtra", "Goa"],
  export_id_label: "Distributor_ID",
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
  mode: "Operating mode",
  indicator_kill_pct: "Weekly indicator kill threshold (% worse)",
  indicator_warn_pct: "Weekly indicator warning threshold (% worse)",
  indicator_consecutive_checks: "Consecutive checks needed to kill (indicators)",
  override_kill_rate: "Override kill rate",
  override_kill_runs: "Consecutive runs above the override kill rate",
  rubber_override_rate: "Rubber-stamp: override rate below",
  rubber_median_seconds: "Rubber-stamp: median seconds per decision below",
  rubber_runs: "Rubber-stamp: consecutive runs",
  enable_distributor_exceptions: "Distributor-shift exceptions",
  distributor_shift_pct: "Distributor shift threshold (%)",
  enable_lead_time_flag: "Lead-time breach flag",
  enable_moq_flag: "Minimum order quantity flag",
  zoho_push_enabled: "Create draft purchase orders in Zoho",
  expected_regions: "Expected distributor regions",
  export_id_label: "Export label for the distributor column",
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
    .filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]))
    .map((k) => ({ key: k, label: CONFIG_LABELS[k], from: prev[k], to: next[k] }));
}
