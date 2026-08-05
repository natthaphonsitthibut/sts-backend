import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const STRUCTURE_PERMISSION = 'manage-school-structure';
const ROSTER_IMPORT_PERMISSION = 'import-school-roster';
const DEFAULT_ROLES = ['ADMIN', 'DIRECTOR'] as const;

export class AddSchoolOwnedStructure20260714190000 implements MigrationInterface {
  name = 'AddSchoolOwnedStructure20260714190000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_import_batches
        DROP CONSTRAINT chk_student_import_batches_target;
      ALTER TABLE student_import_batches
        ADD CONSTRAINT chk_student_import_batches_target
          CHECK (target IN ('student_term', 'student_dropouts', 'school_teacher_membership'));

      INSERT INTO student_import_quarantine_reason_codes (code, label_th, sort_order)
      VALUES
        ('BLANK_TEACHER_USERNAME', 'ไม่มีชื่อผู้ใช้ครู', 130),
        ('DUPLICATE_TEACHER_ROW', 'บัญชีครูซ้ำในไฟล์', 140),
        ('TEACHER_ACCOUNT_NOT_FOUND', 'ไม่พบบัญชีครูในระบบ', 150),
        ('INVALID_TEACHER_PERMISSION', 'บัญชีไม่มีสิทธิ์ปฏิบัติงานครู', 160),
        ('INVALID_TEACHER_START_DATE', 'วันที่เริ่มปฏิบัติงานไม่ถูกต้อง', 170)
      ON CONFLICT (code) DO UPDATE
      SET label_th = EXCLUDED.label_th,
          sort_order = EXCLUDED.sort_order;
    `);

    await queryRunner.query(`
      ALTER TABLE school_terms
        ADD CONSTRAINT uq_school_terms_id_school UNIQUE (id, school_id);

