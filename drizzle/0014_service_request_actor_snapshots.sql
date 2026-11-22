ALTER TABLE "service_request" DROP CONSTRAINT IF EXISTS "service_request_last_updated_by_id_user_id_fk";
ALTER TABLE "service_request_history" DROP CONSTRAINT IF EXISTS "service_request_history_changed_by_id_user_id_fk";

ALTER TABLE "service_request" ADD COLUMN IF NOT EXISTS "last_updated_by_name" text;
ALTER TABLE "service_request_history" ADD COLUMN IF NOT EXISTS "changed_by_name" text;

UPDATE "service_request" r SET "last_updated_by_name" = u."name"
FROM "user" u WHERE u."id" = r."last_updated_by_id" AND r."last_updated_by_name" IS NULL;

UPDATE "service_request_history" h SET "changed_by_name" = u."name"
FROM "user" u WHERE u."id" = h."changed_by_id" AND h."changed_by_name" IS NULL;
