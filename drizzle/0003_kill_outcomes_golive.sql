ALTER TYPE "public"."run_status" ADD VALUE 'skipped_killed';--> statement-breakpoint
CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baseline_weekly" (
	"week" text PRIMARY KEY NOT NULL,
	"stockout_incidents" integer NOT NULL,
	"overstock_value_inr" integer NOT NULL,
	"frozen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_by" uuid
);
--> statement-breakpoint
CREATE TABLE "export_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid,
	"line_count" integer NOT NULL,
	"total_qty" integer NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "go_live_items" (
	"item_key" text PRIMARY KEY NOT NULL,
	"ticked_by" uuid NOT NULL,
	"ticked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "kill_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger" text NOT NULL,
	"run_id" uuid,
	"latest_week" text,
	"levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kill_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"set_by" uuid,
	"set_by_label" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "outcomes_monthly" (
	"period" text PRIMARY KEY NOT NULL,
	"stockout_loss_inr" integer NOT NULL,
	"writeoff_inr" integer NOT NULL,
	"method_note" text NOT NULL,
	"entered_by" uuid,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes_weekly" (
	"week" text PRIMARY KEY NOT NULL,
	"stockout_incidents" integer NOT NULL,
	"overstock_value_inr" integer NOT NULL,
	"source" text NOT NULL,
	"entered_by" uuid,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "first_viewed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "export_log_at_idx" ON "export_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "kill_checks_at_idx" ON "kill_checks" USING btree ("at");--> statement-breakpoint
CREATE INDEX "kill_state_at_idx" ON "kill_state" USING btree ("at");