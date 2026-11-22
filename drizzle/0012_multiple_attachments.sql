ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "additional_attachments" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "service_request_draft" ADD COLUMN IF NOT EXISTS "additional_attachments" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "complaint" ADD COLUMN IF NOT EXISTS "additional_attachments" jsonb NOT NULL DEFAULT '[]'::jsonb;
