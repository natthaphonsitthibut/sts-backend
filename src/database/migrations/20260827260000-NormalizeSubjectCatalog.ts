import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Merge the duplicate seeded subject catalogue into the heavily referenced
 * rows, then give every system subject the same PREFIX101 code shape.
 *
 * It runs after the classroom-subject and exception-attendance cutovers so the
 * catalogue, school catalogue, room offerings, and submitted sessions move as
 * one consistent graph. The merge is destructive and fail-closed on down.
 */
export class NormalizeSubjectCatalog20260827260000 implements MigrationInterface {
  name = 'NormalizeSubjectCatalog20260827260000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      LOCK TABLE
        subjects,
        attendance_import_files,
        attendance_sessions,
        classroom_teacher_assignments,
        curriculum_subjects,
        curriculum_subject_teachers,
        school_subjects,
        classroom_subjects,
        task_links,
        timetable_slots
      IN SHARE ROW EXCLUSIVE MODE
    `);

    await queryRunner.query(`
      CREATE TEMP TABLE sts_subject_catalog_merge ON COMMIT DROP AS
      WITH mapping(final_code, legacy_code) AS (
        VALUES
          ('TH101', 'THAI'),
          ('MATH101', 'MATH'),
          ('SCI101', 'SCI'),
          ('ENG101', 'ENG'),
          ('SOC101', 'SOC'),
          ('PE101', 'PE'),
          ('ART101', 'ART'),
          ('CAREER101', 'CAREER'),
          ('HOMEROOM101', 'HOMEROOM')
      ), resolved AS (
        SELECT
          mapping.final_code,
          mapping.legacy_code,
          final_subject.id AS final_subject_id,
          legacy_subject.id AS legacy_subject_id,
          CASE
            WHEN legacy_subject.id IS NULL THEN final_subject.id
            WHEN final_subject.id IS NULL THEN legacy_subject.id
            WHEN legacy_subject.deleted_at IS NULL AND legacy_subject.is_active
              THEN legacy_subject.id
            ELSE final_subject.id
          END AS canonical_subject_id
        FROM mapping
        LEFT JOIN subjects final_subject ON final_subject.code = mapping.final_code
        LEFT JOIN subjects legacy_subject ON legacy_subject.code = mapping.legacy_code
      )
      SELECT
        final_code,
        legacy_code,
        canonical_subject_id,
        CASE
          WHEN final_subject_id IS NOT NULL
            AND legacy_subject_id IS NOT NULL
            AND final_subject_id <> canonical_subject_id
            THEN final_subject_id
          WHEN final_subject_id IS NOT NULL
            AND legacy_subject_id IS NOT NULL
            AND legacy_subject_id <> canonical_subject_id
            THEN legacy_subject_id
          ELSE NULL
        END AS duplicate_subject_id
      FROM resolved
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM sts_subject_catalog_merge
          WHERE canonical_subject_id IS NULL
        ) THEN
          RAISE EXCEPTION
            'NormalizeSubjectCatalog: one or more required system subjects are missing';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM sts_subject_catalog_merge merge
          JOIN classroom_teacher_assignments duplicate_assignment
            ON duplicate_assignment.subject_id = merge.duplicate_subject_id
           AND duplicate_assignment.assignment_kind = 'SUBJECT'
           AND duplicate_assignment.assignment_status = 'ACTIVE'
           AND duplicate_assignment.deleted_at IS NULL
          JOIN classroom_teacher_assignments canonical_assignment
            ON canonical_assignment.subject_id = merge.canonical_subject_id
           AND canonical_assignment.classroom_id = duplicate_assignment.classroom_id
           AND canonical_assignment.teacher_membership_id = duplicate_assignment.teacher_membership_id
           AND canonical_assignment.assignment_kind = 'SUBJECT'
           AND canonical_assignment.assignment_status = 'ACTIVE'
           AND canonical_assignment.deleted_at IS NULL
        ) THEN
          RAISE EXCEPTION
            'NormalizeSubjectCatalog: active teacher assignment collision requires manual reconciliation';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM sts_subject_catalog_merge merge
          JOIN curriculum_subjects duplicate_curriculum
            ON duplicate_curriculum.subject_id = merge.duplicate_subject_id
           AND duplicate_curriculum.deleted_at IS NULL
          JOIN curriculum_subjects canonical_curriculum
            ON canonical_curriculum.subject_id = merge.canonical_subject_id
           AND canonical_curriculum.school_term_id = duplicate_curriculum.school_term_id
           AND canonical_curriculum.grade_level_id = duplicate_curriculum.grade_level_id
           AND canonical_curriculum.deleted_at IS NULL
          WHERE duplicate_curriculum.content_storage_key IS NOT NULL
             OR duplicate_curriculum.content_file_name IS NOT NULL
             OR duplicate_curriculum.content_file_size_bytes IS NOT NULL
             OR EXISTS (
               SELECT 1
               FROM curriculum_subject_teachers coverage
               WHERE coverage.curriculum_subject_id = duplicate_curriculum.id
             )
        ) THEN
          RAISE EXCEPTION
            'NormalizeSubjectCatalog: curriculum collision contains content or classroom coverage';
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DELETE FROM curriculum_subjects duplicate_curriculum
      USING sts_subject_catalog_merge merge, curriculum_subjects canonical_curriculum
      WHERE duplicate_curriculum.subject_id = merge.duplicate_subject_id
        AND duplicate_curriculum.deleted_at IS NULL
        AND canonical_curriculum.subject_id = merge.canonical_subject_id
        AND canonical_curriculum.school_term_id = duplicate_curriculum.school_term_id
        AND canonical_curriculum.grade_level_id = duplicate_curriculum.grade_level_id
        AND canonical_curriculum.deleted_at IS NULL
    `);

    await queryRunner.query(`
      CREATE TEMP TABLE sts_school_subject_catalog_merge ON COMMIT DROP AS
      SELECT
        duplicate_school_subject.id AS duplicate_school_subject_id,
        canonical_school_subject.id AS canonical_school_subject_id
      FROM sts_subject_catalog_merge merge
      JOIN school_subjects duplicate_school_subject
        ON duplicate_school_subject.subject_id = merge.duplicate_subject_id
       AND duplicate_school_subject.deleted_at IS NULL
      JOIN school_subjects canonical_school_subject
        ON canonical_school_subject.subject_id = merge.canonical_subject_id
       AND canonical_school_subject.school_id = duplicate_school_subject.school_id
       AND canonical_school_subject.deleted_at IS NULL
    `);

    await queryRunner.query(`
      CREATE TEMP TABLE sts_classroom_subject_catalog_merge ON COMMIT DROP AS
      SELECT
        duplicate_offering.id AS duplicate_classroom_subject_id,
        canonical_offering.id AS canonical_classroom_subject_id
      FROM sts_school_subject_catalog_merge merge
      JOIN classroom_subjects duplicate_offering
        ON duplicate_offering.school_subject_id = merge.duplicate_school_subject_id
       AND duplicate_offering.deleted_at IS NULL
      JOIN classroom_subjects canonical_offering
        ON canonical_offering.school_subject_id = merge.canonical_school_subject_id
       AND canonical_offering.classroom_id = duplicate_offering.classroom_id
       AND canonical_offering.deleted_at IS NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM sts_classroom_subject_catalog_merge merge
          JOIN attendance_sessions duplicate_session
            ON duplicate_session.classroom_subject_id = merge.duplicate_classroom_subject_id
           AND duplicate_session.deleted_at IS NULL
          JOIN attendance_sessions canonical_session
            ON canonical_session.classroom_subject_id = merge.canonical_classroom_subject_id
           AND canonical_session.school_term_id = duplicate_session.school_term_id
           AND canonical_session.classroom_id = duplicate_session.classroom_id
           AND canonical_session.attendance_date = duplicate_session.attendance_date
           AND canonical_session.record_storage_mode = duplicate_session.record_storage_mode
           AND canonical_session.deleted_at IS NULL
           AND (
             duplicate_session.record_storage_mode = 'EXCEPTIONS'
             OR canonical_session.period = duplicate_session.period
           )
        ) THEN
          RAISE EXCEPTION
            'NormalizeSubjectCatalog: attendance session collision requires manual reconciliation';
        END IF;
      END $$
    `);

    await queryRunner.query(`
      UPDATE attendance_sessions session
      SET classroom_subject_id = merge.canonical_classroom_subject_id
      FROM sts_classroom_subject_catalog_merge merge
      WHERE session.classroom_subject_id = merge.duplicate_classroom_subject_id
    `);

    await queryRunner.query(`
      DELETE FROM classroom_subjects duplicate_offering
      USING sts_classroom_subject_catalog_merge merge
      WHERE duplicate_offering.id = merge.duplicate_classroom_subject_id
    `);

    await queryRunner.query(`
      UPDATE classroom_subjects offering
      SET school_subject_id = merge.canonical_school_subject_id
      FROM sts_school_subject_catalog_merge merge
      WHERE offering.school_subject_id = merge.duplicate_school_subject_id
    `);

    await queryRunner.query(`
      DELETE FROM school_subjects duplicate_school_subject
      USING sts_school_subject_catalog_merge merge
      WHERE duplicate_school_subject.id = merge.duplicate_school_subject_id
    `);

    for (const table of [
      'attendance_import_files',
      'attendance_sessions',
      'classroom_teacher_assignments',
      'curriculum_subjects',
      'school_subjects',
      'task_links',
      'timetable_slots',
    ]) {
      await queryRunner.query(`
        UPDATE ${table} consumer
        SET subject_id = merge.canonical_subject_id
        FROM sts_subject_catalog_merge merge
        WHERE consumer.subject_id = merge.duplicate_subject_id
      `);
    }

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM sts_subject_catalog_merge merge
          WHERE merge.duplicate_subject_id IS NOT NULL
            AND (
              EXISTS (SELECT 1 FROM attendance_import_files row WHERE row.subject_id = merge.duplicate_subject_id)
              OR EXISTS (SELECT 1 FROM attendance_sessions row WHERE row.subject_id = merge.duplicate_subject_id)
              OR EXISTS (SELECT 1 FROM classroom_teacher_assignments row WHERE row.subject_id = merge.duplicate_subject_id)
              OR EXISTS (SELECT 1 FROM curriculum_subjects row WHERE row.subject_id = merge.duplicate_subject_id)
              OR EXISTS (SELECT 1 FROM school_subjects row WHERE row.subject_id = merge.duplicate_subject_id)
              OR EXISTS (SELECT 1 FROM task_links row WHERE row.subject_id = merge.duplicate_subject_id)
              OR EXISTS (SELECT 1 FROM timetable_slots row WHERE row.subject_id = merge.duplicate_subject_id)
            )
        ) THEN
          RAISE EXCEPTION
            'NormalizeSubjectCatalog: duplicate subject references remain after rewrite';
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DELETE FROM subjects duplicate_subject
      USING sts_subject_catalog_merge merge
      WHERE duplicate_subject.id = merge.duplicate_subject_id
    `);

    await queryRunner.query(`
      UPDATE subjects canonical_subject
      SET code = merge.final_code,
          updated_at = now()
      FROM sts_subject_catalog_merge merge
      WHERE canonical_subject.id = merge.canonical_subject_id
        AND canonical_subject.code <> merge.final_code
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM sts_subject_catalog_merge merge
          LEFT JOIN subjects subject
            ON subject.id = merge.canonical_subject_id
           AND subject.code = merge.final_code
          WHERE subject.id IS NULL
        ) OR EXISTS (
          SELECT 1
          FROM sts_subject_catalog_merge merge
          JOIN subjects subject ON subject.code = merge.legacy_code
          WHERE merge.legacy_code <> merge.final_code
        ) THEN
          RAISE EXCEPTION
            'NormalizeSubjectCatalog: final subject-code reconciliation failed';
        END IF;
      END $$
    `);
  }

  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        'NormalizeSubjectCatalog cannot be reverted safely after duplicate subject identities were merged; restore the pre-migration database backup instead',
      ),
    );
  }
}
