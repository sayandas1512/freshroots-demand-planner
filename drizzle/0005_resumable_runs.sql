ALTER TABLE "runs" ADD COLUMN "step" text DEFAULT 'prepare' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cursor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;