import type { MigrationInterface, QueryRunner } from 'typeorm';

const RETIRED_PERMISSION = 'attendance-dashboard';
const RETIRED_NOTIFICATION = 'ATTENDANCE_INCOMPLETE';

const removePermission = (column: string): string => `
  COALESCE(
    (
      SELECT jsonb_agg(permission ORDER BY first_ordinality)
      FROM (
        SELECT permission, MIN(ordinality) AS first_ordinality
        FROM jsonb_array_elements_text(COALESCE(${column}, '[]'::jsonb))
          WITH ORDINALITY AS entry(permission, ordinality)
        WHERE permission <> '${RETIRED_PERMISSION}'
        GROUP BY permission
      ) unique_permissions
    ),
    '[]'::jsonb
  )
`;

/**
 * Contract cleanup for the retired attendance completeness/calendar feature.
 *
 * This migration intentionally destroys calendar data. Its down migration
 * fails rather than recreating empty tables and pretending the deleted data
 * was restored; production rollback requires the verified pre-deploy backup.
 */
export class RetireAttendanceCompleteness20260827320000 implements MigrationInterface {
  name = 'RetireAttendanceCompleteness20260827320000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $preflight$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM case_review_actions
          WHERE required_permission_code = '${RETIRED_PERMISSION}'
        ) THEN
          RAISE EXCEPTION
            'Cannot retire attendance-dashboard: case_review_actions still reference it';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM notification_types
          WHERE required_permission = '${RETIRED_PERMISSION}'
            AND code <> '${RETIRED_NOTIFICATION}'
        ) THEN
          RAISE EXCEPTION
            'Cannot retire attendance-dashboard: active notification types still reference it';
        END IF;
      END
      $preflight$;
    `);

    await queryRunner.query(`DELETE FROM notifications WHERE type_code = $1`, [
      RETIRED_NOTIFICATION,
    ]);
    await queryRunner.query(`DELETE FROM notification_types WHERE code = $1`, [
      RETIRED_NOTIFICATION,
    ]);
    await queryRunner.query(`
      DELETE FROM application_display_states
      WHERE domain_code IN ('ATTENDANCE_RECONCILIATION', 'ATTENDANCE_ANOMALY')
    `);

    await queryRunner.query(`
      UPDATE users
      SET permissions = ${removePermission('users.permissions')}
      WHERE permissions ? '${RETIRED_PERMISSION}'
    `);
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = ${removePermission('roles.default_permissions')}
        WHERE default_permissions ? '${RETIRED_PERMISSION}'
      `,
    );

    await queryRunner.query(`
      DO $risk_metric_contract$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'student_risk_profiles'
            AND column_name = 'school_day_count'
        ) THEN
          ALTER TABLE student_risk_profiles
            RENAME COLUMN school_day_count TO recorded_day_count;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'student_risk_profiles'
            AND column_name = 'weighted_attendance_percent'
        ) THEN
          ALTER TABLE student_risk_profiles
            RENAME COLUMN weighted_attendance_percent TO attendance_rate_percent;
        END IF;
      END
      $risk_metric_contract$;
    `);

    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
        DROP COLUMN IF EXISTS weighted_absence_days
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        DROP COLUMN IF EXISTS anomaly_notified_at
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS school_calendar_days`);
    await queryRunner.query(`DROP TABLE IF EXISTS school_calendar_day_types`);
  }

  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        'RetireAttendanceCompleteness is irreversible: restore the verified pre-deploy database backup',
      ),
    );
  }
}
