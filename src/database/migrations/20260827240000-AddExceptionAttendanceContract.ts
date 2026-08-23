import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const LEGACY_ATTENDANCE_DAY_VIEW = `
  CREATE VIEW attendance_day WITH (security_invoker = true) AS
  SELECT
    (ARRAY_AGG(
      period."AttendanceID" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
    ))[1] AS "AttendanceID",
    period.student_uuid,
    period."AttendanceDate"::date AS "AttendanceDate",
    period."AcademicYear_Onec" AS "AcademicYear_Onec",
    period."Semester_Onec" AS "Semester_Onec",
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
`;

const EXCEPTION_ATTENDANCE_DAY_VIEW = `
  CREATE VIEW attendance_day WITH (security_invoker = true) AS
  WITH period_marks AS (
    SELECT
      mark."AttendanceID",
      mark.student_uuid,
      mark."AttendanceDate"::date AS attendance_date,
      mark."AcademicYear_Onec" AS academic_year,
      mark."Semester_Onec" AS semester,
      mark."Period" AS period,
      mark."AttendanceStatus" AS attendance_status,
      mark."RecordedBy" AS recorded_by,
      mark."RecordedAt" AS recorded_at,
      mark.recorded_by_teacher_id
    FROM attendance mark
    LEFT JOIN attendance_sessions session ON session.id = mark.session_id
    WHERE mark.session_kind = 'SUBJECT'
      AND (
        mark.session_id IS NULL
        OR (
          session.record_storage_mode = 'FULL_ROSTER'
          AND session.status IN ('SUBMITTED', 'REOPENED')
          AND session.deleted_at IS NULL
        )
      )

    UNION ALL

    SELECT
      NULL::integer AS "AttendanceID",
      roster.student_uuid,
      session.attendance_date,
      term.academic_year,
      term.semester::integer,
      session.period,
      COALESCE(exception.attendance_status_code, 1)::smallint,
      COALESCE(
        NULLIF(TRIM(marker_teacher.first_name || ' ' || marker_teacher.last_name), ''),
        NULLIF(TRIM(submitter_teacher.first_name || ' ' || submitter_teacher.last_name), ''),
        submitter_user.username,
        'classroom-check-in'
      )::varchar AS recorded_by,
      COALESCE(exception.marked_at, session.submitted_at) AS recorded_at,
      COALESCE(marker_teacher.id, submitter_teacher.id) AS recorded_by_teacher_id
    FROM attendance_sessions session
    JOIN attendance_session_roster roster ON roster.session_id = session.id
    JOIN school_terms term ON term.id = session.school_term_id
    LEFT JOIN attendance_exceptions exception
      ON exception.session_id = session.id
     AND exception.student_uuid = roster.student_uuid
     AND exception.deleted_at IS NULL
    LEFT JOIN school_teacher_memberships marker_membership
      ON marker_membership.id = exception.marked_by_teacher_membership_id
    LEFT JOIN teachers marker_teacher ON marker_teacher.id = marker_membership.teacher_id
    LEFT JOIN school_teacher_memberships submitter_membership
      ON submitter_membership.id = session.submitted_by_teacher_membership_id
    LEFT JOIN teachers submitter_teacher ON submitter_teacher.id = submitter_membership.teacher_id
    LEFT JOIN users submitter_user ON submitter_user.id = session.submitted_by
    WHERE session.record_storage_mode = 'EXCEPTIONS'
      AND session.status IN ('SUBMITTED', 'REOPENED')
      AND session.deleted_at IS NULL
  )
  SELECT
    (ARRAY_AGG(
      period."AttendanceID" ORDER BY period.period NULLS LAST, period."AttendanceID"
    ))[1] AS "AttendanceID",
    period.student_uuid,
    period.attendance_date AS "AttendanceDate",
    period.academic_year AS "AcademicYear_Onec",
    period.semester AS "Semester_Onec",
    CASE
      WHEN COUNT(*) FILTER (WHERE period.attendance_status <> 4) = 0 THEN 4
      WHEN COUNT(*) FILTER (WHERE period.attendance_status IN (1, 3)) = 0 THEN 2
      WHEN COUNT(*) FILTER (WHERE period.attendance_status = 3) > 0 THEN 3
      ELSE 1
    END AS "AttendanceStatus",
    (ARRAY_AGG(
      period.recorded_by ORDER BY period.period NULLS LAST, period."AttendanceID"
    ))[1] AS "RecordedBy",
    MIN(period.recorded_at) AS "RecordedAt",
    COUNT(*) FILTER (WHERE period.attendance_status = 3)::int AS late_periods,
    (ARRAY_AGG(
      period.recorded_by_teacher_id ORDER BY period.period NULLS LAST, period."AttendanceID"
    ))[1] AS recorded_by_teacher_id
  FROM period_marks period
  GROUP BY
    period.student_uuid,
    period.attendance_date,
    period.academic_year,
    period.semester
`;

