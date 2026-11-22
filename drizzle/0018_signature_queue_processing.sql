CREATE TABLE IF NOT EXISTS "signature_queue_processing" (
  "queue_type" text NOT NULL,
  "office" text NOT NULL,
  "student_id" text,
  "queue_date" text,
  "queue_number" integer,
  "started_at" timestamptz,
  "started_by" text,
  PRIMARY KEY ("queue_type", "office")
);
