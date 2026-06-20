-- Migration: AddCoreIndexesForeignKeysUnique20260620120000
-- Phase A (A1+A2+A3) production DB hardening — additive + reversible.
-- A1 indexes on scope/filter columns (verified missing on live DB).
-- A2 foreign keys for loose integer relations (verified orphan-free).
--    cases.student_id -> student_term is DEFERRED until surrogate-key decision (#1).
-- A3 unique attendance(person,date,period) idempotency (verified duplicate-free).
-- PRODUCTION ROLLOUT: build the A1 indexes with CREATE INDEX CONCURRENTLY on large tables.

-- == up ==
CREATE INDEX IF NOT EXISTS idx_student_term_scope ON student_term ("SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec");
CREATE INDEX IF NOT EXISTS idx_attendance_school_date ON attendance ("SchoolID_Onec", "AttendanceDate");
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status);
-- idx_cases_school_id is owned by AddSchoolIdToCases20260617123000 — not managed here.
CREATE INDEX IF NOT EXISTS idx_cases_student_id ON cases (student_id);
CREATE INDEX IF NOT EXISTS idx_tasks_target_school_id ON tasks (target_school_id);
CREATE INDEX IF NOT EXISTS idx_tasks_type_status ON tasks (task_type, status);
CREATE INDEX IF NOT EXISTS idx_schools_geo ON schools (province, district, sub_district);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_person_date_period ON attendance ("PersonID_Onec", "AttendanceDate", "Period");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_SchoolID_Onec_fkey') THEN
    ALTER TABLE attendance ADD CONSTRAINT "attendance_SchoolID_Onec_fkey"
      FOREIGN KEY ("SchoolID_Onec") REFERENCES schools(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_GradeLevelID_Onec_fkey') THEN
    ALTER TABLE attendance ADD CONSTRAINT "attendance_GradeLevelID_Onec_fkey"
      FOREIGN KEY ("GradeLevelID_Onec") REFERENCES grade_levels(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cases_school_id_fkey') THEN
    ALTER TABLE cases ADD CONSTRAINT cases_school_id_fkey
      FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_target_school_id_fkey') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_target_school_id_fkey
      FOREIGN KEY (target_school_id) REFERENCES schools(id) ON DELETE SET NULL;
  END IF;
END $$;

-- == down ==
-- ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_target_school_id_fkey;
-- ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_school_id_fkey;
-- ALTER TABLE attendance DROP CONSTRAINT IF EXISTS "attendance_GradeLevelID_Onec_fkey";
-- ALTER TABLE attendance DROP CONSTRAINT IF EXISTS "attendance_SchoolID_Onec_fkey";
-- DROP INDEX IF EXISTS uq_attendance_person_date_period;
-- DROP INDEX IF EXISTS idx_schools_geo;
-- DROP INDEX IF EXISTS idx_tasks_type_status;
-- DROP INDEX IF EXISTS idx_tasks_target_school_id;
-- DROP INDEX IF EXISTS idx_cases_student_id;
-- (idx_cases_school_id NOT dropped — owned by AddSchoolIdToCases20260617123000)
-- DROP INDEX IF EXISTS idx_cases_status;
-- DROP INDEX IF EXISTS idx_attendance_school_date;
-- DROP INDEX IF EXISTS idx_student_term_scope;
