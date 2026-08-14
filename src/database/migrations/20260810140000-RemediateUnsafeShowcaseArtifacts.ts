import type { MigrationInterface, QueryRunner } from 'typeorm';

const SHOWCASE_REASON = 'ข้อมูลสาธิตสำหรับการนำเสนอวงจรติดตามนักเรียน';
const SHOWCASE_SCHOOL = 'โรงเรียนเทพศิรินทร์ราชดำริ';
const LEGACY_CALENDAR_REASON = 'ข้อมูลสาธิตความเสี่ยงทุกโรงเรียน';

/**
 * Repairs artifacts created by the original unscoped showcase migrations.
 *
 * Only rows with a migration-owned marker or an exact legacy token hash are
 * changed. Student rows have no provenance column; the retained showcase scope
 * therefore requires both the named school and an active DEMO actor in it.
 * Address and teacher-membership values from the old migration had no row-level
 * marker, so automatically guessing which values to clear would be destructive.
 */
export class RemediateUnsafeShowcaseArtifacts20260810140000 implements MigrationInterface {
  name = 'RemediateUnsafeShowcaseArtifacts20260810140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      WITH deleted_attendance AS (
        DELETE FROM attendance attendance_record
        WHERE attendance_record."RecordedBy" IN (
          'SYSTEM:THEPSIRIN_SHOWCASE',
          'SYSTEM:THEPSIRIN_RISK_SHOWCASE',
          'SYSTEM:DEMO_RISK_DISTRIBUTION'
        )
          AND NOT (
            EXISTS (
              SELECT 1
              FROM schools showcase_school
              WHERE showcase_school.id = attendance_record."SchoolID_Onec"
                AND showcase_school.name = $1
            )
            AND EXISTS (
              SELECT 1
              FROM users demo_actor
              JOIN school_teacher_memberships demo_membership
                ON demo_membership.teacher_user_id = demo_actor.id
               AND demo_membership.school_id = attendance_record."SchoolID_Onec"
               AND demo_membership.membership_status = 'ACTIVE'
               AND demo_membership.deleted_at IS NULL
              WHERE demo_actor.data_origin_code = 'DEMO'
                AND demo_actor.status = 'ACTIVE'
            )
          )
        RETURNING attendance_record.student_uuid
      )
      DELETE FROM student_risk_profiles profile
      USING deleted_attendance affected_student
      WHERE profile.student_uuid = affected_student.student_uuid
    `,
      [SHOWCASE_SCHOOL],
    );

    await queryRunner.query(
      `
        DELETE FROM school_calendar_days calendar_day
        WHERE calendar_day.reason = $1
          AND calendar_day.source = 'BACKFILL'
      `,
      [LEGACY_CALENDAR_REASON],
    );

    await queryRunner.query(
      `
        UPDATE task_links link
        SET
          token_hash = encode(gen_random_bytes(32), 'hex'),
          magic_link = NULL,
          token_encrypted = NULL,
          admin_locked = 1,
          admin_lock_reason = 'SHOWCASE_TOKEN_ROTATED',
          admin_lock_at = now(),
          updated_at = now()
        FROM tasks task, cases tracked_case
        WHERE link.task_id = task.id
          AND task.case_id = tracked_case.id
          AND tracked_case.reason_flagged = $1
          AND tracked_case.student_school = $2
          AND link.token_hash = encode(
            digest('thepsirin-showcase-' || tracked_case.id::text, 'sha256'),
            'hex'
          )
      `,
      [SHOWCASE_REASON, SHOWCASE_SCHOOL],
    );
  }

  /** Security cleanup is intentionally not reversible. */
  public async down(): Promise<void> {}
}
