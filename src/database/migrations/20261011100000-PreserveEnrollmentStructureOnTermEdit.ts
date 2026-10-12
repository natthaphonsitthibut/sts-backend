import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PreserveEnrollmentStructureOnTermEdit20261011100000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION resolve_student_term_structure_refs()
  RETURNS trigger AS $$
  BEGIN
    IF TG_OP = 'UPDATE'
      AND NEW."SchoolID_Onec" IS NOT DISTINCT FROM OLD."SchoolID_Onec"
      AND NEW."GradeLevelID_Onec" IS NOT DISTINCT FROM OLD."GradeLevelID_Onec"
      AND NEW."RoomID_Onec" IS NOT DISTINCT FROM OLD."RoomID_Onec"
      AND NEW.school_term_id IS NOT DISTINCT FROM OLD.school_term_id
      AND NEW.classroom_id IS NOT DISTINCT FROM OLD.classroom_id
      AND EXISTS (
        SELECT 1 FROM school_terms term
        JOIN school_classrooms classroom
          ON classroom.id = OLD.classroom_id
         AND classroom.school_term_id = term.id
         AND classroom.school_id = term.school_id
         AND classroom.grade_level_id = NEW."GradeLevelID_Onec"
         AND classroom.legacy_room_number = NEW."RoomID_Onec"
        WHERE term.id = OLD.school_term_id
          AND term.school_id = NEW."SchoolID_Onec"
          AND term.academic_year = NEW."AcademicYear_Onec"
          AND term.semester = NEW."Semester_Onec"
      ) THEN
      -- Retain the validated historical FK when its master term is relabelled.
      NEW.school_term_id := OLD.school_term_id;
      NEW.classroom_id := OLD.classroom_id;
      RETURN NEW;
    END IF;
    SELECT term.id
    INTO NEW.school_term_id
    FROM school_terms term
    WHERE term.school_id = NEW."SchoolID_Onec"
      AND term.academic_year = NEW."AcademicYear_Onec"
      AND term.semester = NEW."Semester_Onec"
      AND term.deleted_at IS NULL
    LIMIT 1
    FOR KEY SHARE;
    IF NEW.school_term_id IS NULL THEN
      RAISE EXCEPTION 'school term is not configured for this enrollment'
        USING ERRCODE = '23503';
    END IF;
    SELECT classroom.id
    INTO NEW.classroom_id
    FROM school_classrooms classroom
    WHERE classroom.school_term_id = NEW.school_term_id
      AND classroom.school_id = NEW."SchoolID_Onec"
      AND classroom.grade_level_id = NEW."GradeLevelID_Onec"
      AND classroom.legacy_room_number = NEW."RoomID_Onec"
      AND classroom.classroom_status = 'ACTIVE'
      AND classroom.deleted_at IS NULL
    LIMIT 1;
    IF NEW.classroom_id IS NULL THEN
      RAISE EXCEPTION 'classroom is not configured for this enrollment'
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION resolve_student_term_structure_refs()
  RETURNS trigger AS $$
  BEGIN
    SELECT term.id
    INTO NEW.school_term_id
    FROM school_terms term
    WHERE term.school_id = NEW."SchoolID_Onec"
      AND term.academic_year = NEW."AcademicYear_Onec"
      AND term.semester = NEW."Semester_Onec"
      AND term.deleted_at IS NULL
    LIMIT 1;
    IF NEW.school_term_id IS NULL THEN
      RAISE EXCEPTION 'school term is not configured for this enrollment'
        USING ERRCODE = '23503';
    END IF;
    SELECT classroom.id
    INTO NEW.classroom_id
    FROM school_classrooms classroom
    WHERE classroom.school_term_id = NEW.school_term_id
      AND classroom.school_id = NEW."SchoolID_Onec"
      AND classroom.grade_level_id = NEW."GradeLevelID_Onec"
      AND classroom.legacy_room_number = NEW."RoomID_Onec"
      AND classroom.classroom_status = 'ACTIVE'
      AND classroom.deleted_at IS NULL
    LIMIT 1;
    IF NEW.classroom_id IS NULL THEN
      RAISE EXCEPTION 'classroom is not configured for this enrollment'
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
    `);
  }
}
