import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { LineMetrics } from "@/engine/types";

export const roleEnum = pgEnum("user_role", ["planner", "sponsor", "data", "admin"]);
export const perishabilityEnum = pgEnum("perishability", ["low", "high"]);
export const actionEnum = pgEnum("action", ["REORDER_NOW", "REORDER_1_5X", "PAUSE", "HOLD"]);
export const triggerEnum = pgEnum("run_trigger", ["cron", "manual", "backtest"]);
export const runStatusEnum = pgEnum("run_status", ["running", "completed", "completed_degraded", "failed", "skipped_killed"]);
export const llmStatusEnum = pgEnum("llm_status", ["ok", "partial", "failed", "skipped"]);
export const explanationSourceEnum = pgEnum("explanation_source", ["llm", "template"]);
export const decisionStatusEnum = pgEnum("decision_status", ["pending", "approved", "edited", "rejected"]);
export const exceptionTypeEnum = pgEnum("exception_type", [
  "new_sku",
  "short_history",
  "missing_stock",
  "zero_demand",
  "anomalous_jump",
  "unknown_sku",
  "conflicting_signals",
  "processing_error",
  "distributor_shift",
]);
export const exceptionStatusEnum = pgEnum("exception_status", ["open", "handled"]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const distributors = pgTable("distributors", {
  distributorId: text("distributor_id").primaryKey(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  status: text("status").notNull(),
});

export const skus = pgTable(
  "skus",
  {
    skuId: text("sku_id").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    perishability: perishabilityEnum("perishability").notNull(),
    standardReorderQty: integer("standard_reorder_qty").notNull(),
    unit: text("unit").notNull(),
    /** Optional. Weeks between ordering and arrival. */
    leadTimeWeeks: doublePrecision("lead_time_weeks"),
    /** Optional minimum order quantity. */
    moq: integer("moq"),
    // No FK: ingestion order is not guaranteed and a missing distributor must not block the SKU master.
    distributorId: text("distributor_id").notNull(),
  },
  (t) => [index("skus_distributor_idx").on(t.distributorId)],
);

export const weeklySales = pgTable(
  "weekly_sales",
  {
    skuId: text("sku_id").notNull(),
    week: text("week").notNull(),
    units: integer("units").notNull(),
  },
  (t) => [primaryKey({ columns: [t.skuId, t.week] }), index("weekly_sales_week_idx").on(t.week)],
);

/** Optional distributor-level sales. `weekly_sales` stays the SKU aggregate and is derived from these rows when they exist. */
export const weeklySalesByDistributor = pgTable(
  "weekly_sales_by_distributor",
  {
    skuId: text("sku_id").notNull(),
    distributorId: text("distributor_id").notNull(),
    week: text("week").notNull(),
    units: integer("units").notNull(),
  },
  (t) => [primaryKey({ columns: [t.skuId, t.distributorId, t.week] }), index("wsd_week_idx").on(t.week)],
);

export const inventorySnapshots = pgTable(
  "inventory_snapshots",
  {
    skuId: text("sku_id").notNull(),
    location: text("location").notNull(),
    unitsOnHand: integer("units_on_hand").notNull(),
    asOfDate: date("as_of_date", { mode: "string" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.skuId, t.location, t.asOfDate] }), index("inventory_as_of_idx").on(t.asOfDate)],
);

export const openPos = pgTable(
  "open_pos",
  {
    id: serial("id").primaryKey(),
    skuId: text("sku_id").notNull(),
    qty: integer("qty").notNull(),
    expectedDate: date("expected_date", { mode: "string" }),
  },
  (t) => [index("open_pos_sku_idx").on(t.skuId)],
);

export const festivalMonths = pgTable("festival_months", {
  yearMonth: text("year_month").primaryKey(),
  isFestival: boolean("is_festival").notNull(),
});

export const ruleConfig = pgTable(
  "rule_config",
  {
    id: serial("id").primaryKey(),
    version: integer("version").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by"),
  },
  (t) => [
    uniqueIndex("rule_config_version_idx").on(t.version),
    uniqueIndex("rule_config_one_active_idx").on(t.isActive).where(sql`${t.isActive}`),
  ],
);

export interface RunCounts {
  lines?: number;
  exceptions?: number;
  byAction?: Record<string, number>;
  byFlag?: Record<string, number>;
  byRule?: Record<string, number>;
  steps?: Record<string, { status: "pending" | "running" | "done" | "degraded" | "failed" | "skipped"; at?: string; detail?: string }>;
  notes?: string[];
  [key: string]: unknown;
}

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trigger: triggerEnum("trigger").notNull(),
    asOfDate: date("as_of_date", { mode: "string" }).notNull(),
    configVersion: integer("config_version"),
    status: runStatusEnum("status").notNull().default("running"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    counts: jsonb("counts").$type<RunCounts>().notNull().default({}),
    llmStatus: llmStatusEnum("llm_status").notNull().default("skipped"),
    llmCalls: integer("llm_calls").notNull().default(0),
    llmCostUsd: numeric("llm_cost_usd", { precision: 12, scale: 6 }),
    startedBy: uuid("started_by"),
    /** Resumable state machine: which step the run is on, where inside it, how often it has failed, and who holds it. */
    step: text("step").notNull().default("prepare"),
    cursor: integer("cursor").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    leaseUntil: ts("lease_until"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("runs_as_of_trigger_idx").on(t.asOfDate, t.trigger), index("runs_started_idx").on(t.startedAt), index("runs_status_idx").on(t.status)],
);

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    skuId: text("sku_id").notNull(),
    action: actionEnum("action").notNull(),
    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
    ruleFired: text("rule_fired").notNull(),
    qty: integer("qty"),
    /** Frozen audit snapshot of the numbers behind the line. The only derived data we store. */
    metrics: jsonb("metrics").$type<LineMetrics>().notNull(),
    explanation: text("explanation").notNull(),
    explanationSource: explanationSourceEnum("explanation_source").notNull().default("template"),
    status: decisionStatusEnum("status").notNull().default("pending"),
    finalQty: integer("final_qty"),
    decidedAt: ts("decided_at"),
    decidedNote: text("decided_note"),
    decidedBy: uuid("decided_by"),
    /** Set when the row has been in view for a second; with decided_at it gives decision time. */
    firstViewedAt: ts("first_viewed_at"),
  },
  (t) => [
    index("recommendations_run_idx").on(t.runId),
    index("recommendations_sku_idx").on(t.skuId),
    index("recommendations_status_idx").on(t.status),
    index("recommendations_rule_idx").on(t.ruleFired),
    uniqueIndex("recommendations_run_sku_idx").on(t.runId, t.skuId),
  ],
);

