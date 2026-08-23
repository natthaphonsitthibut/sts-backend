import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * Replaces curriculum/timetable ownership with two explicit relations:
 * a subject offered by a school, and that offering enabled for a classroom.
 * HOMEROOM uses the same rows as every other subject. Existing classrooms are
 * backfilled here; runtime automation belongs only to classroom creation.
 */
export class AddClassroomSubjectOfferings20260827230000 implements MigrationInterface {
  name = 'AddClassroomSubjectOfferings20260827230000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE school_subjects (
        id BIGSERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        subject_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT uq_school_subjects_id_school UNIQUE (id, school_id),
        CONSTRAINT fk_school_subjects_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_school_subjects_subject
          FOREIGN KEY (subject_id) REFERENCES subjects(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_school_subjects_status
          CHECK (subject_status IN ('ACTIVE', 'INACTIVE'))
      );
      ${auditUpdatedAtTriggerSql('school_subjects')}

      CREATE UNIQUE INDEX uq_school_subjects_live_subject
        ON school_subjects (school_id, subject_id)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_school_subjects_scope
        ON school_subjects (school_id, subject_status, subject_id)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_school_subjects_subject
        ON school_subjects (subject_id, school_id)
        WHERE deleted_at IS NULL;

      CREATE TABLE classroom_subjects (
        id BIGSERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL,
        classroom_id BIGINT NOT NULL,
        school_subject_id BIGINT NOT NULL,
        offering_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT uq_classroom_subjects_id_classroom_school
          UNIQUE (id, classroom_id, school_id),
        CONSTRAINT fk_classroom_subjects_classroom
          FOREIGN KEY (classroom_id, school_id)
          REFERENCES school_classrooms(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_subjects_school_subject
          FOREIGN KEY (school_subject_id, school_id)
          REFERENCES school_subjects(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_classroom_subjects_status
          CHECK (offering_status IN ('ACTIVE', 'INACTIVE'))
      );
      ${auditUpdatedAtTriggerSql('classroom_subjects')}

      CREATE UNIQUE INDEX uq_classroom_subjects_live_offering
        ON classroom_subjects (classroom_id, school_subject_id)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_classroom_subjects_scope
        ON classroom_subjects (school_id, classroom_id, offering_status)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_classroom_subjects_school_subject
        ON classroom_subjects (school_subject_id, classroom_id)
        WHERE deleted_at IS NULL;

      ALTER TABLE school_subjects ENABLE ROW LEVEL SECURITY;
      ALTER TABLE classroom_subjects ENABLE ROW LEVEL SECURITY;
    `);

    await queryRunner.query(`
      DO $secure_subject_offering_tables$
      DECLARE
        role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
        LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON TABLE school_subjects, classroom_subjects FROM %I',
              role_name
            );
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON SEQUENCE school_subjects_id_seq, classroom_subjects_id_seq FROM %I',
              role_name
            );
          END IF;
        END LOOP;
      END;
      $secure_subject_offering_tables$;
    `);

    const invalidSources = (await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT curriculum.subject_id
        FROM curriculum_subjects curriculum
        LEFT JOIN subjects subject ON subject.id = curriculum.subject_id
        WHERE curriculum.curriculum_status = 'ACTIVE'
          AND curriculum.deleted_at IS NULL
          AND (subject.id IS NULL OR subject.deleted_at IS NOT NULL OR NOT subject.is_active)

        UNION ALL

        SELECT slot.subject_id
        FROM timetable_slots slot
        LEFT JOIN subjects subject ON subject.id = slot.subject_id
        WHERE slot.deleted_at IS NULL
          AND (subject.id IS NULL OR subject.deleted_at IS NOT NULL OR NOT subject.is_active)

        UNION ALL

        SELECT curriculum.subject_id
        FROM curriculum_subject_teachers coverage
        JOIN curriculum_subjects curriculum ON curriculum.id = coverage.curriculum_subject_id
        LEFT JOIN subjects subject ON subject.id = curriculum.subject_id
        WHERE coverage.deleted_at IS NULL
          AND curriculum.deleted_at IS NULL
          AND (subject.id IS NULL OR subject.deleted_at IS NOT NULL OR NOT subject.is_active)

        UNION ALL

        SELECT assignment.subject_id
        FROM classroom_teacher_assignments assignment
        LEFT JOIN subjects subject ON subject.id = assignment.subject_id
        WHERE assignment.assignment_kind = 'SUBJECT'
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.subject_id IS NOT NULL
          AND assignment.deleted_at IS NULL
          AND (subject.id IS NULL OR subject.deleted_at IS NOT NULL OR NOT subject.is_active)
      ) invalid
    `)) as Array<{ count: number }>;
    if (Number(invalidSources[0]?.count ?? 0) > 0) {
      throw new Error(
        'AddClassroomSubjectOfferings: active curriculum/timetable rows reference an inactive subject',
      );
    }

    await queryRunner.query(`
      WITH source_school_subjects AS (
        SELECT curriculum.school_id, curriculum.subject_id
        FROM curriculum_subjects curriculum
        WHERE curriculum.curriculum_status = 'ACTIVE'
          AND curriculum.deleted_at IS NULL

        UNION

        SELECT slot.school_id, slot.subject_id
        FROM timetable_slots slot
        WHERE slot.deleted_at IS NULL

        UNION

        SELECT coverage.school_id, curriculum.subject_id
        FROM curriculum_subject_teachers coverage
        JOIN curriculum_subjects curriculum ON curriculum.id = coverage.curriculum_subject_id
        WHERE coverage.deleted_at IS NULL
          AND curriculum.deleted_at IS NULL

        UNION

        SELECT assignment.school_id, assignment.subject_id
        FROM classroom_teacher_assignments assignment
        WHERE assignment.assignment_kind = 'SUBJECT'
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.subject_id IS NOT NULL
          AND assignment.deleted_at IS NULL

        UNION

        SELECT classroom.school_id, subject.id
        FROM school_classrooms classroom
        JOIN LATERAL (
          SELECT candidate.id
          FROM subjects candidate
          WHERE candidate.code IN ('HOMEROOM101', 'HOMEROOM')
            AND candidate.is_active
            AND candidate.deleted_at IS NULL
          ORDER BY (candidate.code = 'HOMEROOM101') DESC, candidate.id
          LIMIT 1
        ) subject ON TRUE
        WHERE classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
      )
      INSERT INTO school_subjects (
        school_id,
        subject_id,
        subject_status,
        created_by,
        updated_by
      )
      SELECT source.school_id, source.subject_id, 'ACTIVE', NULL, NULL
      FROM source_school_subjects source
      ON CONFLICT (school_id, subject_id) WHERE deleted_at IS NULL
      DO UPDATE SET
        subject_status = 'ACTIVE',
        deleted_at = NULL,
        deleted_by = NULL,
        updated_by = NULL
    `);

    await queryRunner.query(`
      WITH source_classroom_subjects AS (
        SELECT classroom.id AS classroom_id, curriculum.subject_id
        FROM curriculum_subjects curriculum
        JOIN school_classrooms classroom
          ON classroom.school_term_id = curriculum.school_term_id
         AND classroom.school_id = curriculum.school_id
         AND classroom.grade_level_id = curriculum.grade_level_id
         AND classroom.classroom_status = 'ACTIVE'
         AND classroom.deleted_at IS NULL
        WHERE curriculum.curriculum_status = 'ACTIVE'
          AND curriculum.deleted_at IS NULL

        UNION

        SELECT coverage.classroom_id, curriculum.subject_id
        FROM curriculum_subject_teachers coverage
        JOIN curriculum_subjects curriculum ON curriculum.id = coverage.curriculum_subject_id
        WHERE coverage.deleted_at IS NULL
          AND curriculum.deleted_at IS NULL

        UNION

        SELECT slot.classroom_id, slot.subject_id
        FROM timetable_slots slot
        WHERE slot.deleted_at IS NULL

        UNION

        SELECT assignment.classroom_id, assignment.subject_id
        FROM classroom_teacher_assignments assignment
        WHERE assignment.assignment_kind = 'SUBJECT'
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.subject_id IS NOT NULL
          AND assignment.deleted_at IS NULL

        UNION

        SELECT classroom.id, subject.id
        FROM school_classrooms classroom
        JOIN LATERAL (
          SELECT candidate.id
          FROM subjects candidate
          WHERE candidate.code IN ('HOMEROOM101', 'HOMEROOM')
            AND candidate.is_active
            AND candidate.deleted_at IS NULL
          ORDER BY (candidate.code = 'HOMEROOM101') DESC, candidate.id
          LIMIT 1
        ) subject ON TRUE
        WHERE classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
      )
      INSERT INTO classroom_subjects (
        school_id,
        classroom_id,
        school_subject_id,
        offering_status,
        created_by,
        updated_by
      )
      SELECT
        classroom.school_id,
        source.classroom_id,
        school_subject.id,
        'ACTIVE',
        NULL,
        NULL
      FROM source_classroom_subjects source
      JOIN school_classrooms classroom ON classroom.id = source.classroom_id
      JOIN school_subjects school_subject
        ON school_subject.school_id = classroom.school_id
       AND school_subject.subject_id = source.subject_id
       AND school_subject.subject_status = 'ACTIVE'
       AND school_subject.deleted_at IS NULL
      ON CONFLICT (classroom_id, school_subject_id) WHERE deleted_at IS NULL
      DO UPDATE SET
        offering_status = 'ACTIVE',
        deleted_at = NULL,
        deleted_by = NULL,
        updated_by = NULL
    `);

    const reconciliation = (await queryRunner.query(`
      WITH source_classroom_subjects AS (
        SELECT classroom.id AS classroom_id, curriculum.subject_id
        FROM curriculum_subjects curriculum
        JOIN school_classrooms classroom
          ON classroom.school_term_id = curriculum.school_term_id
         AND classroom.school_id = curriculum.school_id
         AND classroom.grade_level_id = curriculum.grade_level_id
         AND classroom.classroom_status = 'ACTIVE'
         AND classroom.deleted_at IS NULL
        WHERE curriculum.curriculum_status = 'ACTIVE'
          AND curriculum.deleted_at IS NULL
        UNION
        SELECT coverage.classroom_id, curriculum.subject_id
        FROM curriculum_subject_teachers coverage
        JOIN curriculum_subjects curriculum ON curriculum.id = coverage.curriculum_subject_id
        WHERE coverage.deleted_at IS NULL
          AND curriculum.deleted_at IS NULL
        UNION
        SELECT slot.classroom_id, slot.subject_id
        FROM timetable_slots slot WHERE slot.deleted_at IS NULL
        UNION
        SELECT assignment.classroom_id, assignment.subject_id
        FROM classroom_teacher_assignments assignment
        WHERE assignment.assignment_kind = 'SUBJECT'
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.subject_id IS NOT NULL
          AND assignment.deleted_at IS NULL
        UNION
        SELECT classroom.id, subject.id
        FROM school_classrooms classroom
        JOIN LATERAL (
          SELECT candidate.id
          FROM subjects candidate
          WHERE candidate.code IN ('HOMEROOM101', 'HOMEROOM')
            AND candidate.is_active
            AND candidate.deleted_at IS NULL
          ORDER BY (candidate.code = 'HOMEROOM101') DESC, candidate.id
          LIMIT 1
        ) subject ON TRUE
        WHERE classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
      ), target AS (
        SELECT offering.classroom_id, school_subject.subject_id
        FROM classroom_subjects offering
        JOIN school_subjects school_subject ON school_subject.id = offering.school_subject_id
        WHERE offering.offering_status = 'ACTIVE'
          AND offering.deleted_at IS NULL
          AND school_subject.subject_status = 'ACTIVE'
          AND school_subject.deleted_at IS NULL
      ), missing AS (
        SELECT source.*
        FROM source_classroom_subjects source
        LEFT JOIN target
          ON target.classroom_id = source.classroom_id
         AND target.subject_id = source.subject_id
        WHERE target.classroom_id IS NULL
      ), invalid_homeroom AS (
        SELECT classroom.id
        FROM school_classrooms classroom
        LEFT JOIN target
          ON target.classroom_id = classroom.id
        LEFT JOIN subjects subject
          ON subject.id = target.subject_id
         AND subject.code IN ('HOMEROOM101', 'HOMEROOM')
        WHERE classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
        GROUP BY classroom.id
        HAVING COUNT(subject.id) <> 1
      )
      SELECT
        (SELECT COUNT(*)::int FROM missing) AS missing_count,
        (SELECT COUNT(*)::int FROM invalid_homeroom) AS invalid_homeroom_count
    `)) as Array<{ missing_count: number; invalid_homeroom_count: number }>;
    const result = reconciliation[0];
    if (
      Number(result?.missing_count ?? 0) !== 0 ||
      Number(result?.invalid_homeroom_count ?? 0) !== 0
    ) {
      throw new Error(
        `AddClassroomSubjectOfferings: reconciliation failed ` +
          `(missing=${Number(result?.missing_count ?? -1)}, ` +
          `invalid_homeroom=${Number(result?.invalid_homeroom_count ?? -1)})`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $guard_subject_offering_rollback$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'attendance_sessions'
            AND column_name = 'classroom_subject_id'
        ) THEN
          RAISE EXCEPTION
            'Refusing rollback: attendance_sessions still consumes classroom_subjects';
        END IF;

        IF EXISTS (
          WITH derivable AS (
            SELECT classroom.id AS classroom_id, curriculum.subject_id
            FROM curriculum_subjects curriculum
            JOIN school_classrooms classroom
              ON classroom.school_term_id = curriculum.school_term_id
             AND classroom.school_id = curriculum.school_id
             AND classroom.grade_level_id = curriculum.grade_level_id
             AND classroom.classroom_status = 'ACTIVE'
             AND classroom.deleted_at IS NULL
            WHERE curriculum.curriculum_status = 'ACTIVE'
              AND curriculum.deleted_at IS NULL
            UNION
            SELECT coverage.classroom_id, curriculum.subject_id
            FROM curriculum_subject_teachers coverage
            JOIN curriculum_subjects curriculum ON curriculum.id = coverage.curriculum_subject_id
            WHERE coverage.deleted_at IS NULL AND curriculum.deleted_at IS NULL
            UNION
            SELECT classroom_id, subject_id FROM timetable_slots WHERE deleted_at IS NULL
            UNION
            SELECT classroom_id, subject_id
            FROM classroom_teacher_assignments
            WHERE assignment_kind = 'SUBJECT'
              AND assignment_status = 'ACTIVE'
              AND subject_id IS NOT NULL
              AND deleted_at IS NULL
            UNION
            SELECT classroom.id, subject.id
            FROM school_classrooms classroom
            JOIN LATERAL (
              SELECT candidate.id
              FROM subjects candidate
              WHERE candidate.code IN ('HOMEROOM101', 'HOMEROOM')
                AND candidate.is_active
                AND candidate.deleted_at IS NULL
              ORDER BY (candidate.code = 'HOMEROOM101') DESC, candidate.id
              LIMIT 1
            ) subject ON TRUE
            WHERE classroom.classroom_status = 'ACTIVE'
              AND classroom.deleted_at IS NULL
          ), target AS (
            SELECT offering.classroom_id, school_subject.subject_id
            FROM classroom_subjects offering
            JOIN school_subjects school_subject ON school_subject.id = offering.school_subject_id
            WHERE offering.offering_status = 'ACTIVE'
              AND offering.deleted_at IS NULL
              AND school_subject.subject_status = 'ACTIVE'
              AND school_subject.deleted_at IS NULL
          )
          SELECT target.*
          FROM target
          LEFT JOIN derivable
            ON derivable.classroom_id = target.classroom_id
           AND derivable.subject_id = target.subject_id
          WHERE derivable.classroom_id IS NULL
        ) THEN
          RAISE EXCEPTION
            'Refusing rollback: classroom_subjects contains target-only consumer data';
        END IF;
      END;
      $guard_subject_offering_rollback$;

      DROP TABLE classroom_subjects;
      DROP TABLE school_subjects;
    `);
  }
}
