import type { MigrationInterface, QueryRunner } from 'typeorm';

const SHOWCASE_CASE_REASON = 'ข้อมูลสาธิตสำหรับการนำเสนอวงจรติดตามนักเรียน';
const DEMO_CALENDAR_REASONS = [
  'ข้อมูลสาธิตความเสี่ยงทุกโรงเรียน',
  'ข้อมูลสาธิตความเสี่ยงโรงเรียน showcase',
  'ข้อมูลสาธิตการเช็คชื่อย้อนหลัง',
] as const;

/** Removes presentation-only data after the approved showcase window. */
export class PurgeDemoShowcaseData20260812120000 implements MigrationInterface {
  name = 'PurgeDemoShowcaseData20260812120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TEMP TABLE purge_demo_attendance_sessions_20260812
      ON COMMIT DROP AS
      SELECT DISTINCT session.id
      FROM attendance_sessions session
      JOIN attendance demo_record ON demo_record.session_id = session.id
      WHERE (
        demo_record."RecordedBy" LIKE 'TEACHER_ACCESS_DEMO:%'
        OR demo_record."RecordedBy" IN (
          'SYSTEM:THEPSIRIN_SHOWCASE',
          'SYSTEM:THEPSIRIN_RISK_SHOWCASE',
          'SYSTEM:DEMO_RISK_DISTRIBUTION'
        )
      )
        AND NOT EXISTS (
          SELECT 1
          FROM attendance operational_record
          WHERE operational_record.session_id = session.id
            AND NOT (
              COALESCE(operational_record."RecordedBy", '') LIKE 'TEACHER_ACCESS_DEMO:%'
              OR operational_record."RecordedBy" IN (
                'SYSTEM:THEPSIRIN_SHOWCASE',
                'SYSTEM:THEPSIRIN_RISK_SHOWCASE',
                'SYSTEM:DEMO_RISK_DISTRIBUTION'
              )
            )
        )
    `);

    await queryRunner.query(`
      CREATE TEMP TABLE purge_demo_attendance_students_20260812
      ON COMMIT DROP AS
      SELECT DISTINCT student_uuid
      FROM attendance
      WHERE "RecordedBy" LIKE 'TEACHER_ACCESS_DEMO:%'
         OR "RecordedBy" IN (
           'SYSTEM:THEPSIRIN_SHOWCASE',
           'SYSTEM:THEPSIRIN_RISK_SHOWCASE',
           'SYSTEM:DEMO_RISK_DISTRIBUTION'
         )
    `);

    await queryRunner.query(`
      DELETE FROM attendance
      WHERE "RecordedBy" LIKE 'TEACHER_ACCESS_DEMO:%'
         OR "RecordedBy" IN (
           'SYSTEM:THEPSIRIN_SHOWCASE',
           'SYSTEM:THEPSIRIN_RISK_SHOWCASE',
           'SYSTEM:DEMO_RISK_DISTRIBUTION'
         )
    `);

    await queryRunner.query(`
      DELETE FROM attendance_sessions session
      USING purge_demo_attendance_sessions_20260812 demo_session
      WHERE session.id = demo_session.id
        AND NOT EXISTS (
          SELECT 1 FROM attendance remaining_record WHERE remaining_record.session_id = session.id
        )
    `);

    await queryRunner.query(`
      DELETE FROM student_risk_profiles profile
      USING purge_demo_attendance_students_20260812 affected_student
      WHERE profile.student_uuid = affected_student.student_uuid
    `);

    await queryRunner.query(`DELETE FROM school_calendar_days WHERE reason = ANY($1::text[])`, [
      DEMO_CALENDAR_REASONS,
    ]);

    await queryRunner.query(
      `
        DELETE FROM student_observations observation
        USING task_links link, tasks task, cases tracked_case
        WHERE observation.source_task_link_id = link.id
          AND link.task_id = task.id
          AND task.case_id = tracked_case.id
          AND tracked_case.reason_flagged = $1
      `,
      [SHOWCASE_CASE_REASON],
    );

    await queryRunner.query(
      `
        DELETE FROM task_submissions submission
        USING task_links link, tasks task, cases tracked_case
        WHERE submission.task_link_id = link.id
          AND link.task_id = task.id
          AND task.case_id = tracked_case.id
          AND tracked_case.reason_flagged = $1
      `,
      [SHOWCASE_CASE_REASON],
    );

    await queryRunner.query(
      `
        UPDATE task_links child_link
        SET parent_link_id = NULL, updated_at = now()
        FROM task_links parent_link, tasks parent_task, cases tracked_case
        WHERE child_link.parent_link_id = parent_link.id
          AND parent_link.task_id = parent_task.id
          AND parent_task.case_id = tracked_case.id
          AND tracked_case.reason_flagged = $1
          AND NOT EXISTS (
            SELECT 1
            FROM tasks child_task
            JOIN cases child_case ON child_case.id = child_task.case_id
            WHERE child_task.id = child_link.task_id
              AND child_case.reason_flagged = $1
          )
      `,
      [SHOWCASE_CASE_REASON],
    );

    await queryRunner.query(
      `
        DELETE FROM task_links link
        USING tasks task, cases tracked_case
        WHERE link.task_id = task.id
          AND task.case_id = tracked_case.id
          AND tracked_case.reason_flagged = $1
      `,
      [SHOWCASE_CASE_REASON],
    );

    await queryRunner.query(
      `
        DELETE FROM tasks task
        USING cases tracked_case
        WHERE task.case_id = tracked_case.id
          AND tracked_case.reason_flagged = $1
      `,
      [SHOWCASE_CASE_REASON],
    );

    await queryRunner.query(
      `DELETE FROM notifications WHERE case_id IN (SELECT id FROM cases WHERE reason_flagged = $1)`,
      [SHOWCASE_CASE_REASON],
    );
    await queryRunner.query(`DELETE FROM cases WHERE reason_flagged = $1`, [SHOWCASE_CASE_REASON]);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_attendance_demo_risk_distribution_student`);
  }

  /** Purged demo rows stay removed; only the dropped structural index is reversible. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_demo_risk_distribution_student
      ON attendance (student_uuid)
      WHERE "RecordedBy" = 'SYSTEM:DEMO_RISK_DISTRIBUTION'
    `);
  }
}