const EXCEPTION_ATTENDANCE_SUBJECT_DAY_VIEW = EXCEPTION_ATTENDANCE_DAY_VIEW.replace(
  'CREATE VIEW attendance_day',
  'CREATE VIEW attendance_subject_day',
)
  .replace(
    'mark.recorded_by_teacher_id\n    FROM attendance mark',
    'mark.recorded_by_teacher_id,\n      session.subject_id\n    FROM attendance mark',
  )
  .replace(
    'COALESCE(marker_teacher.id, submitter_teacher.id) AS recorded_by_teacher_id\n    FROM attendance_sessions session',
    'COALESCE(marker_teacher.id, submitter_teacher.id) AS recorded_by_teacher_id,\n      session.subject_id\n    FROM attendance_sessions session',
  )
  .replace(
    'period.semester AS "Semester_Onec",\n    CASE',
    'period.semester AS "Semester_Onec",\n    period.subject_id,\n    CASE',
  )
  .replace('    period.semester\n', '    period.semester,\n    period.subject_id\n');

const LEGACY_ATTENDANCE_SUBJECT_DAY_VIEW = `
  CREATE VIEW attendance_subject_day WITH (security_invoker = true) AS
  SELECT
    (ARRAY_AGG(period."AttendanceID" ORDER BY period."Period" NULLS LAST, period."AttendanceID"))[1]
      AS "AttendanceID",
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
    (ARRAY_AGG(period."RecordedBy" ORDER BY period."Period" NULLS LAST, period."AttendanceID"))[1]
      AS "RecordedBy",
    MIN(period."RecordedAt") AS "RecordedAt",
    COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3)::int AS late_periods,
    (ARRAY_AGG(period.recorded_by_teacher_id ORDER BY period."Period" NULLS LAST, period."AttendanceID"))[1]
      AS recorded_by_teacher_id
  FROM attendance period
  JOIN attendance_sessions session ON session.id = period.session_id
  WHERE period.session_kind = 'SUBJECT'
    AND session.deleted_at IS NULL
    AND session.subject_id IS NOT NULL
    AND session.status IN ('SUBMITTED', 'REOPENED')
  GROUP BY period.student_uuid, period."AttendanceDate", period."AcademicYear_Onec",
           period."Semester_Onec", session.subject_id
`;

const REVOKE_ATTENDANCE_VIEW_ACCESS = `
  DO $secure_attendance_views$
  DECLARE role_name TEXT;
  BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE attendance_day, attendance_subject_day FROM %I',
          role_name
        );
      END IF;
    END LOOP;
  END;
  $secure_attendance_views$
`;

/**
 * Adds the replacement attendance identity and exception-only storage without
 * deleting historical full-roster marks. Historical sessions remain explicitly
 * tagged FULL_ROSTER; every session created after this migration is EXCEPTIONS.
 */
