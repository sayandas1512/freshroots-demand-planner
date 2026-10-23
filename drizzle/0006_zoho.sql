CREATE TABLE "zoho_item_map" (
	"sku_id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"set_by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zoho_items" (
	"item_id" text PRIMARY KEY NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"purchase_rate" double precision,
	"vendor_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zoho_purchase_orders" (
	"po_id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"vendor_id" text,
	"status" text NOT NULL,
	"total" double precision,
	"delivery_date" text,
	"lines" jsonb,
	"list_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "zoho_push_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL,
	"vendor_id" text NOT NULL,
	"reference" text NOT NULL,
	"status" text NOT NULL,
	"zoho_po_id" text,
	"zoho_po_number" text,
	"lines" jsonb NOT NULL,
	"error" text,
	"user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "zoho_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger" text NOT NULL,
	"ok" boolean NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "zoho_vendor_map" (
	"distributor_id" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"set_by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zoho_vendors" (
	"vendor_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "open_pos" ADD COLUMN "source" text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
CREATE INDEX "zoho_po_status_idx" ON "zoho_purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "zoho_push_reference_idx" ON "zoho_push_log" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "zoho_push_run_idx" ON "zoho_push_log" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "zoho_sync_at_idx" ON "zoho_sync_log" USING btree ("at");