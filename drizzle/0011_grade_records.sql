CREATE TABLE IF NOT EXISTS "grade_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"subject_code" text NOT NULL,
	"subject_title" text NOT NULL,
	"instructor" text DEFAULT '' NOT NULL,
	"term" text NOT NULL,
	"grade" text,
	"acknowledged_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "grade_student_subject_term_idx" ON "grade_record" ("student_user_id", "subject_code", "term");
CREATE INDEX IF NOT EXISTS "grade_student_term_idx" ON "grade_record" ("student_user_id", "term");
