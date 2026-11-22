ALTER TABLE "profile_correction_request"
  ADD COLUMN IF NOT EXISTS "attachment_type" text,
  ADD COLUMN IF NOT EXISTS "attachment_data" text;
