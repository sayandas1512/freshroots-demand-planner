CREATE TABLE "login_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "login_tokens" ADD CONSTRAINT "login_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "login_tokens_hash_idx" ON "login_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "login_tokens_user_idx" ON "login_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";