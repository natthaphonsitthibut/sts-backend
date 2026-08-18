import type { MigrationInterface, QueryRunner } from 'typeorm';

const SHOWCASE_SCHOOL_ID = 10010004;
const DEMO_SCHOOL_ID_START = 10010001;
const DEMO_SCHOOL_ID_END = 10010010;
const ROOM_COHORT_HASH_SEED = 20260826;

/**
 * Distributes four-day absence examples across the compact demo schools.
 *
 * The cohort is derived from the active production-shaped roster: each room
 * deterministically contributes zero to three students, and students whose
 * resolved case would reset the absence window are excluded. Cases themselves
 * are intentionally untouched; the canonical risk/absence services remain the
 * only writers of derived profiles and case workflow.
 */
export class DistributeDemoAttendanceRisk20260826100000 implements MigrationInterface {
  name = 'DistributeDemoAttendanceRisk20260826100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TEMP TABLE distributed_demo_school_targets_20260826 (
        school_id INTEGER PRIMARY KEY
      ) ON COMMIT DROP
    `);
    await queryRunner.query(
      `
        INSERT INTO distributed_demo_school_targets_20260826 (school_id)
        SELECT school.id
        FROM schools school
        WHERE school.id BETWEEN $1 AND $2
          AND school.school_status = 'ACTIVE'
      `,
      [DEMO_SCHOOL_ID_START, DEMO_SCHOOL_ID_END],
    );

    const missingSchools = (await queryRunner.query(
      `
        SELECT required.school_id
        FROM GENERATE_SERIES($1::integer, $2::integer) required(school_id)
        LEFT JOIN distributed_demo_school_targets_20260826 target
          ON target.school_id = required.school_id
        WHERE target.school_id IS NULL
        ORDER BY required.school_id
      `,
      [DEMO_SCHOOL_ID_START, DEMO_SCHOOL_ID_END],
    )) as Array<{ school_id: number }>;
    if (missingSchools.length > 0) {
      throw new Error(
        `DistributeDemoAttendanceRisk: missing active demo schools: ${JSON.stringify(missingSchools)}`,
      );
    }

    await queryRunner.query(
      `
        CREATE TEMP TABLE distributed_demo_risk_students_20260826
        ON COMMIT DROP AS
        WITH room_candidates AS MATERIALIZED (
          SELECT
            enrollment.student_uuid,
            enrollment."SchoolID_Onec" AS school_id,
            enrollment.classroom_id,
            MOD(
              ABS(HASHTEXTEXTENDED(enrollment.classroom_id::text, $1)::numeric),
              4
            )::int AS room_cohort_size,
            ROW_NUMBER() OVER (
              PARTITION BY enrollment."SchoolID_Onec", enrollment.classroom_id
              ORDER BY MD5(enrollment.student_uuid::text), enrollment.student_uuid
            ) AS room_rank
          FROM student_term enrollment
          JOIN student_current_enrollment_resolution current_enrollment
            ON current_enrollment.person_uuid = enrollment.person_uuid
           AND current_enrollment.selected_student_uuid = enrollment.student_uuid
           AND current_enrollment.resolution_state = 'ACTIVE'
          JOIN distributed_demo_school_targets_20260826 target
            ON target.school_id = enrollment."SchoolID_Onec"
          WHERE enrollment.deleted_at IS NULL
            AND enrollment.classroom_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM cases tracked_case
              WHERE tracked_case.student_uuid = enrollment.student_uuid
                AND tracked_case.status = 'RESOLVED'
                AND tracked_case.deleted_at IS NULL
            )
        )
        SELECT student_uuid, school_id, classroom_id, room_cohort_size
        FROM room_candidates
        WHERE room_rank <= room_cohort_size
      `,
      [ROOM_COHORT_HASH_SEED],
    );

    const invalidCohorts = (await queryRunner.query(
      `
        WITH showcase_capacity AS (
          SELECT COUNT(*)::int AS student_count
          FROM (
            SELECT day.student_uuid
            FROM attendance_day day
            JOIN student_term enrollment ON enrollment.student_uuid = day.student_uuid
            JOIN student_current_enrollment_resolution current_enrollment
              ON current_enrollment.person_uuid = enrollment.person_uuid
             AND current_enrollment.selected_student_uuid = enrollment.student_uuid
             AND current_enrollment.resolution_state = 'ACTIVE'
            WHERE enrollment."SchoolID_Onec" = $1
              AND enrollment.deleted_at IS NULL
            GROUP BY day.student_uuid
            HAVING COUNT(*) FILTER (WHERE day."AttendanceStatus" = 2) >= 3
          ) showcase_students
        )
        SELECT
          target.school_id,
          COUNT(selected.student_uuid)::int AS selected_student_count,
          capacity.student_count AS showcase_student_count
        FROM distributed_demo_school_targets_20260826 target
        LEFT JOIN distributed_demo_risk_students_20260826 selected
          ON selected.school_id = target.school_id
        CROSS JOIN showcase_capacity capacity
        GROUP BY target.school_id, capacity.student_count
        HAVING COUNT(selected.student_uuid) = 0
          OR COUNT(selected.student_uuid) > capacity.student_count
        ORDER BY target.school_id
      `,
      [SHOWCASE_SCHOOL_ID],
    )) as Array<{
      school_id: number;
      selected_student_count: number;
      showcase_student_count: number;
    }>;
    if (invalidCohorts.length > 0) {
      throw new Error(
        `DistributeDemoAttendanceRisk: school cohort must be non-empty and no larger than the showcase cohort: ${JSON.stringify(invalidCohorts)}`,
      );
    }

    await queryRunner.query(`
      CREATE TEMP TABLE distributed_demo_absence_days_20260826
      ON COMMIT DROP AS
      WITH available_days AS (
        SELECT DISTINCT selected.student_uuid, record."AttendanceDate"::date AS attendance_date
        FROM distributed_demo_risk_students_20260826 selected
        JOIN attendance record ON record.student_uuid = selected.student_uuid
        JOIN attendance_sessions session ON session.id = record.session_id
        WHERE record.session_kind = 'SUBJECT'
          AND session.session_kind = 'SUBJECT'
          AND session.status = 'SUBMITTED'
          AND session.deleted_at IS NULL
      ), ranked_days AS (
        SELECT
          student_uuid,
          attendance_date,
          ROW_NUMBER() OVER (
            PARTITION BY student_uuid
            ORDER BY attendance_date ASC
          ) AS attendance_day_rank
        FROM available_days
      )
      SELECT student_uuid, attendance_date
      FROM ranked_days
      WHERE attendance_day_rank <= 4
    `);

    const incompleteSchools = (await queryRunner.query(`
      WITH incomplete_students AS (
        SELECT selected.school_id, selected.student_uuid
        FROM distributed_demo_risk_students_20260826 selected
        LEFT JOIN distributed_demo_absence_days_20260826 absence
          ON absence.student_uuid = selected.student_uuid
        GROUP BY selected.school_id, selected.student_uuid
        HAVING COUNT(absence.attendance_date) <> 4
      )
      SELECT school_id, COUNT(*)::int AS incomplete_student_count
      FROM incomplete_students
      GROUP BY school_id
      ORDER BY school_id
    `)) as Array<{ school_id: number; incomplete_student_count: number }>;
    if (incompleteSchools.length > 0) {
      throw new Error(
        `DistributeDemoAttendanceRisk: selected students need four submitted subject days: ${JSON.stringify(incompleteSchools)}`,
      );
    }

    await queryRunner.query(`
      UPDATE attendance record
      SET "AttendanceStatus" = 2,
          updated_by = NULL
      FROM distributed_demo_absence_days_20260826 absence
      WHERE absence.student_uuid = record.student_uuid
        AND absence.attendance_date = record."AttendanceDate"::date
        AND record.session_kind = 'SUBJECT'
        AND record."AttendanceStatus" <> 2
    `);

    const invalidSchools = (await queryRunner.query(`
      WITH invalid_students AS (
        SELECT selected.school_id, selected.student_uuid
        FROM distributed_demo_risk_students_20260826 selected
        LEFT JOIN attendance_day day ON day.student_uuid = selected.student_uuid
        GROUP BY selected.school_id, selected.student_uuid
        HAVING COUNT(*) FILTER (WHERE day."AttendanceStatus" = 2) <= 3
      )
      SELECT school_id, COUNT(*)::int AS invalid_student_count
      FROM invalid_students
      GROUP BY school_id
      ORDER BY school_id
    `)) as Array<{ school_id: number; invalid_student_count: number }>;
    if (invalidSchools.length > 0) {
      throw new Error(
        `DistributeDemoAttendanceRisk: selected students did not reach four absent days: ${JSON.stringify(invalidSchools)}`,
      );
    }

    // Profiles are derived. Removing only the changed students makes startup
    // reconciliation recompute them through the canonical risk rule.
    await queryRunner.query(`
      DELETE FROM student_risk_profiles profile
      USING distributed_demo_risk_students_20260826 selected
      WHERE profile.student_uuid = selected.student_uuid
    `);
  }

  /** The generated demo attendance is intentionally retained on rollback. */
  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    return Promise.resolve();
  }
}
