-- Migration: AddStudentIdToCases20260612000000
-- Links a home-visit case to a real student record (PersonID) instead of
-- relying on a free-typed name match. Exported SQL for manual/DBA application.

-- == up ==
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS student_id TEXT;

-- == down ==
-- ALTER TABLE cases
--   DROP COLUMN IF EXISTS student_id;