export const exceptions = pgTable(
  "exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    skuId: text("sku_id").notNull(),
    type: exceptionTypeEnum("type").notNull(),
    detail: text("detail").notNull(),
    status: exceptionStatusEnum("status").notNull().default("open"),
    handledNote: text("handled_note"),
    handledAt: ts("handled_at"),
    handledBy: uuid("handled_by"),
  },
  (t) => [index("exceptions_run_idx").on(t.runId), index("exceptions_type_idx").on(t.type)],
);

export const overrides = pgTable(
  "overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recommendationId: uuid("recommendation_id").notNull().references(() => recommendations.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    reason: text("reason").notNull(),
    at: ts("at").notNull().defaultNow(),
    userId: uuid("user_id"),
  },
  (t) => [index("overrides_rec_idx").on(t.recommendationId), index("overrides_at_idx").on(t.at)],
);

export const runHeadlines = pgTable("run_headlines", {
  runId: uuid("run_id").primaryKey().references(() => runs.id, { onDelete: "cascade" }),
  /** Three lines separated by "\n". */
  text: text("text").notNull(),
  source: explanationSourceEnum("source").notNull(),
});

export const baseline = pgTable("baseline", {
  period: text("period").primaryKey(),
  stockoutLossInr: integer("stockout_loss_inr").notNull(),
  /** Upper end when the baseline is a range (the brief gives ranges). Null for an exact entry. */
  stockoutLossInrHigh: integer("stockout_loss_inr_high"),
  writeoffInr: integer("writeoff_inr").notNull(),
  writeoffInrHigh: integer("writeoff_inr_high"),
  source: text("source").notNull(),
});

