import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fails closed when a legacy conversion loses recorder provenance. Attendance
 * history is student data and must never be deleted merely because the actor
 * cannot be reconstructed. The preceding conversion preserves a teacher
 * membership (or a real submitter user), so a correctly converted database
 * passes this guard without changing any rows.
 *
 * Keep the historical class/file name because the migration has already been
 * recorded in local ledgers. Its contract is now validation-only.
 */
export class RemoveUnverifiableAttendanceHistory20260827313200 implements MigrationInterface {
  name = 'RemoveUnverifiableAttendanceHistory20260827313200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TEMP TABLE unverifiable_attendance_sessions_20260827
      ON COMMIT DROP AS
      SELECT session.id
      FROM attendance_sessions session
      WHERE session.record_storage_mode = 'EXCEPTIONS'
        AND session.status IN ('SUBMITTED', 'REOPENED')
        AND session.deleted_at IS NULL
        AND session.submitted_by IS NULL
        AND session.started_by_teacher_membership_id IS NULL
        AND session.submitted_by_teacher_membership_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM attendance_session_roster roster
          WHERE roster.session_id = session.id
            AND roster.deleted_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM attendance_exceptions exception
          WHERE exception.session_id = session.id
            AND exception.marked_by_teacher_membership_id IS NOT NULL
            AND exception.deleted_at IS NULL
        )
    `);

    await queryRunner.query(`
      DO $unverifiable_attendance_guard$
      DECLARE unverifiable_session_count bigint;
      BEGIN
        SELECT COUNT(*) INTO unverifiable_session_count
        FROM unverifiable_attendance_sessions_20260827;

        IF unverifiable_session_count <> 0 THEN
          RAISE EXCEPTION
            'Attendance provenance guard found % session(s) without a verifiable recorder; history was preserved and migration stopped',
            unverifiable_session_count;
        END IF;
      END
      $unverifiable_attendance_guard$;
    `);
  }

  public async down(): Promise<void> {
    // Validation-only migration: there is no persisted change to reverse.
  }
}
