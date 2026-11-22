CREATE TABLE IF NOT EXISTS "enrollment_session" (
	"student_id" text PRIMARY KEY NOT NULL REFERENCES "masterlist"("student_id_no") ON DELETE CASCADE,
	"session" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "enrollment_session_updated_idx" ON "enrollment_session" USING btree ("updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_signature" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"image_base64" text NOT NULL,
	"method" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "staff_signature" ADD CONSTRAINT "staff_signature_user_id_user_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_signature_owner_idx" ON "staff_signature" USING btree ("user_id", "created_at");