      CREATE TABLE school_classrooms (
        id BIGSERIAL PRIMARY KEY,
        school_term_id BIGINT NOT NULL,
        school_id INTEGER NOT NULL,
        grade_level_id INTEGER NOT NULL,
        legacy_room_number INTEGER,
        room_code VARCHAR(32) NOT NULL,
        room_name VARCHAR(120),
        classroom_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT uq_school_classrooms_identity
          UNIQUE (id, school_term_id, school_id, grade_level_id, legacy_room_number),
        CONSTRAINT uq_school_classrooms_id_school UNIQUE (id, school_id),
        CONSTRAINT fk_school_classrooms_term_school
          FOREIGN KEY (school_term_id, school_id)
          REFERENCES school_terms(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_school_classrooms_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_school_classrooms_grade
          FOREIGN KEY (grade_level_id) REFERENCES grade_levels(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_school_classrooms_room_code
          CHECK (length(trim(room_code)) > 0),
        CONSTRAINT chk_school_classrooms_legacy_room
          CHECK (legacy_room_number IS NULL OR legacy_room_number > 0),
        CONSTRAINT chk_school_classrooms_status
          CHECK (classroom_status IN ('ACTIVE', 'INACTIVE'))
      );
      ${auditUpdatedAtTriggerSql('school_classrooms')}

      CREATE UNIQUE INDEX uq_school_classrooms_term_grade_code
        ON school_classrooms (school_term_id, grade_level_id, lower(room_code))
        WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_school_classrooms_term_grade_legacy_room
        ON school_classrooms (school_term_id, grade_level_id, legacy_room_number)
        WHERE deleted_at IS NULL AND legacy_room_number IS NOT NULL;
      CREATE INDEX idx_school_classrooms_scope
        ON school_classrooms (school_id, classroom_status, school_term_id, grade_level_id)
        WHERE deleted_at IS NULL;

      CREATE TABLE school_teacher_memberships (
        id BIGSERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL,
        teacher_user_id INTEGER NOT NULL,
        membership_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        started_on DATE NOT NULL DEFAULT CURRENT_DATE,
        ended_on DATE,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT uq_school_teacher_memberships_id_school UNIQUE (id, school_id),
        CONSTRAINT fk_school_teacher_memberships_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_school_teacher_memberships_user
          FOREIGN KEY (teacher_user_id) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_school_teacher_memberships_status
          CHECK (membership_status IN ('ACTIVE', 'INACTIVE')),
        CONSTRAINT chk_school_teacher_memberships_dates
          CHECK (ended_on IS NULL OR ended_on >= started_on)
      );
      ${auditUpdatedAtTriggerSql('school_teacher_memberships')}

      CREATE UNIQUE INDEX uq_school_teacher_memberships_active
        ON school_teacher_memberships (school_id, teacher_user_id)
        WHERE membership_status = 'ACTIVE' AND deleted_at IS NULL;
      CREATE INDEX idx_school_teacher_memberships_scope
        ON school_teacher_memberships (school_id, membership_status, teacher_user_id)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_school_teacher_memberships_teacher
        ON school_teacher_memberships (teacher_user_id, membership_status)
        WHERE deleted_at IS NULL;

      CREATE TABLE classroom_teacher_assignments (
        id BIGSERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL,
        classroom_id BIGINT NOT NULL,
        teacher_membership_id BIGINT NOT NULL,
        subject_id INTEGER,
        assignment_kind VARCHAR(16) NOT NULL,
        assignment_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        effective_on DATE,
        effective_until DATE,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT fk_classroom_teacher_assignments_classroom
          FOREIGN KEY (classroom_id, school_id)
          REFERENCES school_classrooms(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_teacher_assignments_membership
          FOREIGN KEY (teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_teacher_assignments_subject
          FOREIGN KEY (subject_id) REFERENCES subjects(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_classroom_teacher_assignments_kind
          CHECK (assignment_kind IN ('HOMEROOM', 'SUBJECT')),
        CONSTRAINT chk_classroom_teacher_assignments_subject
          CHECK (
            (assignment_kind = 'HOMEROOM' AND subject_id IS NULL)
            OR (assignment_kind = 'SUBJECT' AND subject_id IS NOT NULL)
          ),
        CONSTRAINT chk_classroom_teacher_assignments_status
          CHECK (assignment_status IN ('ACTIVE', 'INACTIVE')),
        CONSTRAINT chk_classroom_teacher_assignments_dates
          CHECK (
            effective_until IS NULL
            OR effective_on IS NULL
            OR effective_until >= effective_on
          )
      );
      ${auditUpdatedAtTriggerSql('classroom_teacher_assignments')}

      CREATE UNIQUE INDEX uq_classroom_teacher_assignments_homeroom
        ON classroom_teacher_assignments (classroom_id)
        WHERE assignment_kind = 'HOMEROOM'
          AND assignment_status = 'ACTIVE'
          AND deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_classroom_teacher_assignments_subject
        ON classroom_teacher_assignments (classroom_id, teacher_membership_id, subject_id)
        WHERE assignment_kind = 'SUBJECT'
          AND assignment_status = 'ACTIVE'
          AND deleted_at IS NULL;
      CREATE INDEX idx_classroom_teacher_assignments_classroom
        ON classroom_teacher_assignments (classroom_id, assignment_status)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_classroom_teacher_assignments_teacher
        ON classroom_teacher_assignments (teacher_membership_id, assignment_status)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_classroom_teacher_assignments_subject
        ON classroom_teacher_assignments (subject_id, assignment_status)
        WHERE deleted_at IS NULL AND subject_id IS NOT NULL;

      CREATE TABLE school_structure_backfill_issues (
        id BIGSERIAL PRIMARY KEY,
        student_uuid UUID NOT NULL,
        reason_code VARCHAR(32) NOT NULL,
        legacy_school_id INTEGER,
        legacy_academic_year INTEGER,
        legacy_semester INTEGER,
        legacy_grade_level_id INTEGER,
        legacy_room_number INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_school_structure_backfill_issue_enrollment
          FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT uq_school_structure_backfill_issue UNIQUE (student_uuid, reason_code),
        CONSTRAINT chk_school_structure_backfill_issue_reason
          CHECK (reason_code IN ('TERM_NOT_FOUND', 'GRADE_NOT_FOUND', 'INVALID_ROOM'))
      );
      CREATE INDEX idx_school_structure_backfill_issues_reason
        ON school_structure_backfill_issues (reason_code, created_at);
    `);

    await queryRunner.query(`
      INSERT INTO school_structure_backfill_issues (
        student_uuid,
        reason_code,
        legacy_school_id,
        legacy_academic_year,
        legacy_semester,
        legacy_grade_level_id,
        legacy_room_number
      )
      SELECT
        enrollment.student_uuid,
        CASE
          WHEN term.id IS NULL THEN 'TERM_NOT_FOUND'
          WHEN grade.id IS NULL THEN 'GRADE_NOT_FOUND'
          ELSE 'INVALID_ROOM'
        END,
        enrollment."SchoolID_Onec",
        enrollment."AcademicYear_Onec",
        enrollment."Semester_Onec",
        enrollment."GradeLevelID_Onec",
        enrollment."RoomID_Onec"
      FROM student_term enrollment
      LEFT JOIN school_terms term
        ON term.school_id = enrollment."SchoolID_Onec"
       AND term.academic_year = enrollment."AcademicYear_Onec"
       AND term.semester = enrollment."Semester_Onec"
       AND term.deleted_at IS NULL
      LEFT JOIN grade_levels grade ON grade.id = enrollment."GradeLevelID_Onec"
      WHERE enrollment.deleted_at IS NULL
        AND (
          term.id IS NULL
          OR grade.id IS NULL
          OR enrollment."RoomID_Onec" IS NULL
          OR enrollment."RoomID_Onec" <= 0
        )
      ON CONFLICT (student_uuid, reason_code) DO NOTHING;

      WITH classroom_keys AS (
        SELECT DISTINCT
          term.id AS school_term_id,
          term.school_id,
          enrollment."GradeLevelID_Onec" AS grade_level_id,
          enrollment."RoomID_Onec" AS room_number
        FROM student_term enrollment
        JOIN school_terms term
          ON term.school_id = enrollment."SchoolID_Onec"
         AND term.academic_year = enrollment."AcademicYear_Onec"
         AND term.semester = enrollment."Semester_Onec"
         AND term.deleted_at IS NULL
        JOIN grade_levels grade ON grade.id = enrollment."GradeLevelID_Onec"
        WHERE enrollment.deleted_at IS NULL
          AND enrollment."RoomID_Onec" > 0
        UNION
        SELECT DISTINCT
          slot.school_term_id,
          slot.school_id,
          slot.grade_level_id,
          slot.room_no
        FROM timetable_slots slot
        WHERE slot.room_no > 0
      )
      INSERT INTO school_classrooms (
        school_term_id,
        school_id,
        grade_level_id,
        legacy_room_number,
        room_code,
        classroom_status
      )
      SELECT
        school_term_id,
        school_id,
        grade_level_id,
        room_number,
        room_number::text,
        'ACTIVE'
      FROM classroom_keys
      ON CONFLICT DO NOTHING;
    `);

    await queryRunner.query(`
      ALTER TABLE student_term
        ADD COLUMN school_term_id BIGINT,
        ADD COLUMN classroom_id BIGINT;

      UPDATE student_term enrollment
      SET school_term_id = term.id,
          classroom_id = classroom.id
      FROM school_terms term
      JOIN school_classrooms classroom
        ON classroom.school_term_id = term.id
       AND classroom.school_id = term.school_id
       AND classroom.deleted_at IS NULL
      WHERE enrollment.deleted_at IS NULL
        AND term.school_id = enrollment."SchoolID_Onec"
        AND term.academic_year = enrollment."AcademicYear_Onec"
        AND term.semester = enrollment."Semester_Onec"
        AND classroom.grade_level_id = enrollment."GradeLevelID_Onec"
        AND classroom.legacy_room_number = enrollment."RoomID_Onec";

      ALTER TABLE student_term
        ADD CONSTRAINT fk_student_term_school_term_school
          FOREIGN KEY (school_term_id, "SchoolID_Onec")
          REFERENCES school_terms(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT fk_student_term_classroom_identity
          FOREIGN KEY (
            classroom_id,
            school_term_id,
            "SchoolID_Onec",
            "GradeLevelID_Onec",
            "RoomID_Onec"
          )
          REFERENCES school_classrooms(
            id,
            school_term_id,
            school_id,
            grade_level_id,
            legacy_room_number
          )
          ON DELETE RESTRICT ON UPDATE CASCADE;

      CREATE INDEX idx_student_term_school_term
        ON student_term (school_term_id, classroom_id)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_student_term_classroom
        ON student_term (classroom_id, person_uuid)
        WHERE deleted_at IS NULL AND classroom_id IS NOT NULL;

      ALTER TABLE timetable_slots ADD COLUMN classroom_id BIGINT;

      UPDATE timetable_slots slot
      SET classroom_id = classroom.id
      FROM school_classrooms classroom
      WHERE classroom.deleted_at IS NULL
        AND classroom.school_term_id = slot.school_term_id
        AND classroom.school_id = slot.school_id
        AND classroom.grade_level_id = slot.grade_level_id
        AND classroom.legacy_room_number = slot.room_no;

      ALTER TABLE timetable_slots ALTER COLUMN classroom_id SET NOT NULL;
      ALTER TABLE timetable_slots
        ADD CONSTRAINT fk_timetable_slots_classroom_identity
          FOREIGN KEY (
            classroom_id,
            school_term_id,
            school_id,
            grade_level_id,
            room_no
          )
          REFERENCES school_classrooms(
            id,
            school_term_id,
            school_id,
            grade_level_id,
            legacy_room_number
          )
          ON DELETE RESTRICT ON UPDATE CASCADE;
      CREATE INDEX idx_timetable_slots_classroom
        ON timetable_slots (classroom_id, day_of_week, period)
        WHERE deleted_at IS NULL;

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

      CREATE TRIGGER trg_student_term_resolve_structure_refs
        BEFORE INSERT OR UPDATE OF
          "SchoolID_Onec",
          "AcademicYear_Onec",
          "Semester_Onec",
          "GradeLevelID_Onec",
          "RoomID_Onec"
        ON student_term
        FOR EACH ROW EXECUTE FUNCTION resolve_student_term_structure_refs();

      CREATE OR REPLACE FUNCTION resolve_timetable_slot_classroom()
      RETURNS trigger AS $$
      BEGIN
        SELECT classroom.id
        INTO NEW.classroom_id
        FROM school_classrooms classroom
        WHERE classroom.school_term_id = NEW.school_term_id
          AND classroom.school_id = NEW.school_id
          AND classroom.grade_level_id = NEW.grade_level_id
          AND classroom.legacy_room_number = NEW.room_no
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
        LIMIT 1;

        IF NEW.classroom_id IS NULL THEN
          RAISE EXCEPTION 'classroom is not configured for this timetable slot'
            USING ERRCODE = '23503';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_timetable_slots_resolve_classroom
        BEFORE INSERT OR UPDATE OF school_term_id, school_id, grade_level_id, room_no
        ON timetable_slots
        FOR EACH ROW EXECUTE FUNCTION resolve_timetable_slot_classroom();
    `);

    await queryRunner.query(`
      INSERT INTO school_teacher_memberships (
        school_id,
        teacher_user_id,
        membership_status,
        started_on
      )
      SELECT DISTINCT slot.school_id, slot.teacher_user_id, 'ACTIVE', CURRENT_DATE
      FROM timetable_slots slot
      WHERE slot.deleted_at IS NULL
        AND slot.teacher_user_id IS NOT NULL
      ON CONFLICT DO NOTHING;

      INSERT INTO classroom_teacher_assignments (
        school_id,
        classroom_id,
        teacher_membership_id,
        subject_id,
        assignment_kind,
        assignment_status
      )
      SELECT DISTINCT
        slot.school_id,
        slot.classroom_id,
        membership.id,
        slot.subject_id,
        'SUBJECT',
        'ACTIVE'
      FROM timetable_slots slot
      JOIN school_teacher_memberships membership
        ON membership.school_id = slot.school_id
       AND membership.teacher_user_id = slot.teacher_user_id
       AND membership.membership_status = 'ACTIVE'
       AND membership.deleted_at IS NULL
      WHERE slot.deleted_at IS NULL
        AND slot.teacher_user_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    `);

    for (const permission of [STRUCTURE_PERMISSION, ROSTER_IMPORT_PERMISSION]) {
      await queryRunner.query(
        `
          UPDATE roles
          SET default_permissions = default_permissions || $1::jsonb
          WHERE name = ANY($2::text[])
            AND NOT (default_permissions ? $3)
        `,
        [JSON.stringify([permission]), DEFAULT_ROLES, permission],
      );
    }

    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE jsonb_typeof(permissions) = 'array'
          AND permissions ? 'manage-attendance-calendar'
          AND NOT (permissions ? $2)
      `,
      [JSON.stringify([STRUCTURE_PERMISSION]), STRUCTURE_PERMISSION],
    );
    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE jsonb_typeof(permissions) = 'array'
          AND permissions ? 'import-data'
          AND NOT (permissions ? $2)
      `,
      [JSON.stringify([ROSTER_IMPORT_PERMISSION]), ROSTER_IMPORT_PERMISSION],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM student_import_quarantine_rows quarantine
      USING student_import_batches batch
      WHERE quarantine.batch_id = batch.id
        AND batch.target = 'school_teacher_membership';
      DELETE FROM student_import_batches WHERE target = 'school_teacher_membership';
      DELETE FROM student_import_quarantine_reason_codes
      WHERE code IN (
        'BLANK_TEACHER_USERNAME',
        'DUPLICATE_TEACHER_ROW',
        'TEACHER_ACCOUNT_NOT_FOUND',
        'INVALID_TEACHER_PERMISSION',
        'INVALID_TEACHER_START_DATE'
      );
      ALTER TABLE student_import_batches
        DROP CONSTRAINT chk_student_import_batches_target;
      ALTER TABLE student_import_batches
        ADD CONSTRAINT chk_student_import_batches_target
          CHECK (target IN ('student_term', 'student_dropouts'));
    `);

    await queryRunner.query(`UPDATE users SET permissions = permissions - $1 - $2`, [
      STRUCTURE_PERMISSION,
      ROSTER_IMPORT_PERMISSION,
    ]);
    await queryRunner.query(
      `UPDATE roles SET default_permissions = default_permissions - $1 - $2`,
      [STRUCTURE_PERMISSION, ROSTER_IMPORT_PERMISSION],
    );

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_timetable_slots_resolve_classroom ON timetable_slots;
      DROP FUNCTION IF EXISTS resolve_timetable_slot_classroom;
      DROP TRIGGER IF EXISTS trg_student_term_resolve_structure_refs ON student_term;
      DROP FUNCTION IF EXISTS resolve_student_term_structure_refs;

      DROP INDEX IF EXISTS idx_timetable_slots_classroom;
      ALTER TABLE timetable_slots
        DROP CONSTRAINT IF EXISTS fk_timetable_slots_classroom_identity;
      ALTER TABLE timetable_slots DROP COLUMN IF EXISTS classroom_id;

      DROP INDEX IF EXISTS idx_student_term_classroom;
      DROP INDEX IF EXISTS idx_student_term_school_term;
      ALTER TABLE student_term
        DROP CONSTRAINT IF EXISTS fk_student_term_classroom_identity,
        DROP CONSTRAINT IF EXISTS fk_student_term_school_term_school;
      ALTER TABLE student_term
        DROP COLUMN IF EXISTS classroom_id,
        DROP COLUMN IF EXISTS school_term_id;

      DROP TABLE IF EXISTS school_structure_backfill_issues;

      DROP TRIGGER IF EXISTS trg_classroom_teacher_assignments_set_updated_at
        ON classroom_teacher_assignments;
      DROP TABLE IF EXISTS classroom_teacher_assignments;

      DROP TRIGGER IF EXISTS trg_school_teacher_memberships_set_updated_at
        ON school_teacher_memberships;
      DROP TABLE IF EXISTS school_teacher_memberships;

      DROP TRIGGER IF EXISTS trg_school_classrooms_set_updated_at ON school_classrooms;
      DROP TABLE IF EXISTS school_classrooms;

      ALTER TABLE school_terms DROP CONSTRAINT IF EXISTS uq_school_terms_id_school;
    `);
  }
}
