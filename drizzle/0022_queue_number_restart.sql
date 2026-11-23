ALTER TABLE "signature_office_daily_count"
  ADD COLUMN IF NOT EXISTS "last_queue_number" integer NOT NULL DEFAULT 0;

-- Preserve existing queue numbering on deployment. The sequence can be reset
-- independently from request_count, which continues enforcing the daily limit.
UPDATE "signature_office_daily_count"
SET "last_queue_number" = "request_count"
WHERE "last_queue_number" = 0 AND "request_count" > 0;
