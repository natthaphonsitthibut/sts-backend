import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Active student-risk cases are opened exclusively by cumulative absences.
 * Retire legacy active cases that do not meet the current >= 3 absent-day
 * rule, while preserving their rows and audit history as soft-deleted data.
 */
export class RemediateInvalidActiveAbsenceCases20260813130000 implements MigrationInterface {
  name = 'RemediateInvalidActiveAbsenceCases20260813130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TEMP TABLE invalid_active_absence_case_ids
      ON COMMIT DROP AS
      WITH current_enrollments AS (
        SELECT
          enrollment.student_uuid,
          enrollment."AcademicYear_Onec" AS academic_year,
          enrollment."Semester_Onec" AS semester
        FROM student_term enrollment
        JOIN student_current_enrollment_resolution resolution
          ON resolution.person_uuid = enrollment.person_uuid
         AND resolution.selected_student_uuid = enrollment.student_uuid
         AND resolution.resolution_state = 'ACTIVE'
        WHERE enrollment.deleted_at IS NULL
      ), classified_days AS (
        SELECT
          attendance.student_uuid,
          attendance."AttendanceDate"::date AS attendance_date,
          (
            COUNT(*) FILTER (WHERE attendance."AttendanceStatus" <> 4) > 0
            AND COUNT(*) FILTER (WHERE attendance."AttendanceStatus" IN (1, 3)) = 0
          ) AS is_absent_day
        FROM attendance
        JOIN current_enrollments enrollment
          ON enrollment.student_uuid = attendance.student_uuid
         AND enrollment.academic_year = attendance."AcademicYear_Onec"
         AND enrollment.semester = attendance."Semester_Onec"
        WHERE attendance.student_uuid IS NOT NULL
          AND attendance.session_kind = 'SUBJECT'
          AND attendance."AttendanceDate"::date <= (NOW() AT TIME ZONE 'Asia/Bangkok')::date
        GROUP BY attendance.student_uuid, attendance."AttendanceDate"::date
      ), qualifying_students AS (
        SELECT day.student_uuid, COUNT(*)::int AS absent_days
        FROM classified_days day
        WHERE day.is_absent_day
        GROUP BY day.student_uuid
        HAVING COUNT(*) >= 3
      )
      SELECT active_case.id
      FROM cases active_case
      LEFT JOIN qualifying_students qualifying
        ON qualifying.student_uuid = active_case.student_uuid
      WHERE active_case.deleted_at IS NULL
        AND active_case.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW')
        AND qualifying.student_uuid IS NULL
    `);

    await queryRunner.query(`
      INSERT INTO case_lifecycle_remediation_case_backup (
        remediation_code, case_id, previous_deleted_at, previous_deleted_by,
        previous_updated_by, previous_reason_flagged
      )
      SELECT 'ABSENCE_RULE', c.id, c.deleted_at, c.deleted_by, c.updated_by, c.reason_flagged
      FROM cases c
      JOIN invalid_active_absence_case_ids invalid_case ON invalid_case.id = c.id
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO case_lifecycle_remediation_task_backup (
        remediation_code, task_id, previous_deleted_at, previous_deleted_by, previous_updated_by
      )
      SELECT 'ABSENCE_RULE', task.id, task.deleted_at, task.deleted_by, task.updated_by
      FROM tasks task
      JOIN invalid_active_absence_case_ids invalid_case ON invalid_case.id = task.case_id
      WHERE task.deleted_at IS NULL
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO case_lifecycle_remediation_link_backup (
        remediation_code, link_id, previous_deleted_at, previous_deleted_by, previous_updated_by
      )
      SELECT 'ABSENCE_RULE', link.id, link.deleted_at, link.deleted_by, link.updated_by
      FROM task_links link
      JOIN tasks task ON task.id = link.task_id
      JOIN invalid_active_absence_case_ids invalid_case ON invalid_case.id = task.case_id
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
      JOIN invalid_active_absence_case_ids invalid_case ON invalid_case.id = task.case_id
      WHERE link.task_id = task.id
        AND link.deleted_at IS NULL
    `);

    await queryRunner.query(`
      UPDATE tasks task
      SET deleted_at = NOW(),
          deleted_by = COALESCE(task.updated_by, task.created_by),
          updated_at = NOW(),
          updated_by = COALESCE(task.updated_by, task.created_by)
      FROM invalid_active_absence_case_ids invalid_case
      WHERE task.case_id = invalid_case.id
        AND task.deleted_at IS NULL
    `);

    await queryRunner.query(`
      UPDATE cases active_case
      SET deleted_at = NOW(),
          deleted_by = COALESCE(active_case.updated_by, active_case.created_by),
          updated_at = NOW(),
          updated_by = COALESCE(active_case.updated_by, active_case.created_by)
      FROM invalid_active_absence_case_ids invalid_case
      WHERE active_case.id = invalid_case.id
    `);

    await queryRunner.query(`
      WITH current_enrollments AS (
        SELECT
          enrollment.student_uuid,
          enrollment."AcademicYear_Onec" AS academic_year,
          enrollment."Semester_Onec" AS semester
        FROM student_term enrollment
        JOIN student_current_enrollment_resolution resolution
          ON resolution.person_uuid = enrollment.person_uuid
         AND resolution.selected_student_uuid = enrollment.student_uuid
         AND resolution.resolution_state = 'ACTIVE'
        WHERE enrollment.deleted_at IS NULL
      ), classified_days AS (
        SELECT
          attendance.student_uuid,
          attendance."AttendanceDate"::date AS attendance_date,
          (
            COUNT(*) FILTER (WHERE attendance."AttendanceStatus" <> 4) > 0
            AND COUNT(*) FILTER (WHERE attendance."AttendanceStatus" IN (1, 3)) = 0
          ) AS is_absent_day
        FROM attendance
        JOIN current_enrollments enrollment
          ON enrollment.student_uuid = attendance.student_uuid
         AND enrollment.academic_year = attendance."AcademicYear_Onec"
         AND enrollment.semester = attendance."Semester_Onec"
        WHERE attendance.student_uuid IS NOT NULL
          AND attendance.session_kind = 'SUBJECT'
          AND attendance."AttendanceDate"::date <= (NOW() AT TIME ZONE 'Asia/Bangkok')::date
        GROUP BY attendance.student_uuid, attendance."AttendanceDate"::date
      ), qualifying_students AS (
        SELECT day.student_uuid, COUNT(*)::int AS absent_days
        FROM classified_days day
        WHERE day.is_absent_day
        GROUP BY day.student_uuid
        HAVING COUNT(*) >= 3
      )
      INSERT INTO case_lifecycle_remediation_case_backup (
        remediation_code, case_id, previous_deleted_at, previous_deleted_by,
        previous_updated_by, previous_reason_flagged
      )
      SELECT 'ABSENCE_RULE', active_case.id, active_case.deleted_at, active_case.deleted_by,
             active_case.updated_by, active_case.reason_flagged
      FROM cases active_case
      JOIN qualifying_students qualifying ON qualifying.student_uuid = active_case.student_uuid
      WHERE active_case.deleted_at IS NULL
        AND active_case.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      WITH current_enrollments AS (
        SELECT
          enrollment.student_uuid,
          enrollment."AcademicYear_Onec" AS academic_year,
          enrollment."Semester_Onec" AS semester
        FROM student_term enrollment
        JOIN student_current_enrollment_resolution resolution
          ON resolution.person_uuid = enrollment.person_uuid
         AND resolution.selected_student_uuid = enrollment.student_uuid
         AND resolution.resolution_state = 'ACTIVE'
        WHERE enrollment.deleted_at IS NULL
      ), classified_days AS (
        SELECT
          attendance.student_uuid,
          attendance."AttendanceDate"::date AS attendance_date,
          (
            COUNT(*) FILTER (WHERE attendance."AttendanceStatus" <> 4) > 0
            AND COUNT(*) FILTER (WHERE attendance."AttendanceStatus" IN (1, 3)) = 0
          ) AS is_absent_day
        FROM attendance
        JOIN current_enrollments enrollment
          ON enrollment.student_uuid = attendance.student_uuid
         AND enrollment.academic_year = attendance."AcademicYear_Onec"
         AND enrollment.semester = attendance."Semester_Onec"
        WHERE attendance.student_uuid IS NOT NULL
          AND attendance.session_kind = 'SUBJECT'
          AND attendance."AttendanceDate"::date <= (NOW() AT TIME ZONE 'Asia/Bangkok')::date
        GROUP BY attendance.student_uuid, attendance."AttendanceDate"::date
      ), qualifying_students AS (
        SELECT day.student_uuid, COUNT(*)::int AS absent_days
        FROM classified_days day
        WHERE day.is_absent_day
        GROUP BY day.student_uuid
        HAVING COUNT(*) >= 3
      )
      UPDATE cases active_case
      SET reason_flagged = CONCAT('ขาดเรียนสะสม ', qualifying.absent_days, ' วัน'),
          updated_at = NOW(),
          updated_by = COALESCE(active_case.updated_by, active_case.created_by)
      FROM qualifying_students qualifying
      WHERE active_case.student_uuid = qualifying.student_uuid
        AND active_case.deleted_at IS NULL
        AND active_case.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
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
      WHERE backup.remediation_code = 'ABSENCE_RULE' AND backup.case_id = c.id
    `);
    await queryRunner.query(`
      UPDATE tasks task
      SET deleted_at = backup.previous_deleted_at,
          deleted_by = backup.previous_deleted_by,
          updated_by = backup.previous_updated_by
      FROM case_lifecycle_remediation_task_backup backup
      WHERE backup.remediation_code = 'ABSENCE_RULE' AND backup.task_id = task.id
    `);
    await queryRunner.query(`
      UPDATE task_links link
      SET deleted_at = backup.previous_deleted_at,
          deleted_by = backup.previous_deleted_by,
          updated_by = backup.previous_updated_by
      FROM case_lifecycle_remediation_link_backup backup
      WHERE backup.remediation_code = 'ABSENCE_RULE' AND backup.link_id = link.id
    `);
    await queryRunner.query(
      `DELETE FROM case_lifecycle_remediation_link_backup WHERE remediation_code = 'ABSENCE_RULE'`,
    );
    await queryRunner.query(
      `DELETE FROM case_lifecycle_remediation_task_backup WHERE remediation_code = 'ABSENCE_RULE'`,
    );
    await queryRunner.query(
      `DELETE FROM case_lifecycle_remediation_case_backup WHERE remediation_code = 'ABSENCE_RULE'`,
    );
  }
}
