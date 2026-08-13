import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A case is opened only from subject-period attendance: a school day counts as
 * absent when no subject period that day is attended. Earlier remediation also
 * considered retired DAILY rows, which left active legacy cases after the
 * product moved to subject-only attendance.
 */
export class RemediateNonSubjectAbsenceCases20260813150000 implements MigrationInterface {
  name = 'RemediateNonSubjectAbsenceCases20260813150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TEMP TABLE invalid_subject_absence_case_ids
      ON COMMIT DROP AS
      WITH current_enrollments AS (
        SELECT enrollment.student_uuid,
          enrollment."AcademicYear_Onec" AS academic_year,
          enrollment."Semester_Onec" AS semester
        FROM student_term enrollment
        JOIN student_current_enrollment_resolution resolution
          ON resolution.person_uuid = enrollment.person_uuid
         AND resolution.selected_student_uuid = enrollment.student_uuid
         AND resolution.resolution_state = 'ACTIVE'
        WHERE enrollment.deleted_at IS NULL
      ), absent_days AS (
        SELECT attendance.student_uuid,
          attendance."AttendanceDate"::date AS attendance_date
        FROM attendance
        JOIN current_enrollments enrollment
          ON enrollment.student_uuid = attendance.student_uuid
         AND enrollment.academic_year = attendance."AcademicYear_Onec"
         AND enrollment.semester = attendance."Semester_Onec"
        WHERE attendance.session_kind = 'SUBJECT'
          AND attendance."AttendanceDate"::date <= (NOW() AT TIME ZONE 'Asia/Bangkok')::date
        GROUP BY attendance.student_uuid, attendance."AttendanceDate"::date
        HAVING COUNT(*) FILTER (WHERE attendance."AttendanceStatus" <> 4) > 0
          AND COUNT(*) FILTER (WHERE attendance."AttendanceStatus" IN (1, 3)) = 0
      ), qualifying_students AS (
        SELECT student_uuid
        FROM absent_days
        GROUP BY student_uuid
        HAVING COUNT(*) >= 3
      )
      SELECT student_case.id
      FROM cases student_case
      LEFT JOIN qualifying_students qualifying
        ON qualifying.student_uuid = student_case.student_uuid
      WHERE student_case.deleted_at IS NULL
        AND student_case.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
        AND qualifying.student_uuid IS NULL
    `);

    await queryRunner.query(`
      INSERT INTO case_lifecycle_remediation_case_backup (
        remediation_code, case_id, previous_deleted_at, previous_deleted_by,
        previous_updated_by, previous_reason_flagged
      )
      SELECT 'SUBJECT_ATTENDANCE_RULE', c.id, c.deleted_at, c.deleted_by, c.updated_by,
             c.reason_flagged
      FROM cases c
      JOIN invalid_subject_absence_case_ids invalid_case ON invalid_case.id = c.id
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO case_lifecycle_remediation_task_backup (
        remediation_code, task_id, previous_deleted_at, previous_deleted_by, previous_updated_by
      )
      SELECT 'SUBJECT_ATTENDANCE_RULE', task.id, task.deleted_at, task.deleted_by, task.updated_by
      FROM tasks task
      JOIN invalid_subject_absence_case_ids invalid_case ON invalid_case.id = task.case_id
      WHERE task.deleted_at IS NULL
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO case_lifecycle_remediation_link_backup (
        remediation_code, link_id, previous_deleted_at, previous_deleted_by, previous_updated_by
      )
      SELECT 'SUBJECT_ATTENDANCE_RULE', link.id, link.deleted_at, link.deleted_by, link.updated_by
      FROM task_links link
      JOIN tasks task ON task.id = link.task_id
      JOIN invalid_subject_absence_case_ids invalid_case ON invalid_case.id = task.case_id
      WHERE link.deleted_at IS NULL
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      UPDATE task_links link
      SET deleted_at = NOW(),
          deleted_by = COALESCE(link.updated_by, link.created_by),
          updated_at = NOW(),
          updated_by = COALESCE(link.updated_by, link.created_by)
      FROM tasks task
      JOIN invalid_subject_absence_case_ids invalid_case ON invalid_case.id = task.case_id
      WHERE link.task_id = task.id
        AND link.deleted_at IS NULL
    `);

    await queryRunner.query(`
      UPDATE tasks task
      SET deleted_at = NOW(),
          deleted_by = COALESCE(task.updated_by, task.created_by),
          updated_at = NOW(),
          updated_by = COALESCE(task.updated_by, task.created_by)
      FROM invalid_subject_absence_case_ids invalid_case
      WHERE task.case_id = invalid_case.id
        AND task.deleted_at IS NULL
    `);

    await queryRunner.query(`
      UPDATE cases student_case
      SET deleted_at = NOW(),
          deleted_by = COALESCE(student_case.updated_by, student_case.created_by),
          updated_at = NOW(),
          updated_by = COALESCE(student_case.updated_by, student_case.created_by)
      FROM invalid_subject_absence_case_ids invalid_case
      WHERE student_case.id = invalid_case.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE cases c
      SET deleted_at = backup.previous_deleted_at,
          deleted_by = backup.previous_deleted_by,
          updated_by = backup.previous_updated_by,
          reason_flagged = backup.previous_reason_flagged
      FROM case_lifecycle_remediation_case_backup backup
      WHERE backup.remediation_code = 'SUBJECT_ATTENDANCE_RULE' AND backup.case_id = c.id
    `);
    await queryRunner.query(`
      UPDATE tasks task
      SET deleted_at = backup.previous_deleted_at,
          deleted_by = backup.previous_deleted_by,
          updated_by = backup.previous_updated_by
      FROM case_lifecycle_remediation_task_backup backup
      WHERE backup.remediation_code = 'SUBJECT_ATTENDANCE_RULE' AND backup.task_id = task.id
    `);
    await queryRunner.query(`
      UPDATE task_links link
      SET deleted_at = backup.previous_deleted_at,
          deleted_by = backup.previous_deleted_by,
          updated_by = backup.previous_updated_by
      FROM case_lifecycle_remediation_link_backup backup
      WHERE backup.remediation_code = 'SUBJECT_ATTENDANCE_RULE' AND backup.link_id = link.id
    `);
    await queryRunner.query(
      `DELETE FROM case_lifecycle_remediation_link_backup WHERE remediation_code = 'SUBJECT_ATTENDANCE_RULE'`,
    );
    await queryRunner.query(
      `DELETE FROM case_lifecycle_remediation_task_backup WHERE remediation_code = 'SUBJECT_ATTENDANCE_RULE'`,
    );
    await queryRunner.query(
      `DELETE FROM case_lifecycle_remediation_case_backup WHERE remediation_code = 'SUBJECT_ATTENDANCE_RULE'`,
    );
  }
}
