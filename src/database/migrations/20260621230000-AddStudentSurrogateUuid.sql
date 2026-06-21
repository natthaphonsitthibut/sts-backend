-- Migration: AddStudentSurrogateUuid20260621230000
-- Phase B1.1 (EXPAND) — add opaque surrogate UUID to student tables.
-- Additive + reversible + idempotent. PersonID_Onec stays PK until B1.4 (CONTRACT).
-- Volatile gen_random_uuid() default fills every existing row with a distinct
-- value during the rewrite and keeps minting for future inserts.
--
-- ⚠️ PRODUCTION-SCALE (millions of rows): do NOT use this rewrite+non-concurrent
-- pattern on live national data. Use: add nullable column -> batched backfill ->
-- CREATE UNIQUE INDEX CONCURRENTLY -> ADD CONSTRAINT ... USING INDEX ->
-- enforce NOT NULL. This inline form is for the seed DB (5k/500) only.

-- == up ==
ALTER TABLE student_term
  ADD COLUMN IF NOT EXISTS student_uuid UUID NOT NULL DEFAULT gen_random_uuid();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_student_term_student_uuid') THEN
    ALTER TABLE student_term ADD CONSTRAINT uq_student_term_student_uuid UNIQUE (student_uuid);
  END IF;
END $$;

ALTER TABLE student_dropouts
  ADD COLUMN IF NOT EXISTS student_uuid UUID NOT NULL DEFAULT gen_random_uuid();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_student_dropouts_student_uuid') THEN
    ALTER TABLE student_dropouts ADD CONSTRAINT uq_student_dropouts_student_uuid UNIQUE (student_uuid);
  END IF;
END $$;

-- == down ==
-- ALTER TABLE student_dropouts DROP CONSTRAINT IF EXISTS uq_student_dropouts_student_uuid;
-- ALTER TABLE student_dropouts DROP COLUMN IF EXISTS student_uuid;
-- ALTER TABLE student_term DROP CONSTRAINT IF EXISTS uq_student_term_student_uuid;
-- ALTER TABLE student_term DROP COLUMN IF EXISTS student_uuid;
