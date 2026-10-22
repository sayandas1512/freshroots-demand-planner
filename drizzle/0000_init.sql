CREATE TYPE "public"."action" AS ENUM('REORDER_NOW', 'REORDER_1_5X', 'PAUSE', 'HOLD');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('pending', 'approved', 'edited', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."exception_status" AS ENUM('open', 'handled');--> statement-breakpoint
CREATE TYPE "public"."exception_type" AS ENUM('new_sku', 'short_history', 'missing_stock', 'zero_demand', 'anomalous_jump', 'unknown_sku', 'conflicting_signals', 'processing_error');--> statement-breakpoint
CREATE TYPE "public"."explanation_source" AS ENUM('llm', 'template');--> statement-breakpoint
CREATE TYPE "public"."llm_status" AS ENUM('ok', 'partial', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."perishability" AS ENUM('low', 'high');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'completed', 'completed_degraded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('cron', 'manual', 'backtest');--> statement-breakpoint
CREATE TABLE "backtest_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"week" text NOT NULL,
	"sku_id" text NOT NULL,
	"system_action" text NOT NULL,
	"raghav_action" text,
	"agreed" boolean
);
--> statement-breakpoint
CREATE TABLE "baseline" (
	"period" text PRIMARY KEY NOT NULL,
	"stockout_loss_inr" integer NOT NULL,
	"stockout_loss_inr_high" integer,
	"writeoff_inr" integer NOT NULL,
	"writeoff_inr_high" integer,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distributors" (
	"distributor_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sku_id" text NOT NULL,
	"type" "exception_type" NOT NULL,
	"detail" text NOT NULL,
	"status" "exception_status" DEFAULT 'open' NOT NULL,
	"handled_note" text,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "festival_months" (
	"year_month" text PRIMARY KEY NOT NULL,
	"is_festival" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"accepted" integer NOT NULL,
	"rejected" integer NOT NULL,
	"replaced" integer NOT NULL,
	"detail" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_snapshots" (
	"sku_id" text NOT NULL,
	"location" text NOT NULL,
	"units_on_hand" integer NOT NULL,
	"as_of_date" date NOT NULL,
	CONSTRAINT "inventory_snapshots_sku_id_location_as_of_date_pk" PRIMARY KEY("sku_id","location","as_of_date")
);
--> statement-breakpoint
CREATE TABLE "open_pos" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku_id" text NOT NULL,
	"qty" integer NOT NULL,
	"expected_date" date
);
--> statement-breakpoint
CREATE TABLE "overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"field" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sku_id" text NOT NULL,
	"action" "action" NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"rule_fired" text NOT NULL,
	"qty" integer,
	"metrics" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"explanation_source" "explanation_source" DEFAULT 'template' NOT NULL,
	"status" "decision_status" DEFAULT 'pending' NOT NULL,
	"final_qty" integer,
	"decided_at" timestamp with time zone,
	"decided_note" text
);
--> statement-breakpoint
CREATE TABLE "rule_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_headlines" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"source" "explanation_source" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" "run_trigger" NOT NULL,
	"as_of_date" date NOT NULL,
	"config_version" integer,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"llm_status" "llm_status" DEFAULT 'skipped' NOT NULL,
	"llm_calls" integer DEFAULT 0 NOT NULL,
	"llm_cost_usd" numeric(12, 6)
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"sku_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"perishability" "perishability" NOT NULL,
	"standard_reorder_qty" integer NOT NULL,
	"unit" text NOT NULL,
	"distributor_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_sales" (
	"sku_id" text NOT NULL,
	"week" text NOT NULL,
	"units" integer NOT NULL,
	CONSTRAINT "weekly_sales_sku_id_week_pk" PRIMARY KEY("sku_id","week")
);
--> statement-breakpoint
ALTER TABLE "backtest_results" ADD CONSTRAINT "backtest_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_headlines" ADD CONSTRAINT "run_headlines_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtest_run_idx" ON "backtest_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "backtest_week_idx" ON "backtest_results" USING btree ("week");--> statement-breakpoint
CREATE INDEX "exceptions_run_idx" ON "exceptions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "exceptions_type_idx" ON "exceptions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ingest_reports_kind_at_idx" ON "ingest_reports" USING btree ("kind","at");--> statement-breakpoint
CREATE INDEX "inventory_as_of_idx" ON "inventory_snapshots" USING btree ("as_of_date");--> statement-breakpoint
CREATE INDEX "open_pos_sku_idx" ON "open_pos" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "overrides_rec_idx" ON "overrides" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX "overrides_at_idx" ON "overrides" USING btree ("at");--> statement-breakpoint
CREATE INDEX "recommendations_run_idx" ON "recommendations" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "recommendations_sku_idx" ON "recommendations" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "recommendations_status_idx" ON "recommendations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recommendations_rule_idx" ON "recommendations" USING btree ("rule_fired");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_run_sku_idx" ON "recommendations" USING btree ("run_id","sku_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_config_version_idx" ON "rule_config" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_config_one_active_idx" ON "rule_config" USING btree ("is_active") WHERE "rule_config"."is_active";--> statement-breakpoint
CREATE INDEX "runs_as_of_trigger_idx" ON "runs" USING btree ("as_of_date","trigger");--> statement-breakpoint
CREATE INDEX "runs_started_idx" ON "runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "skus_distributor_idx" ON "skus" USING btree ("distributor_id");--> statement-breakpoint
CREATE INDEX "weekly_sales_week_idx" ON "weekly_sales" USING btree ("week");