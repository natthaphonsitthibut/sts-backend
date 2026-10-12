import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The same characters `CreateSubjectDto` accepts: Thai consonants, vowels and
 * marks, ASCII letters and digits — no spaces or punctuation.
 */
const SUBJECT_CODE_PATTERN = String.raw`^[ก-ฮA-Za-z0-9ะ-ฺเ-ๅ็-๎]+$`;

/**
 * Subject codes and names were limited at the API only (2026-09-30), after a
 * test subject coded `@#$%` had already been saved. Removes that one subject
 * and makes the table itself refuse what the API refuses.
 */
export class EnforceSubjectCodeRule20261012100000 implements MigrationInterface {
  name = 'EnforceSubjectCodeRule20261012100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The known test subject, and only while nothing was ever taught or checked
    // under it: its three classroom assignments go with it.
    await queryRunner.query(`
      DO $$
      DECLARE
        test_subject_id INTEGER;
      BEGIN
        SELECT id INTO test_subject_id FROM subjects
        WHERE code = '@#$%' AND name_th = 'test subject';
        IF test_subject_id IS NULL THEN
          RETURN;
        END IF;
        IF EXISTS (SELECT 1 FROM task_links WHERE subject_id = test_subject_id)
          OR EXISTS (
            SELECT 1
            FROM classroom_subjects classroom_subject
            JOIN school_subjects school_subject
              ON school_subject.id = classroom_subject.school_subject_id
            WHERE school_subject.subject_id = test_subject_id
              AND (
                EXISTS (
                  SELECT 1 FROM classroom_subject_teachers teacher
                  WHERE teacher.classroom_subject_id = classroom_subject.id
                )
                OR EXISTS (
                  SELECT 1 FROM classroom_attendance_links link
                  WHERE link.assigned_classroom_subject_id = classroom_subject.id
                )
                OR EXISTS (
                  SELECT 1 FROM attendance_sessions session
                  WHERE session.classroom_subject_id = classroom_subject.id
                )
              )
          )
        THEN
          RAISE EXCEPTION 'The test subject is in use; remove it by hand before this migration';
        END IF;
        DELETE FROM classroom_subjects
        WHERE school_subject_id IN (
          SELECT id FROM school_subjects WHERE subject_id = test_subject_id
        );
        DELETE FROM school_subjects WHERE subject_id = test_subject_id;
        DELETE FROM subjects WHERE id = test_subject_id;
      END $$;
    `);

    // Any other code the rule rejects is real data this migration must not
    // guess at: stop and name it instead of deleting or rewriting it.
    const offenders = (await queryRunner.query(
      `SELECT code FROM subjects
       WHERE code !~ $1 OR char_length(name_th) > 200
       ORDER BY code LIMIT 20`,
      [SUBJECT_CODE_PATTERN],
    )) as Array<{ code: string }>;
    if (offenders.length > 0) {
      throw new Error(
        `Subjects break the code/name rule and need a decision first: ${offenders
          .map((row) => row.code)
          .join(', ')}`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE subjects
        ADD CONSTRAINT chk_subjects_code_format CHECK (code ~ '${SUBJECT_CODE_PATTERN}'),
        ADD CONSTRAINT chk_subjects_name_th_length CHECK (char_length(name_th) <= 200)
    `);
  }

  /** Lifts the rule only; the removed test subject is not brought back. */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE subjects
        DROP CONSTRAINT chk_subjects_name_th_length,
        DROP CONSTRAINT chk_subjects_code_format
    `);
  }
}
