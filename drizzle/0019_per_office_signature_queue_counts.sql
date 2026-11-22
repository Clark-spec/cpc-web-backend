CREATE TABLE IF NOT EXISTS "signature_office_daily_count" (
  "queue_type" text NOT NULL,
  "office" text NOT NULL,
  "local_date" text NOT NULL,
  "request_count" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("queue_type", "office", "local_date")
);
--> statement-breakpoint

-- Old queue numbers were shared across offices. Renumber each Study Load
-- office independently for each Philippine-local queue date.
WITH entries AS (
  SELECT
    es."student_id",
    q.key AS office,
    q.value AS queue,
    q.value->>'date' AS queue_date,
    (q.value->>'number')::integer AS old_number,
    es."session"->'signatureRequests'->>q.key AS requested_at
  FROM "enrollment_session" es
  CROSS JOIN LATERAL jsonb_each(COALESCE(es."session"->'signatureQueue', '{}'::jsonb)) q
  WHERE q.key IN ('screening', 'guidance', 'clinic', 'registrar', 'accounting')
    AND q.value->>'date' IS NOT NULL
    AND q.value->>'number' ~ '^[0-9]+$'
), ranked AS (
  SELECT *, row_number() OVER (
    PARTITION BY office, queue_date
    ORDER BY old_number, requested_at NULLS LAST, "student_id"
  ) AS new_number
  FROM entries
), updates AS (
  SELECT "student_id", jsonb_object_agg(
    office,
    jsonb_set(queue, '{number}', to_jsonb(new_number), true)
  ) AS "signature_queue"
  FROM ranked
  GROUP BY "student_id"
)
UPDATE "enrollment_session" es
SET "session" = jsonb_set(es."session", '{signatureQueue}', updates."signature_queue", true)
FROM updates
WHERE es."student_id" = updates."student_id";
--> statement-breakpoint

-- Renumber Office Signatures independently for each office and queue date.
WITH entries AS (
  SELECT
    es."student_id",
    office.ordinality,
    office.value AS office_record,
    office.value->>'office' AS office_name,
    office.value->>'queueDate' AS queue_date,
    office.value->>'queueNumber' AS queue_number,
    office.value->>'requestedAt' AS requested_at
  FROM "enrollment_session" es
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(es."session" #> '{clearance,offices}', '[]'::jsonb))
    WITH ORDINALITY AS office(value, ordinality)
), ranked AS (
  SELECT "student_id", ordinality, row_number() OVER (
    PARTITION BY office_name, queue_date
    ORDER BY queue_number::integer, requested_at NULLS LAST, "student_id"
  ) AS new_number
  FROM entries
  WHERE office_name IN ('dean', 'sao', 'library', 'accounting', 'registrar')
    AND queue_date IS NOT NULL
    AND queue_number ~ '^[0-9]+$'
), updates AS (
  SELECT entries."student_id", jsonb_agg(
    CASE
      WHEN ranked.new_number IS NULL THEN entries.office_record
      ELSE jsonb_set(entries.office_record, '{queueNumber}', to_jsonb(ranked.new_number), true)
    END ORDER BY entries.ordinality
  ) AS offices
  FROM entries
  LEFT JOIN ranked USING ("student_id", ordinality)
  GROUP BY entries."student_id"
)
UPDATE "enrollment_session" es
SET "session" = jsonb_set(es."session", '{clearance,offices}', updates.offices, true)
FROM updates
WHERE es."student_id" = updates."student_id";
--> statement-breakpoint

-- Keep any in-progress board tickets aligned with the renumbered session data.
UPDATE "signature_queue_processing" p
SET "queue_number" = (es."session"->'signatureQueue'->p."office"->>'number')::integer,
    "queue_date" = es."session"->'signatureQueue'->p."office"->>'date'
FROM "enrollment_session" es
WHERE p."queue_type" = 'study_load'
  AND p."student_id" = es."student_id"
  AND es."session"->'signatureQueue'->p."office"->>'number' ~ '^[0-9]+$';
--> statement-breakpoint

UPDATE "signature_queue_processing" p
SET "queue_number" = (office.value->>'queueNumber')::integer,
    "queue_date" = office.value->>'queueDate'
FROM "enrollment_session" es
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(es."session" #> '{clearance,offices}', '[]'::jsonb)) office(value)
WHERE p."queue_type" = 'office_signatures'
  AND p."student_id" = es."student_id"
  AND office.value->>'office' = p."office"
  AND office.value->>'queueNumber' ~ '^[0-9]+$';
--> statement-breakpoint

-- Seed the office-specific counters from the newly numbered existing queues.
INSERT INTO "signature_office_daily_count" ("queue_type", "office", "local_date", "request_count")
SELECT 'study_load', q.key, q.value->>'date', max((q.value->>'number')::integer)
FROM "enrollment_session" es
CROSS JOIN LATERAL jsonb_each(COALESCE(es."session"->'signatureQueue', '{}'::jsonb)) q
WHERE q.key IN ('screening', 'guidance', 'clinic', 'registrar', 'accounting')
  AND q.value->>'date' IS NOT NULL
  AND q.value->>'number' ~ '^[0-9]+$'
GROUP BY q.key, q.value->>'date'
ON CONFLICT ("queue_type", "office", "local_date") DO UPDATE
SET "request_count" = GREATEST("signature_office_daily_count"."request_count", EXCLUDED."request_count");
--> statement-breakpoint

INSERT INTO "signature_office_daily_count" ("queue_type", "office", "local_date", "request_count")
SELECT 'office_signatures', office.value->>'office', office.value->>'queueDate', max((office.value->>'queueNumber')::integer)
FROM "enrollment_session" es
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(es."session" #> '{clearance,offices}', '[]'::jsonb)) office(value)
WHERE office.value->>'office' IN ('dean', 'sao', 'library', 'accounting', 'registrar')
  AND office.value->>'queueDate' IS NOT NULL
  AND office.value->>'queueNumber' ~ '^[0-9]+$'
GROUP BY office.value->>'office', office.value->>'queueDate'
ON CONFLICT ("queue_type", "office", "local_date") DO UPDATE
SET "request_count" = GREATEST("signature_office_daily_count"."request_count", EXCLUDED."request_count");
