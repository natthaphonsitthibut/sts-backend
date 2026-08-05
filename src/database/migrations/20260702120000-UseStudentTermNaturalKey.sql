-- UP: fail before changing constraints if legacy data cannot satisfy the key.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM student_term
    WHERE person_uuid IS NULL
       OR "AcademicYear_Onec" IS NULL
       OR "Semester_Onec" IS NULL
       OR "SchoolID_Onec" IS NULL
  ) THEN
    RAISE EXCEPTION 'student_term contains incomplete enrollment natural keys';
  END IF;
  IF EXISTS (
    SELECT 1 FROM student_term
    GROUP BY person_uuid, "AcademicYear_Onec", "Semester_Onec", "SchoolID_Onec"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'student_term contains duplicate enrollment natural keys';
  END IF;
END $$;

ALTER TABLE student_term
  ALTER COLUMN person_uuid SET NOT NULL,
  ALTER COLUMN "AcademicYear_Onec" SET NOT NULL,
  ALTER COLUMN "Semester_Onec" SET NOT NULL,
  ALTER COLUMN "SchoolID_Onec" SET NOT NULL;

ALTER TABLE student_term DROP CONSTRAINT IF EXISTS fk_student_term_school;
ALTER TABLE student_term
  ADD CONSTRAINT fk_student_term_school
  FOREIGN KEY ("SchoolID_Onec") REFERENCES schools(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE student_term
  ADD CONSTRAINT uq_student_term_enrollment_natural
  UNIQUE (person_uuid, "AcademicYear_Onec", "Semester_Onec", "SchoolID_Onec");
ALTER TABLE student_term DROP CONSTRAINT IF EXISTS uq_student_term_personid;

-- DOWN is intentionally fail-closed when multi-term history already exists.
-- Restore uq_student_term_personid first, then drop the natural key and NOT NULLs.
