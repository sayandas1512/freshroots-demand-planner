ALTER TYPE "public"."exception_type" ADD VALUE 'distributor_shift';--> statement-breakpoint
CREATE TABLE "weekly_sales_by_distributor" (
	"sku_id" text NOT NULL,
	"distributor_id" text NOT NULL,
	"week" text NOT NULL,
	"units" integer NOT NULL,
	CONSTRAINT "weekly_sales_by_distributor_sku_id_distributor_id_week_pk" PRIMARY KEY("sku_id","distributor_id","week")
);
--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN "lead_time_weeks" double precision;--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN "moq" integer;--> statement-breakpoint
CREATE INDEX "wsd_week_idx" ON "weekly_sales_by_distributor" USING btree ("week");