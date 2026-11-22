CREATE TABLE IF NOT EXISTS "office_notification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "office_id" text NOT NULL,
  "title" text,
  "message" text NOT NULL,
  "type" text DEFAULT 'info' NOT NULL,
  "href" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "office_notification_target_created_idx" ON "office_notification" ("office_id", "created_at");

CREATE TABLE IF NOT EXISTS "office_notification_read" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "notification_id" uuid NOT NULL REFERENCES "office_notification"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL,
  "read_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "office_notification_read_user_idx" ON "office_notification_read" ("notification_id", "user_id");
