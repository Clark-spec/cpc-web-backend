CREATE TABLE IF NOT EXISTS "signature_request_daily_count" (
  "local_date" text PRIMARY KEY,
  "request_count" integer NOT NULL DEFAULT 0
);
