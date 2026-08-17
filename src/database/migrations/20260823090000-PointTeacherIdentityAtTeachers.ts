import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expand step: everything that means "which teacher" starts pointing at
 * `teachers` instead of at that teacher's login account.
 *
 * A teacher's identity lives in `teachers` — name, citizen id, contact, photo —
 * but three places reached it by hopping through `users`, which is why 445 login
 * accounts nobody signs into could not be deleted:
 *
 *   school_teacher_memberships.teacher_user_id   FK users  ON DELETE RESTRICT
 *   task_links.assigned_teacher_user_id          FK users  ON DELETE RESTRICT
 *   attendance."RecordedBy"                      username text, no FK at all
 *
 * The last one is the quiet one: no constraint would have stopped a delete, and
 * 991k rows would simply have started naming an account that no longer exists.
 *
 * Nothing is dropped here. The new columns are added and backfilled, readers
 * switch to them in the same change, and the old columns come out in
 * 20260823120000 once the data is proven — so a revert never has to reconstruct
 * anything.
 */
export class PointTeacherIdentityAtTeachers20260823090000 implements MigrationInterface {
  name = 'PointTeacherIdentityAtTeachers20260823090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links ADD COLUMN IF NOT EXISTS assigned_teacher_id BIGINT
    `);
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD CONSTRAINT fk_task_links_assigned_teacher_row
        FOREIGN KEY (assigned_teacher_id) REFERENCES teachers(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_links_assigned_teacher_row
        ON task_links(assigned_teacher_id)
        WHERE assigned_teacher_id IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE task_links link
      SET assigned_teacher_id = teacher.id
      FROM teachers teacher
      WHERE teacher.linked_user_id = link.assigned_teacher_user_id
        AND teacher.deleted_at IS NULL
        AND link.assigned_teacher_user_id IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE attendance ADD COLUMN IF NOT EXISTS recorded_by_teacher_id BIGINT
    `);
    await queryRunner.query(`
      ALTER TABLE attendance
        ADD CONSTRAINT fk_attendance_recorded_by_teacher
        FOREIGN KEY (recorded_by_teacher_id) REFERENCES teachers(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_recorded_by_teacher
        ON attendance(recorded_by_teacher_id)
        WHERE recorded_by_teacher_id IS NOT NULL
    `);
    // Only a username that resolves to exactly one teacher is claimed. Anything
    // else keeps its "RecordedBy" text, which the readers still fall back to —
    // guessing an identity onto an attendance record would be worse than showing
    // the raw handle it was written with.
    //
    // Production has more than a million attendance rows and enforces a
    // per-statement timeout. Build one migration-only lookup index, then update
    // in bounded batches so the identical backfill cannot become one oversized
    // statement. The index is removed after the backfill.
    await queryRunner.query(`
      CREATE INDEX tmp_20260823_attendance_recorded_by_backfill
      ON attendance ("RecordedBy")
      WHERE recorded_by_teacher_id IS NULL AND "RecordedBy" IS NOT NULL
    `);
    const resolvedTeachers = (await queryRunner.query(`
      SELECT usr.username, min(teacher.id)::text AS teacher_id
      FROM users usr
      JOIN teachers teacher ON teacher.linked_user_id = usr.id AND teacher.deleted_at IS NULL
      GROUP BY usr.username
      HAVING count(*) = 1
      ORDER BY usr.username
    `)) as Array<{ username: string; teacher_id: string }>;
    for (const resolved of resolvedTeachers) {
      let updatedRows: number;
      do {
        const result = (await queryRunner.query(
          `
            WITH candidates AS (
              SELECT ctid
              FROM attendance
              WHERE "RecordedBy" = $1
                AND recorded_by_teacher_id IS NULL
              LIMIT 20000
            ), updated AS (
              UPDATE attendance record
              SET recorded_by_teacher_id = $2
              FROM candidates
              WHERE record.ctid = candidates.ctid
              RETURNING 1
            )
            SELECT COUNT(*)::int AS updated_rows FROM updated
          `,
          [resolved.username, resolved.teacher_id],
        )) as Array<{ updated_rows: number }>;
        updatedRows = Number(result[0]?.updated_rows ?? 0);
      } while (updatedRows > 0);
    }
    await queryRunner.query(`DROP INDEX tmp_20260823_attendance_recorded_by_backfill`);

    // The classroom history screens read the day views, not the table, so the
    // new column has to travel with them or those screens keep resolving names
    // through `users`.
    await queryRunner.query(`
      CREATE OR REPLACE VIEW attendance_day AS
      SELECT
        subject_day.attendance_id AS "AttendanceID",
        subject_day.student_uuid,
        subject_day.attendance_date AS "AttendanceDate",
        subject_day.academic_year AS "AcademicYear_Onec",
        subject_day.semester AS "Semester_Onec",
        subject_day.status AS "AttendanceStatus",
        subject_day.recorded_by AS "RecordedBy",
        subject_day.recorded_at AS "RecordedAt",
        subject_day.late_periods,
        subject_day.recorded_by_teacher_id
      FROM (
        SELECT
          (ARRAY_AGG(
            period."AttendanceID" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
          ))[1] AS attendance_id,
          period.student_uuid,
          period."AttendanceDate"::date AS attendance_date,
          period."AcademicYear_Onec" AS academic_year,
          period."Semester_Onec" AS semester,
          CASE
            WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" <> 4) = 0 THEN 4
            WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" IN (1, 3)) = 0 THEN 2
            WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3) > 0 THEN 3
            ELSE 1
          END AS status,
          (ARRAY_AGG(
            period."RecordedBy" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
          ))[1] AS recorded_by,
          (ARRAY_AGG(
            period.recorded_by_teacher_id ORDER BY period."Period" NULLS LAST, period."AttendanceID"
          ))[1] AS recorded_by_teacher_id,
          MIN(period."RecordedAt") AS recorded_at,
          COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3)::int AS late_periods
        FROM attendance period
        LEFT JOIN attendance_sessions period_session ON period_session.id = period.session_id
        WHERE period.session_kind = 'SUBJECT'
          AND (
            period.session_id IS NULL
            OR (
              period_session.status IN ('SUBMITTED', 'REOPENED')
              AND period_session.deleted_at IS NULL
            )
          )
        GROUP BY
          period.student_uuid,
          period."AttendanceDate",
          period."AcademicYear_Onec",
          period."Semester_Onec"
      ) subject_day

      UNION ALL

      SELECT
        legacy."AttendanceID",
        legacy.student_uuid,
        legacy."AttendanceDate"::date,
        legacy."AcademicYear_Onec",
        legacy."Semester_Onec",
        legacy."AttendanceStatus",
        legacy."RecordedBy",
        legacy."RecordedAt",
        CASE WHEN legacy."AttendanceStatus" = 3 THEN 1 ELSE 0 END,
        legacy.recorded_by_teacher_id
      FROM attendance legacy
      LEFT JOIN attendance_sessions legacy_session ON legacy_session.id = legacy.session_id
      WHERE legacy.session_kind = 'DAILY'
        AND (
          legacy.session_id IS NULL
          OR (
            legacy_session.status IN ('SUBMITTED', 'REOPENED')
            AND legacy_session.deleted_at IS NULL
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM attendance period
          WHERE period.student_uuid = legacy.student_uuid
            AND period."AttendanceDate" = legacy."AttendanceDate"
            AND period.session_kind = 'SUBJECT'
        );
    `);

    await queryRunner.query(`
      CREATE OR REPLACE VIEW attendance_subject_day AS
      SELECT
        (ARRAY_AGG(
          period."AttendanceID" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
        ))[1] AS "AttendanceID",
        period.student_uuid,
        period."AttendanceDate"::date AS "AttendanceDate",
        period."AcademicYear_Onec" AS "AcademicYear_Onec",
        period."Semester_Onec" AS "Semester_Onec",
        session.subject_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" <> 4) = 0 THEN 4
          WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" IN (1, 3)) = 0 THEN 2
          WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3) > 0 THEN 3
          ELSE 1
        END AS "AttendanceStatus",
        (ARRAY_AGG(
          period."RecordedBy" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
        ))[1] AS "RecordedBy",
        MIN(period."RecordedAt") AS "RecordedAt",
        COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3)::int AS late_periods,
        (ARRAY_AGG(
          period.recorded_by_teacher_id ORDER BY period."Period" NULLS LAST, period."AttendanceID"
        ))[1] AS recorded_by_teacher_id
      FROM attendance period
      JOIN attendance_sessions session ON session.id = period.session_id
      WHERE period.session_kind = 'SUBJECT'
        AND session.deleted_at IS NULL
        AND session.subject_id IS NOT NULL
        AND session.status IN ('SUBMITTED', 'REOPENED')
      GROUP BY
        period.student_uuid,
        period."AttendanceDate",
        period."AcademicYear_Onec",
        period."Semester_Onec",
        session.subject_id;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The views select the column, so they have to let go of it first.
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_subject_day`);
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_day`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_attendance_recorded_by_teacher`);
    await queryRunner.query(`
      ALTER TABLE attendance
        DROP CONSTRAINT IF EXISTS fk_attendance_recorded_by_teacher,
        DROP COLUMN IF EXISTS recorded_by_teacher_id
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_links_assigned_teacher_row`);
    await queryRunner.query(`
      ALTER TABLE task_links
        DROP CONSTRAINT IF EXISTS fk_task_links_assigned_teacher_row,
        DROP COLUMN IF EXISTS assigned_teacher_id
    `);

    // Put the views back exactly as 20260820090000 left them, so reverting this
    // migration alone does not take the classroom history screens down with it.
    await queryRunner.query(`
      CREATE VIEW attendance_day AS
      SELECT
        subject_day.attendance_id AS "AttendanceID",
        subject_day.student_uuid,
        subject_day.attendance_date AS "AttendanceDate",
        subject_day.academic_year AS "AcademicYear_Onec",
        subject_day.semester AS "Semester_Onec",
        subject_day.status AS "AttendanceStatus",
        subject_day.recorded_by AS "RecordedBy",
        subject_day.recorded_at AS "RecordedAt",
        subject_day.late_periods
      FROM (
        SELECT
          (ARRAY_AGG(
            period."AttendanceID" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
          ))[1] AS attendance_id,
          period.student_uuid,
          period."AttendanceDate"::date AS attendance_date,
          period."AcademicYear_Onec" AS academic_year,
          period."Semester_Onec" AS semester,
          CASE
            WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" <> 4) = 0 THEN 4
            WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" IN (1, 3)) = 0 THEN 2
            WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3) > 0 THEN 3
            ELSE 1
          END AS status,
          (ARRAY_AGG(
            period."RecordedBy" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
          ))[1] AS recorded_by,
          MIN(period."RecordedAt") AS recorded_at,
          COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3)::int AS late_periods
        FROM attendance period
        LEFT JOIN attendance_sessions period_session ON period_session.id = period.session_id
        WHERE period.session_kind = 'SUBJECT'
          AND (
            period.session_id IS NULL
            OR (
              period_session.status IN ('SUBMITTED', 'REOPENED')
              AND period_session.deleted_at IS NULL
            )
          )
        GROUP BY
          period.student_uuid,
          period."AttendanceDate",
          period."AcademicYear_Onec",
          period."Semester_Onec"
      ) subject_day

      UNION ALL

      SELECT
        legacy."AttendanceID",
        legacy.student_uuid,
        legacy."AttendanceDate"::date,
        legacy."AcademicYear_Onec",
        legacy."Semester_Onec",
        legacy."AttendanceStatus",
        legacy."RecordedBy",
        legacy."RecordedAt",
        CASE WHEN legacy."AttendanceStatus" = 3 THEN 1 ELSE 0 END
      FROM attendance legacy
      LEFT JOIN attendance_sessions legacy_session ON legacy_session.id = legacy.session_id
      WHERE legacy.session_kind = 'DAILY'
        AND (
          legacy.session_id IS NULL
          OR (
            legacy_session.status IN ('SUBMITTED', 'REOPENED')
            AND legacy_session.deleted_at IS NULL
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM attendance period
          WHERE period.student_uuid = legacy.student_uuid
            AND period."AttendanceDate" = legacy."AttendanceDate"
            AND period.session_kind = 'SUBJECT'
        );
    `);

    await queryRunner.query(`
      CREATE VIEW attendance_subject_day AS
      SELECT
        (ARRAY_AGG(
          period."AttendanceID" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
        ))[1] AS "AttendanceID",
        period.student_uuid,
        period."AttendanceDate"::date AS "AttendanceDate",
        period."AcademicYear_Onec" AS "AcademicYear_Onec",
        period."Semester_Onec" AS "Semester_Onec",
        session.subject_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" <> 4) = 0 THEN 4
          WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" IN (1, 3)) = 0 THEN 2
          WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3) > 0 THEN 3
          ELSE 1
        END AS "AttendanceStatus",
        (ARRAY_AGG(
          period."RecordedBy" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
        ))[1] AS "RecordedBy",
        MIN(period."RecordedAt") AS "RecordedAt",
        COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3)::int AS late_periods
      FROM attendance period
      JOIN attendance_sessions session ON session.id = period.session_id
      WHERE period.session_kind = 'SUBJECT'
        AND session.deleted_at IS NULL
        AND session.subject_id IS NOT NULL
        AND session.status IN ('SUBMITTED', 'REOPENED')
      GROUP BY
        period.student_uuid,
        period."AttendanceDate",
        period."AcademicYear_Onec",
        period."Semester_Onec",
        session.subject_id;
    `);
  }
}
