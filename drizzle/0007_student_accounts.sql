ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "section" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "must_change_password" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "masterlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id_no" text NOT NULL,
	"name" text NOT NULL,
	"department" text NOT NULL,
	"course" text NOT NULL,
	"year_level" integer NOT NULL,
	"semester" integer DEFAULT 1 NOT NULL,
	"standing" text DEFAULT 'regular' NOT NULL,
	"last_term_enrolled" text NOT NULL,
	"is_eligible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "masterlist_student_id_no_unique" UNIQUE("student_id_no")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "masterlist_student_id_idx" ON "masterlist" USING btree ("student_id_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "masterlist_dept_idx" ON "masterlist" USING btree ("department");
