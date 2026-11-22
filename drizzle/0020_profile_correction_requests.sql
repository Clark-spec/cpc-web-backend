CREATE TABLE IF NOT EXISTS "profile_correction_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reference_number" text NOT NULL UNIQUE,
  "student_user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "student_id" text NOT NULL,
  "student_name" text NOT NULL,
  "course" text DEFAULT 'BSIT' NOT NULL,
  "year" integer DEFAULT 1 NOT NULL,
  "section" text DEFAULT '' NOT NULL,
  "email" text DEFAULT '' NOT NULL,
  "field" text NOT NULL,
  "current_value" text DEFAULT '' NOT NULL,
  "requested_value" text NOT NULL,
  "reason" text NOT NULL,
  "attachment_name" text,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "admin_remarks" text DEFAULT '' NOT NULL,
  "reviewed_at" timestamp with time zone,
  "reviewed_by_id" uuid REFERENCES "user"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_correction_student_idx" ON "profile_correction_request" ("student_user_id", "submitted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_correction_status_idx" ON "profile_correction_request" ("status", "submitted_at");
