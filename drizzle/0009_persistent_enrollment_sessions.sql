CREATE TABLE IF NOT EXISTS "enrollment_session" (
	"student_id" text PRIMARY KEY NOT NULL REFERENCES "masterlist"("student_id_no") ON DELETE CASCADE,
	"session" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "enrollment_session_updated_idx" ON "enrollment_session" USING btree ("updated_at");
