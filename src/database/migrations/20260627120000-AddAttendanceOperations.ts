import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * Adds the school term, explicit calendar day, and daily attendance session
 * model used to distinguish holidays from missing/incomplete check-ins.
 *
 * Existing data is backfilled conservatively:
 * - terms stay DRAFT because attendance history cannot prove official dates;
 * - only dates with existing attendance become BACKFILL school days;
 * - one SUBMITTED session is created per existing class/day/period group.
 *
 * The migration is additive and reversible. attendance.session_id remains
 * nullable for zero-downtime rollout and for quarantining unmatched legacy rows.
 */
export class AddAttendanceOperations20260627120000 implements MigrationInterface {
  name = 'AddAttendanceOperations20260627120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE school_terms (
        id BIGSERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL,
        academic_year INTEGER NOT NULL,
        semester SMALLINT NOT NULL,
        starts_on DATE,
        ends_on DATE,
        status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT fk_school_terms_school
          FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
        CONSTRAINT uq_school_terms_school_year_semester
          UNIQUE (school_id, academic_year, semester),
        CONSTRAINT chk_school_terms_academic_year
          CHECK (academic_year > 0),
        CONSTRAINT chk_school_terms_semester
          CHECK (semester BETWEEN 1 AND 3),
        CONSTRAINT chk_school_terms_status
          CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
        CONSTRAINT chk_school_terms_date_range
          CHECK (
            (starts_on IS NULL AND ends_on IS NULL)
            OR (
              starts_on IS NOT NULL
              AND ends_on IS NOT NULL
              AND starts_on <= ends_on
              AND ends_on - starts_on <= 400
            )
          ),
        CONSTRAINT chk_school_terms_active_dates
          CHECK (status <> 'ACTIVE' OR (starts_on IS NOT NULL AND ends_on IS NOT NULL))
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('school_terms'));
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_school_terms_one_active_per_school
        ON school_terms (school_id)
        WHERE status = 'ACTIVE' AND deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_school_terms_status_dates
        ON school_terms (status, starts_on, ends_on)
    `);

    await queryRunner.query(`
      CREATE TABLE school_calendar_days (
        id BIGSERIAL PRIMARY KEY,
        school_term_id BIGINT NOT NULL,
        calendar_date DATE NOT NULL,
        day_type VARCHAR(16) NOT NULL,
        reason VARCHAR(255),
        source VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT fk_school_calendar_days_term
          FOREIGN KEY (school_term_id) REFERENCES school_terms(id) ON DELETE CASCADE,
        CONSTRAINT uq_school_calendar_days_term_date
          UNIQUE (school_term_id, calendar_date),
        CONSTRAINT chk_school_calendar_days_type
          CHECK (day_type IN ('SCHOOL_DAY', 'HOLIDAY', 'CANCELLED')),
        CONSTRAINT chk_school_calendar_days_source
          CHECK (source IN ('GENERATED', 'MANUAL', 'IMPORT', 'BACKFILL'))
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('school_calendar_days'));
    await queryRunner.query(`
      CREATE INDEX idx_school_calendar_days_type_date
        ON school_calendar_days (school_term_id, day_type, calendar_date)
    `);

    await queryRunner.query(`
      CREATE TABLE attendance_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_term_id BIGINT NOT NULL,
        school_id INTEGER NOT NULL,
        grade_level_id INTEGER NOT NULL,
        room_id INTEGER NOT NULL,
        attendance_date DATE NOT NULL,
        period INTEGER NOT NULL DEFAULT 1,
        session_kind VARCHAR(16) NOT NULL DEFAULT 'DAILY',
        status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
        expected_roster_count INTEGER NOT NULL DEFAULT 0,
        recorded_count INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 1,
        submitted_at TIMESTAMPTZ,
        submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reopened_at TIMESTAMPTZ,
        reopened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        correction_reason VARCHAR(500),
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT fk_attendance_sessions_term
          FOREIGN KEY (school_term_id) REFERENCES school_terms(id) ON DELETE RESTRICT,
        CONSTRAINT fk_attendance_sessions_school
          FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
        CONSTRAINT fk_attendance_sessions_grade
          FOREIGN KEY (grade_level_id) REFERENCES grade_levels(id) ON DELETE RESTRICT,
        CONSTRAINT uq_attendance_sessions_class_day
          UNIQUE (school_term_id, grade_level_id, room_id, attendance_date, period, session_kind),
        CONSTRAINT chk_attendance_sessions_room
          CHECK (room_id > 0),
        CONSTRAINT chk_attendance_sessions_period
          CHECK (period > 0),
        CONSTRAINT chk_attendance_sessions_kind
          CHECK (session_kind IN ('DAILY')),
        CONSTRAINT chk_attendance_sessions_status
          CHECK (status IN ('OPEN', 'SUBMITTED', 'REOPENED', 'VOIDED')),
        CONSTRAINT chk_attendance_sessions_counts
          CHECK (expected_roster_count >= 0 AND recorded_count >= 0),
        CONSTRAINT chk_attendance_sessions_revision
          CHECK (revision > 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('attendance_sessions'));
    await queryRunner.query(`
      CREATE INDEX idx_attendance_sessions_reconciliation
        ON attendance_sessions (school_id, attendance_date, status, grade_level_id, room_id)
    `);

    await queryRunner.query(`ALTER TABLE attendance ADD COLUMN session_id UUID`);
    await queryRunner.query(`
      ALTER TABLE attendance
        ADD CONSTRAINT fk_attendance_session
        FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`CREATE INDEX idx_attendance_session_id ON attendance (session_id)`);

    await queryRunner.query(`
      WITH sources AS (
        SELECT
          "SchoolID_Onec" AS school_id,
          "AcademicYear_Onec" AS academic_year,
          "Semester_Onec" AS semester,
          MIN("AttendanceDate") AS starts_on,
          MAX("AttendanceDate") AS ends_on
        FROM attendance
        WHERE "SchoolID_Onec" IS NOT NULL
          AND "AcademicYear_Onec" IS NOT NULL
          AND "Semester_Onec" IS NOT NULL
        GROUP BY "SchoolID_Onec", "AcademicYear_Onec", "Semester_Onec"
        UNION ALL
        SELECT
          "SchoolID_Onec",
          "AcademicYear_Onec",
          "Semester_Onec",
          NULL::date,
          NULL::date
        FROM student_term
        WHERE "SchoolID_Onec" IS NOT NULL
          AND "AcademicYear_Onec" IS NOT NULL
          AND "Semester_Onec" IS NOT NULL
      ), grouped AS (
        SELECT
          school_id,
          academic_year,
          semester,
          MIN(starts_on) AS starts_on,
          MAX(ends_on) AS ends_on
        FROM sources
        GROUP BY school_id, academic_year, semester
      )
      INSERT INTO school_terms (
        school_id, academic_year, semester, starts_on, ends_on, status
      )
      SELECT school_id, academic_year, semester, starts_on, ends_on, 'DRAFT'
      FROM grouped
      ON CONFLICT (school_id, academic_year, semester) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO school_calendar_days (
        school_term_id, calendar_date, day_type, source
      )
      SELECT DISTINCT st.id, a."AttendanceDate", 'SCHOOL_DAY', 'BACKFILL'
      FROM attendance a
      JOIN school_terms st
        ON st.school_id = a."SchoolID_Onec"
       AND st.academic_year = a."AcademicYear_Onec"
       AND st.semester = a."Semester_Onec"
      ON CONFLICT (school_term_id, calendar_date) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO attendance_sessions (
        school_term_id,
        school_id,
        grade_level_id,
        room_id,
        attendance_date,
        period,
        session_kind,
        status,
        expected_roster_count,
        recorded_count,
        submitted_at,
        correction_reason
      )
      SELECT
        st.id,
        a."SchoolID_Onec",
        a."GradeLevelID_Onec",
        a."RoomID_Onec",
        a."AttendanceDate",
        a."Period",
        'DAILY',
        'SUBMITTED',
        GREATEST(
          COUNT(*)::int,
          (
            SELECT COUNT(*)::int
            FROM student_term roster
            WHERE roster."SchoolID_Onec" = a."SchoolID_Onec"
              AND roster."AcademicYear_Onec" = a."AcademicYear_Onec"
              AND roster."Semester_Onec" = a."Semester_Onec"
              AND roster."GradeLevelID_Onec" = a."GradeLevelID_Onec"
              AND roster."RoomID_Onec" = a."RoomID_Onec"
              AND roster.deleted_at IS NULL
          )
        ),
        COUNT(*)::int,
        MAX(a."RecordedAt"),
        'Backfilled from legacy attendance records'
      FROM attendance a
      JOIN school_terms st
        ON st.school_id = a."SchoolID_Onec"
       AND st.academic_year = a."AcademicYear_Onec"
       AND st.semester = a."Semester_Onec"
      GROUP BY
        st.id,
        a."SchoolID_Onec",
        a."AcademicYear_Onec",
        a."Semester_Onec",
        a."GradeLevelID_Onec",
        a."RoomID_Onec",
        a."AttendanceDate",
        a."Period"
      ON CONFLICT (
        school_term_id, grade_level_id, room_id, attendance_date, period, session_kind
      ) DO NOTHING
    `);

    await queryRunner.query(`
      UPDATE attendance a
      SET session_id = s.id
      FROM school_terms st
      JOIN attendance_sessions s ON s.school_term_id = st.id
      WHERE a.session_id IS NULL
        AND st.school_id = a."SchoolID_Onec"
        AND st.academic_year = a."AcademicYear_Onec"
        AND st.semester = a."Semester_Onec"
        AND s.school_id = a."SchoolID_Onec"
        AND s.grade_level_id = a."GradeLevelID_Onec"
        AND s.room_id = a."RoomID_Onec"
        AND s.attendance_date = a."AttendanceDate"
        AND s.period = a."Period"
        AND s.session_kind = 'DAILY'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_attendance_session_id`);
    await queryRunner.query(
      `ALTER TABLE attendance DROP CONSTRAINT IF EXISTS fk_attendance_session`,
    );
    await queryRunner.query(`ALTER TABLE attendance DROP COLUMN IF EXISTS session_id`);

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_attendance_sessions_set_updated_at ON attendance_sessions`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS attendance_sessions`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_school_calendar_days_set_updated_at ON school_calendar_days`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS school_calendar_days`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_school_terms_set_updated_at ON school_terms`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS school_terms`);
  }
}
