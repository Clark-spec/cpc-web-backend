ALTER TABLE "user" ALTER COLUMN "email" DROP NOT NULL;
--> statement-breakpoint
UPDATE "user"
SET "email" = NULL
WHERE "role" = 'STUDENT'
  AND "email" LIKE '%@students.cpc.edu.ph';