export const backtestResults = pgTable(
  "backtest_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    week: text("week").notNull(),
    skuId: text("sku_id").notNull(),
    systemAction: text("system_action").notNull(),
    systemQty: integer("system_qty"),
    raghavAction: text("raghav_action"),
    orderedQty: integer("ordered_qty"),
    agreed: boolean("agreed"),
  },
  (t) => [index("backtest_run_idx").on(t.runId), index("backtest_week_idx").on(t.week)],
);

/** Last ingestion report per file kind, so the Data page can show it after a reload. */
export const ingestReports = pgTable(
  "ingest_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    accepted: integer("accepted").notNull(),
    rejected: integer("rejected").notNull(),
    replaced: integer("replaced").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    at: ts("at").notNull().defaultNow(),
    userId: uuid("user_id"),
  },
  (t) => [index("ingest_reports_kind_at_idx").on(t.kind, t.at)],
);

/** Append-only history of the kill switch. The newest row says whether it is on. */
export const killState = pgTable(
  "kill_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: ts("at").notNull().defaultNow(),
    active: boolean("active").notNull(),
    kind: text("kind").notNull(), // trip_auto | trip_manual | clear
    reason: text("reason").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    setBy: uuid("set_by"),
    setByLabel: text("set_by_label").notNull(),
    note: text("note"),
  },
  (t) => [index("kill_state_at_idx").on(t.at)],
);

/** One row per kill evaluation, so "two consecutive checks" can be counted. */
export const killChecks = pgTable(
  "kill_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: ts("at").notNull().defaultNow(),
    trigger: text("trigger").notNull(), // run | monthly | manual
    runId: uuid("run_id"),
    latestWeek: text("latest_week"),
    levels: jsonb("levels").$type<Record<string, string>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index("kill_checks_at_idx").on(t.at)],
);

/** Priya's existing weekly report: both metrics are already in it. */
export const outcomesWeekly = pgTable("outcomes_weekly", {
  week: text("week").primaryKey(),
  stockoutIncidents: integer("stockout_incidents").notNull(),
  overstockValueInr: integer("overstock_value_inr").notNull(),
  source: text("source").notNull(),
  enteredBy: uuid("entered_by"),
  enteredAt: ts("entered_at").notNull().defaultNow(),
});

export const outcomesMonthly = pgTable("outcomes_monthly", {
  period: text("period").primaryKey(), // YYYY-MM
  stockoutLossInr: integer("stockout_loss_inr").notNull(),
  writeoffInr: integer("writeoff_inr").notNull(),
  methodNote: text("method_note").notNull(),
  enteredBy: uuid("entered_by"),
  enteredAt: ts("entered_at").notNull().defaultNow(),
});

/** The 8 weeks before go-live, copied here and never edited again once frozen. */
export const baselineWeekly = pgTable("baseline_weekly", {
  week: text("week").primaryKey(),
  stockoutIncidents: integer("stockout_incidents").notNull(),
  overstockValueInr: integer("overstock_value_inr").notNull(),
  frozenAt: ts("frozen_at").notNull().defaultNow(),
  frozenBy: uuid("frozen_by"),
});

export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const goLiveItems = pgTable("go_live_items", {
  itemKey: text("item_key").primaryKey(),
  tickedBy: uuid("ticked_by").notNull(),
  tickedAt: ts("ticked_at").notNull().defaultNow(),
  note: text("note"),
});

export const exportLog = pgTable(
  "export_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: ts("at").notNull().defaultNow(),
    runId: uuid("run_id").notNull(),
    userId: uuid("user_id"),
    lineCount: integer("line_count").notNull(),
    totalQty: integer("total_qty").notNull(),
    kind: text("kind").notNull(), // preview | download
  },
  (t) => [index("export_log_at_idx").on(t.at)],
);