export class AddExceptionAttendanceContract20260827240000 implements MigrationInterface {
  name = 'AddExceptionAttendanceContract20260827240000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const mapping = (await queryRunner.query(`
      SELECT
        COUNT(*)::int AS session_count,
        COUNT(slot.id)::int AS mapped_slot_count,
        COUNT(offering.id)::int AS mapped_offering_count,
        COUNT(*) FILTER (
          WHERE slot.classroom_id <> classroom.id
             OR slot.subject_id <> school_subject.subject_id
        )::int AS identity_mismatch_count
      FROM attendance_sessions session
      LEFT JOIN timetable_slots slot ON slot.id = session.timetable_slot_id
      LEFT JOIN school_classrooms classroom ON classroom.id = slot.classroom_id
      LEFT JOIN school_subjects school_subject
        ON school_subject.school_id = session.school_id
       AND school_subject.subject_id = session.subject_id
       AND school_subject.subject_status = 'ACTIVE'
       AND school_subject.deleted_at IS NULL
      LEFT JOIN classroom_subjects offering
        ON offering.classroom_id = classroom.id
       AND offering.school_subject_id = school_subject.id
       AND offering.offering_status = 'ACTIVE'
       AND offering.deleted_at IS NULL
    `)) as Array<{
      session_count: number;
      mapped_slot_count: number;
      mapped_offering_count: number;
      identity_mismatch_count: number;
    }>;
    const proof = mapping[0];
    if (
      Number(proof?.session_count ?? 0) !== Number(proof?.mapped_slot_count ?? -1) ||
      Number(proof?.session_count ?? 0) !== Number(proof?.mapped_offering_count ?? -1) ||
      Number(proof?.identity_mismatch_count ?? -1) !== 0
    ) {
      throw new Error(
        'AddExceptionAttendanceContract: every historical session must map to one classroom offering',
      );
    }

    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        ADD COLUMN classroom_id BIGINT,
        ADD COLUMN classroom_subject_id BIGINT,
        ADD COLUMN checking_started_at TIMESTAMPTZ,
        ADD COLUMN exception_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN record_storage_mode VARCHAR(16),
        ADD COLUMN started_by_teacher_membership_id BIGINT,
        ADD COLUMN submitted_by_teacher_membership_id BIGINT
    `);

    await queryRunner.query(`
      WITH session_marks AS (
        SELECT
          session.id,
          MIN(COALESCE(mark.marked_at, mark."RecordedAt", mark.created_at)) AS first_marked_at,
          COUNT(mark."AttendanceID") FILTER (
            WHERE mark."AttendanceStatus" IN (2, 3, 4)
          )::int AS exception_count
        FROM attendance_sessions session
        LEFT JOIN attendance mark ON mark.session_id = session.id
        GROUP BY session.id
      ), mapped_sessions AS (
        SELECT
          session.id,
          slot.classroom_id,
          offering.id AS classroom_subject_id,
          LEAST(
            session.created_at,
            COALESCE(session.submitted_at, session.created_at),
            COALESCE(session_marks.first_marked_at, session.created_at)
          ) AS checking_started_at,
          session_marks.exception_count
        FROM attendance_sessions session
        JOIN timetable_slots slot ON slot.id = session.timetable_slot_id
        JOIN school_subjects school_subject
          ON school_subject.school_id = slot.school_id
         AND school_subject.subject_id = slot.subject_id
         AND school_subject.subject_status = 'ACTIVE'
         AND school_subject.deleted_at IS NULL
        JOIN classroom_subjects offering
          ON offering.classroom_id = slot.classroom_id
         AND offering.school_subject_id = school_subject.id
         AND offering.offering_status = 'ACTIVE'
         AND offering.deleted_at IS NULL
        JOIN session_marks ON session_marks.id = session.id
      )
      UPDATE attendance_sessions session
      SET classroom_id = mapped.classroom_id,
          classroom_subject_id = mapped.classroom_subject_id,
          checking_started_at = mapped.checking_started_at,
          exception_count = mapped.exception_count,
          record_storage_mode = 'FULL_ROSTER'
      FROM mapped_sessions mapped
      WHERE mapped.id = session.id
    `);

    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        ALTER COLUMN period DROP NOT NULL,
        ALTER COLUMN classroom_id SET NOT NULL,
        ALTER COLUMN classroom_subject_id SET NOT NULL,
        ALTER COLUMN checking_started_at SET NOT NULL,
        ALTER COLUMN record_storage_mode SET DEFAULT 'EXCEPTIONS',
        ALTER COLUMN record_storage_mode SET NOT NULL,
        ADD CONSTRAINT uq_attendance_sessions_id_school UNIQUE (id, school_id),
        DROP CONSTRAINT uq_attendance_sessions_class_day,
        DROP CONSTRAINT chk_attendance_sessions_subject_shape,
        ADD CONSTRAINT fk_attendance_sessions_classroom_identity
          FOREIGN KEY (classroom_id, school_term_id, school_id)
          REFERENCES school_classrooms(id, school_term_id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT fk_attendance_sessions_classroom_subject_identity
          FOREIGN KEY (classroom_subject_id, classroom_id, school_id)
          REFERENCES classroom_subjects(id, classroom_id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT fk_attendance_sessions_started_by_membership
          FOREIGN KEY (started_by_teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT fk_attendance_sessions_submitted_by_membership
          FOREIGN KEY (submitted_by_teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_attendance_sessions_storage_mode
          CHECK (record_storage_mode IN ('FULL_ROSTER', 'EXCEPTIONS')),
        ADD CONSTRAINT chk_attendance_sessions_exception_count
          CHECK (exception_count >= 0 AND exception_count <= expected_roster_count),
        ADD CONSTRAINT chk_attendance_sessions_target_timeline
          CHECK (
            submitted_at IS NULL
            OR checking_started_at <= submitted_at
          ),
        ADD CONSTRAINT chk_attendance_sessions_subject_shape
          CHECK (
            subject_id IS NOT NULL
            AND (
              (
                record_storage_mode = 'FULL_ROSTER'
                AND timetable_slot_id IS NOT NULL
                AND period IS NOT NULL
                AND period > 0
              )
              OR (
                record_storage_mode = 'EXCEPTIONS'
                AND timetable_slot_id IS NULL
                AND period IS NULL
              )
            )
          )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_attendance_sessions_full_roster_session
        ON attendance_sessions (
          school_term_id,
          classroom_id,
          classroom_subject_id,
          attendance_date,
          period
        )
        WHERE deleted_at IS NULL AND record_storage_mode = 'FULL_ROSTER';
      CREATE UNIQUE INDEX uq_attendance_sessions_exception_session
        ON attendance_sessions (
          school_term_id,
          classroom_id,
          classroom_subject_id,
          attendance_date
        )
        WHERE deleted_at IS NULL AND record_storage_mode = 'EXCEPTIONS';
      CREATE INDEX idx_attendance_sessions_classroom_date
        ON attendance_sessions (classroom_id, attendance_date DESC, period, status)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_attendance_sessions_classroom_subject
        ON attendance_sessions (classroom_subject_id, attendance_date DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_attendance_sessions_started_by_membership
        ON attendance_sessions (started_by_teacher_membership_id)
        WHERE started_by_teacher_membership_id IS NOT NULL;
      CREATE INDEX idx_attendance_sessions_submitted_by_membership
        ON attendance_sessions (submitted_by_teacher_membership_id)
        WHERE submitted_by_teacher_membership_id IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE attendance_session_roster (
        session_id UUID NOT NULL,
        school_id INTEGER NOT NULL,
        student_uuid UUID NOT NULL,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT pk_attendance_session_roster PRIMARY KEY (session_id, student_uuid),
        CONSTRAINT fk_attendance_session_roster_session_school
          FOREIGN KEY (session_id, school_id) REFERENCES attendance_sessions(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_session_roster_student
          FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid)
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
      ${auditUpdatedAtTriggerSql('attendance_session_roster')}

      CREATE INDEX idx_attendance_session_roster_student_session
        ON attendance_session_roster (student_uuid, session_id);
      ALTER TABLE attendance_session_roster ENABLE ROW LEVEL SECURITY;

      CREATE TABLE attendance_exceptions (
        id BIGSERIAL PRIMARY KEY,
        session_id UUID NOT NULL,
        school_id INTEGER NOT NULL,
        student_uuid UUID NOT NULL,
        attendance_status_code SMALLINT NOT NULL,
        marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        marked_by_teacher_membership_id BIGINT,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT uq_attendance_exceptions_session_student
          UNIQUE (session_id, student_uuid),
        CONSTRAINT fk_attendance_exceptions_session_school
          FOREIGN KEY (session_id, school_id) REFERENCES attendance_sessions(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_exceptions_roster
          FOREIGN KEY (session_id, student_uuid)
          REFERENCES attendance_session_roster(session_id, student_uuid)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_exceptions_status
          FOREIGN KEY (attendance_status_code) REFERENCES attendance_record_statuses(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_exceptions_marked_by_membership_school
          FOREIGN KEY (marked_by_teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_attendance_exceptions_status
          CHECK (attendance_status_code IN (2, 3, 4))
      );
      ${auditUpdatedAtTriggerSql('attendance_exceptions')}

      CREATE INDEX idx_attendance_exceptions_student_session
        ON attendance_exceptions (student_uuid, session_id);
      CREATE INDEX idx_attendance_exceptions_status_session
        ON attendance_exceptions (attendance_status_code, session_id);
      CREATE INDEX idx_attendance_exceptions_marked_by_membership
        ON attendance_exceptions (marked_by_teacher_membership_id, school_id)
        WHERE marked_by_teacher_membership_id IS NOT NULL;

      ALTER TABLE attendance_exceptions ENABLE ROW LEVEL SECURITY;
    `);

    await queryRunner.query(`
      DO $secure_attendance_exceptions$
      DECLARE
        role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
        LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON TABLE attendance_session_roster, attendance_exceptions FROM %I',
              role_name
            );
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON SEQUENCE attendance_exceptions_id_seq FROM %I',
              role_name
            );
          END IF;
        END LOOP;
      END;
      $secure_attendance_exceptions$;
    `);

    await queryRunner.query(`
      INSERT INTO attendance_session_roster (
        session_id,
        school_id,
        student_uuid,
        created_at,
        created_by,
        updated_at,
        updated_by
      )
      SELECT
        mark.session_id,
        session.school_id,
        mark.student_uuid,
        MIN(mark.created_at),
        (ARRAY_AGG(mark.created_by ORDER BY mark.created_at, mark."AttendanceID"))[1],
        MAX(mark.updated_at),
        (ARRAY_AGG(mark.updated_by ORDER BY mark.updated_at DESC, mark."AttendanceID" DESC))[1]
      FROM attendance mark
      JOIN attendance_sessions session ON session.id = mark.session_id
      WHERE mark.session_id IS NOT NULL
      GROUP BY mark.session_id, session.school_id, mark.student_uuid
      ON CONFLICT (session_id, student_uuid) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO attendance_exceptions (
        session_id,
        school_id,
        student_uuid,
        attendance_status_code,
        marked_at,
        marked_by_teacher_membership_id,
        created_at,
        created_by,
        updated_at,
        updated_by
      )
      SELECT
        mark.session_id,
        session.school_id,
        mark.student_uuid,
        mark."AttendanceStatus",
        COALESCE(mark.marked_at, mark."RecordedAt", mark.created_at),
        membership.id,
        mark.created_at,
        mark.created_by,
        mark.updated_at,
        mark.updated_by
      FROM attendance mark
      JOIN attendance_sessions session ON session.id = mark.session_id
      LEFT JOIN LATERAL (
        SELECT candidate.id
        FROM school_teacher_memberships candidate
        WHERE candidate.school_id = session.school_id
          AND candidate.teacher_id = mark.recorded_by_teacher_id
        ORDER BY
          (candidate.deleted_at IS NULL) DESC,
          candidate.started_on DESC,
          candidate.id DESC
        LIMIT 1
      ) membership ON mark.recorded_by_teacher_id IS NOT NULL
      WHERE mark."AttendanceStatus" IN (2, 3, 4)
      ON CONFLICT (session_id, student_uuid) DO UPDATE
      SET attendance_status_code = EXCLUDED.attendance_status_code,
          marked_at = EXCLUDED.marked_at,
          marked_by_teacher_membership_id = EXCLUDED.marked_by_teacher_membership_id,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by
    `);

    const reconciliation = (await queryRunner.query(`
      SELECT
        (SELECT COUNT(*)::int
         FROM attendance_sessions
         WHERE classroom_id IS NULL
            OR classroom_subject_id IS NULL
            OR checking_started_at IS NULL
            OR record_storage_mode <> 'FULL_ROSTER') AS invalid_session_count,
        (SELECT COUNT(*)::int
         FROM attendance mark
         WHERE mark."AttendanceStatus" IN (2, 3, 4)) AS source_exception_count,
        (SELECT COUNT(*)::int FROM attendance_exceptions) AS target_exception_count,
        (SELECT COUNT(*)::int
         FROM attendance_sessions session
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS roster_count
           FROM attendance_session_roster roster
           WHERE roster.session_id = session.id
         ) roster ON TRUE
         WHERE roster.roster_count <> session.expected_roster_count) AS roster_count_mismatch,
        (SELECT COUNT(*)::int
         FROM attendance_session_roster roster
         JOIN attendance_sessions session ON session.id = roster.session_id
         JOIN student_term student ON student.student_uuid = roster.student_uuid
         WHERE student.school_term_id <> session.school_term_id
            OR student.classroom_id <> session.classroom_id
            OR roster.school_id <> session.school_id) AS roster_scope_mismatch_count,
        (SELECT COUNT(*)::int
         FROM attendance_exceptions exception
         JOIN attendance_sessions session ON session.id = exception.session_id
         WHERE exception.school_id <> session.school_id) AS exception_school_mismatch_count
    `)) as Array<{
      invalid_session_count: number;
      source_exception_count: number;
      target_exception_count: number;
      roster_count_mismatch: number;
      roster_scope_mismatch_count: number;
      exception_school_mismatch_count: number;
    }>;
    const result = reconciliation[0];
    if (
      Number(result?.invalid_session_count ?? -1) !== 0 ||
      Number(result?.source_exception_count ?? -1) !==
        Number(result?.target_exception_count ?? -2) ||
      Number(result?.roster_count_mismatch ?? -1) !== 0 ||
      Number(result?.roster_scope_mismatch_count ?? -1) !== 0 ||
      Number(result?.exception_school_mismatch_count ?? -1) !== 0
    ) {
      throw new Error('AddExceptionAttendanceContract: attendance reconciliation failed');
    }

    await queryRunner.query(`DROP VIEW IF EXISTS attendance_subject_day`);
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_day`);
    await queryRunner.query(EXCEPTION_ATTENDANCE_DAY_VIEW);
    await queryRunner.query(EXCEPTION_ATTENDANCE_SUBJECT_DAY_VIEW);
    await queryRunner.query(REVOKE_ATTENDANCE_VIEW_ACCESS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $guard_exception_attendance_rollback$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM attendance_sessions
          WHERE record_storage_mode = 'EXCEPTIONS'
        ) THEN
          RAISE EXCEPTION
            'Refusing rollback: exception-only attendance sessions contain target consumer data';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM attendance_exceptions target
          FULL JOIN (
            SELECT * FROM attendance
            WHERE "AttendanceStatus" IN (2, 3, 4)
          ) source
            ON source.session_id = target.session_id
           AND source.student_uuid = target.student_uuid
          WHERE target.id IS NULL
             OR source."AttendanceID" IS NULL
             OR target.attendance_status_code <> source."AttendanceStatus"
        ) THEN
          RAISE EXCEPTION
            'Refusing rollback: attendance_exceptions no longer matches its historical source';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM attendance_session_roster target
          FULL JOIN (
            SELECT DISTINCT session_id, student_uuid
            FROM attendance
          ) source
            ON source.session_id = target.session_id
           AND source.student_uuid = target.student_uuid
          WHERE target.session_id IS NULL
             OR source.session_id IS NULL
        ) THEN
          RAISE EXCEPTION
            'Refusing rollback: attendance_session_roster no longer matches its historical source';
        END IF;
      END;
      $guard_exception_attendance_rollback$;

      DROP VIEW IF EXISTS attendance_subject_day;
      DROP VIEW IF EXISTS attendance_day;
      DROP TABLE attendance_exceptions;
      DROP TABLE IF EXISTS attendance_session_roster;

      DROP INDEX IF EXISTS idx_attendance_sessions_submitted_by_membership;
      DROP INDEX IF EXISTS idx_attendance_sessions_started_by_membership;
      DROP INDEX IF EXISTS idx_attendance_sessions_classroom_subject;
      DROP INDEX IF EXISTS idx_attendance_sessions_classroom_date;
      DROP INDEX IF EXISTS uq_attendance_sessions_exception_session;
      DROP INDEX IF EXISTS uq_attendance_sessions_full_roster_session;

      ALTER TABLE attendance_sessions
        ALTER COLUMN period SET NOT NULL,
        DROP CONSTRAINT chk_attendance_sessions_subject_shape,
        DROP CONSTRAINT chk_attendance_sessions_target_timeline,
        DROP CONSTRAINT chk_attendance_sessions_exception_count,
        DROP CONSTRAINT chk_attendance_sessions_storage_mode,
        DROP CONSTRAINT fk_attendance_sessions_submitted_by_membership,
        DROP CONSTRAINT fk_attendance_sessions_started_by_membership,
        DROP CONSTRAINT fk_attendance_sessions_classroom_subject_identity,
        DROP CONSTRAINT fk_attendance_sessions_classroom_identity,
        DROP CONSTRAINT uq_attendance_sessions_id_school,
        ADD CONSTRAINT uq_attendance_sessions_class_day
          UNIQUE (
            school_term_id,
            grade_level_id,
            room_id,
            attendance_date,
            period,
            session_kind
          ),
        ADD CONSTRAINT chk_attendance_sessions_subject_shape
          CHECK (subject_id IS NOT NULL AND timetable_slot_id IS NOT NULL),
        DROP COLUMN submitted_by_teacher_membership_id,
        DROP COLUMN started_by_teacher_membership_id,
        DROP COLUMN record_storage_mode,
        DROP COLUMN exception_count,
        DROP COLUMN checking_started_at,
        DROP COLUMN classroom_subject_id,
        DROP COLUMN classroom_id
    `);
    await queryRunner.query(LEGACY_ATTENDANCE_DAY_VIEW);
    await queryRunner.query(LEGACY_ATTENDANCE_SUBJECT_DAY_VIEW);
    await queryRunner.query(REVOKE_ATTENDANCE_VIEW_ACCESS);
  }
}
