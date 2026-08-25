import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes attendance sessions whose destructive legacy conversion no longer
 * carries any verifiable recorder. The preceding conversion now preserves a
 * teacher membership (or a real submitter user) from the legacy rows, so a
 * correctly converted production database is unaffected. Databases converted
 * by the earlier implementation cannot safely reconstruct that actor after the
 * timetable/assignment tables were dropped; retaining `classroom-check-in`
 * would present a technical scope name as if it were a person.
 *
 * This is intentionally destructive. The affected rows are not soft-deleted:
 * unverifiable history must not continue contributing to attendance or risk
 * calculations. Rollback requires restoring a pre-migration backup.
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
      DECLARE unexpected_label_count bigint;
      BEGIN
        SELECT COUNT(*) INTO unexpected_label_count
        FROM attendance_effective_records record
        JOIN unverifiable_attendance_sessions_20260827 target
          ON target.id = record.session_id
        WHERE record."RecordedBy" IS DISTINCT FROM 'classroom-check-in';

        IF unexpected_label_count <> 0 THEN
          RAISE EXCEPTION
            'Unverifiable attendance cleanup found % records with non-synthetic recorder labels',
            unexpected_label_count;
        END IF;
      END
      $unverifiable_attendance_guard$;
    `);

    // Derived profiles must not keep counts from history removed below. The
    // normal risk-profile repair/recalculation recreates them from live facts.
    await queryRunner.query(`
      DELETE FROM student_risk_profiles profile
      USING attendance_session_roster roster,
            unverifiable_attendance_sessions_20260827 target
      WHERE roster.session_id = target.id
        AND profile.student_uuid = roster.student_uuid
    `);
    await queryRunner.query(`
      DELETE FROM attendance_exceptions exception
      USING unverifiable_attendance_sessions_20260827 target
      WHERE exception.session_id = target.id
    `);
    await queryRunner.query(`
      DELETE FROM attendance_session_roster roster
      USING unverifiable_attendance_sessions_20260827 target
      WHERE roster.session_id = target.id
    `);
    await queryRunner.query(`
      DELETE FROM attendance_sessions session
      USING unverifiable_attendance_sessions_20260827 target
      WHERE session.id = target.id
    `);
  }

  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        'RemoveUnverifiableAttendanceHistory is intentionally irreversible. Restore the verified pre-migration backup.',
      ),
    );
  }
}
