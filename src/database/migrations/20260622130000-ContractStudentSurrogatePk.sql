-- Migration: ContractStudentSurrogatePk20260622130000
-- Phase B1.4 (CONTRACT) — promote student_uuid to the primary key of
-- student_term and retire the national-ID link.
--   * student_term PK: "PersonID_Onec" -> student_uuid; PersonID stays UNIQUE
--     (still the import reconciliation key, never leaves the server).
--   * attendance keyed solely by student_uuid (dedup index + FK move to uuid,
--     legacy "PersonID_Onec" column dropped).
--   * cases drops the loose student_id text link (case matching/scope keys on
--     student_uuid, the FK added in B1.2).
-- Run AFTER the app code stops reading/writing the legacy columns. Reversible:
-- down() re-adds the legacy PK/columns and backfills the national ID from
-- student_term via the intact student_uuid FK. Idempotent guards throughout.
--
-- ⚠️ PRODUCTION-SCALE: on national data do the PK swap online (build the uuid
-- unique index CONCURRENTLY, swap the PK under a brief lock) and drop the legacy
-- columns in a separate later release. This inline form targets the seed DB only.

-- == up ==
-- 1. keep PersonID_Onec unique once it is no longer the PK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_student_term_personid') THEN
    ALTER TABLE student_term ADD CONSTRAINT uq_student_term_personid UNIQUE ("PersonID_Onec");
  END IF;
END $$;

-- 2. move the attendance dedup unique index to the surrogate key
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_uuid_date_period
  ON attendance (student_uuid, "AttendanceDate", "Period");
DROP INDEX IF EXISTS uq_attendance_person_date_period;

-- 3. drop the legacy attendance -> PersonID FK (uuid FK from B1.2 remains)
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS "attendance_PersonID_Onec_fkey";
DROP INDEX IF EXISTS idx_attendance_person_id;

-- 4. swap the student_term primary key: PersonID_Onec -> student_uuid
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_term_pkey' AND conrelid = 'student_term'::regclass) THEN
    ALTER TABLE student_term DROP CONSTRAINT student_term_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'p' AND conrelid = 'student_term'::regclass) THEN
    ALTER TABLE student_term ADD PRIMARY KEY (student_uuid);
  END IF;
END $$;

-- 5. drop the now-unused legacy student-link columns
ALTER TABLE attendance DROP COLUMN IF EXISTS "PersonID_Onec";
ALTER TABLE cases DROP COLUMN IF EXISTS student_id;

-- == down ==
-- reverse 5: re-add legacy columns and backfill the national ID via student_uuid
ALTER TABLE cases ADD COLUMN IF NOT EXISTS student_id TEXT;
UPDATE cases c SET student_id = st."PersonID_Onec"
  FROM student_term st
  WHERE c.student_uuid = st.student_uuid AND c.student_uuid IS NOT NULL AND c.student_id IS NULL;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS "PersonID_Onec" VARCHAR(20);
UPDATE attendance a SET "PersonID_Onec" = st."PersonID_Onec"
  FROM student_term st
  WHERE a.student_uuid = st.student_uuid AND a."PersonID_Onec" IS NULL;
ALTER TABLE attendance ALTER COLUMN "PersonID_Onec" SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_person_id ON attendance("PersonID_Onec");
-- reverse 4: primary key back to PersonID_Onec
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'p' AND conrelid = 'student_term'::regclass) THEN
    ALTER TABLE student_term DROP CONSTRAINT student_term_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'p' AND conrelid = 'student_term'::regclass) THEN
    ALTER TABLE student_term ADD PRIMARY KEY ("PersonID_Onec");
  END IF;
END $$;
-- reverse 1 (before re-adding the FK so it binds to the restored PK): drop the redundant unique
ALTER TABLE student_term DROP CONSTRAINT IF EXISTS uq_student_term_personid;
-- reverse 3: re-add the attendance -> PersonID FK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_PersonID_Onec_fkey') THEN
    ALTER TABLE attendance ADD CONSTRAINT "attendance_PersonID_Onec_fkey"
      FOREIGN KEY ("PersonID_Onec") REFERENCES student_term("PersonID_Onec");
  END IF;
END $$;
-- reverse 2: dedup unique index back to PersonID
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_person_date_period
  ON attendance ("PersonID_Onec", "AttendanceDate", "Period");
DROP INDEX IF EXISTS uq_attendance_uuid_date_period;
