CREATE TYPE "public"."user_role" AS ENUM('planner', 'sponsor', 'data', 'admin');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exceptions" ADD COLUMN "handled_by" uuid;--> statement-breakpoint
ALTER TABLE "ingest_reports" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "overrides" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "rule_config" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "started_by" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");