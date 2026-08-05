-- Migration: AddStudentUuidToAttendanceCases20260622120000
-- Phase B1.2 (EXPAND) — add surrogate-key FK student_uuid to attendance and cases.
-- Additive + reversible + idempotent. Legacy national-ID links stay until a
-- later CONTRACT phase.
-- attendance: every row already FK-references student_term, so the backfill is
-- total and the column is set NOT NULL. cases: student_id is loose text with no
-- FK, so some rows won't map and the column stays NULLABLE.
-- FKs are added NOT VALID then VALIDATE'd so the ADD-CONSTRAINT lock is brief.
--
-- ⚠️ PRODUCTION-SCALE (millions of rows): do NOT use this single-statement
-- backfill + non-concurrent index pattern on live national data. Use: add
-- nullable column -> batched backfill -> CREATE INDEX CONCURRENTLY on the FK
-- column -> ADD CONSTRAINT ... NOT VALID -> VALIDATE CONSTRAINT -> (attendance
-- only) enforce NOT NULL via a validated CHECK then a short final lock. This
-- inline form is for the seed DB (5k/500) only.

-- == up ==
-- attendance
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS student_uuid UUID;

UPDATE attendance a
SET student_uuid = st.student_uuid
FROM student_term st
WHERE a."PersonID_Onec" = st."PersonID_Onec"
  AND a.student_uuid IS NULL;

ALTER TABLE attendance
  ALTER COLUMN student_uuid SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_student_uuid') THEN
    ALTER TABLE attendance ADD CONSTRAINT fk_attendance_student_uuid
      FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid) NOT VALID;
    ALTER TABLE attendance VALIDATE CONSTRAINT fk_attendance_student_uuid;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_attendance_student_uuid ON attendance(student_uuid);

-- cases
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS student_uuid UUID;

UPDATE cases c
SET student_uuid = st.student_uuid
FROM student_term st
WHERE c.student_id = st."PersonID_Onec"
  AND c.student_id IS NOT NULL
  AND c.student_uuid IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cases_student_uuid') THEN
    ALTER TABLE cases ADD CONSTRAINT fk_cases_student_uuid
      FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid) NOT VALID;
    ALTER TABLE cases VALIDATE CONSTRAINT fk_cases_student_uuid;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cases_student_uuid ON cases(student_uuid);

-- == down ==
-- DROP INDEX IF EXISTS idx_cases_student_uuid;
-- ALTER TABLE cases DROP CONSTRAINT IF EXISTS fk_cases_student_uuid;
-- ALTER TABLE cases DROP COLUMN IF EXISTS student_uuid;
-- DROP INDEX IF EXISTS idx_attendance_student_uuid;
-- ALTER TABLE attendance DROP CONSTRAINT IF EXISTS fk_attendance_student_uuid;
-- ALTER TABLE attendance DROP COLUMN IF EXISTS student_uuid;
