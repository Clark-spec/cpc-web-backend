ALTER TABLE "notification" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notification_user_read_created_idx" ON "notification" USING btree ("user_id","read","created_at");