import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop four tables nothing reads or writes any more.
 *
 * - `external_users` and `schedules` date from the 2026-03 baseline. Both are
 *   empty and only ever had an entity: people outside STS never got a flow, and
 *   timetables moved to `classroom_subjects`.
 * - `attendance_import_files` lost its writer when the old attendance import was
 *   retired. The restored import only parses a file to pre-fill the check-in
 *   form; the submission itself is recorded in `attendance_submission_history`.
 * - `school_structure_backfill_issues` was a one-off report from the
 *   2026-07-14 structure backfill. Its condition stays queryable directly:
 *   `student_term.classroom_id IS NULL`.
 *
 * The first three must still be empty, so a table that quietly came back into
 * use stops the migration instead of being dropped with its data.
 */
export class DropUnusedLegacyTables20260925140000 implements MigrationInterface {
  name = 'DropUnusedLegacyTables20260925140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        stray_rows bigint := 0;
      BEGIN
        IF to_regclass('external_users') IS NOT NULL THEN
          SELECT stray_rows + COUNT(*) INTO stray_rows FROM external_users;
        END IF;
        IF to_regclass('schedules') IS NOT NULL THEN
          SELECT stray_rows + COUNT(*) INTO stray_rows FROM schedules;
        END IF;
        IF to_regclass('attendance_import_files') IS NOT NULL THEN
          SELECT stray_rows + COUNT(*) INTO stray_rows FROM attendance_import_files;
        END IF;
        IF stray_rows <> 0 THEN
          RAISE EXCEPTION 'unused legacy tables hold % rows; review before dropping', stray_rows;
        END IF;
      END $$;
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS attendance_import_files`);
    await queryRunner.query(`DROP TABLE IF EXISTS school_structure_backfill_issues`);
    await queryRunner.query(`DROP TABLE IF EXISTS external_users`);
    await queryRunner.query(`DROP TABLE IF EXISTS schedules`);
  }

  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        'DropUnusedLegacyTables20260925140000 is intentionally irreversible: the dropped tables had no readers or writers. ' +
          'Restore them from a database backup if they are ever needed.',
      ),
    );
  }
}
