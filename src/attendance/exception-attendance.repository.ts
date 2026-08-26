import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import type {
  CheckInClassroomRow,
  CheckInRosterRow,
  CheckInSubjectRow,
  ExceptionAttendanceActor,
  ExceptionAttendanceSessionRow,
  PreparedAttendanceException,
  StoredAttendanceExceptionRow,
} from './exception-attendance.types';

@Injectable()
export class ExceptionAttendanceRepository {
  constructor(private readonly dataSource: DataSource) {}

  async withTransaction<T>(operation: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const result = await operation(runner);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  private classroomSelect(): string {
    return `
      SELECT
        classroom.id::text AS classroom_id,
        classroom.school_id,
        school.name AS school_name,
        school.school_status,
        classroom.school_term_id::text,
        term.academic_year,
        term.semester,
        term.status AS term_status,
        term.starts_on::text,
        term.ends_on::text,
        classroom.grade_level_id,
        grade.label AS grade_label,
        classroom.legacy_room_number,
        classroom.room_code,
        classroom.room_name,
        classroom.classroom_status
      FROM school_classrooms classroom
      JOIN schools school ON school.id = classroom.school_id
      JOIN school_terms term
        ON term.id = classroom.school_term_id
       AND term.school_id = classroom.school_id
      JOIN grade_levels grade ON grade.id = classroom.grade_level_id
    `;
  }

  async findClassroom(classroomId: number): Promise<CheckInClassroomRow | null> {
    const result = await queryDataSource<CheckInClassroomRow>(
      this.dataSource,
      `${this.classroomSelect()}
       WHERE classroom.id = $1
         AND classroom.deleted_at IS NULL
         AND term.deleted_at IS NULL`,
      [classroomId],
    );
    return result.rows[0] ?? null;
  }

  async listSubjects(classroomId: number): Promise<CheckInSubjectRow[]> {
    const result = await queryDataSource<CheckInSubjectRow>(
      this.dataSource,
      `
        SELECT
          offering.id::text AS classroom_subject_id,
          offering.school_subject_id::text,
          school_subject.subject_id,
          subject.code,
          subject.name_th
        FROM classroom_subjects offering
        JOIN school_subjects school_subject
          ON school_subject.id = offering.school_subject_id
         AND school_subject.school_id = offering.school_id
        JOIN subjects subject ON subject.id = school_subject.subject_id
        WHERE offering.classroom_id = $1
          AND offering.offering_status = 'ACTIVE'
          AND offering.deleted_at IS NULL
          AND school_subject.subject_status = 'ACTIVE'
          AND school_subject.deleted_at IS NULL
          AND subject.is_active
          AND subject.deleted_at IS NULL
        ORDER BY subject.name_th, subject.code
      `,
      [classroomId],
    );
    return result.rows;
  }

  async listRoster(classroomId: number): Promise<CheckInRosterRow[]> {
    const result = await queryDataSource<CheckInRosterRow>(
      this.dataSource,
      `
        SELECT
          enrollment.student_uuid::text,
          enrollment.student_number,
          enrollment."FirstName_Onec" AS first_name,
          enrollment."LastName_Onec" AS last_name,
          (person.photo_storage_key IS NOT NULL) AS has_photo,
          person.updated_at AS photo_updated_at
        FROM student_term enrollment
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = enrollment.person_uuid
         AND current_enrollment.selected_student_uuid = enrollment.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        LEFT JOIN student_person person ON person.person_uuid = enrollment.person_uuid
        WHERE enrollment.classroom_id = $1
          AND enrollment.deleted_at IS NULL
        ORDER BY
          enrollment.student_number NULLS LAST,
          enrollment."FirstName_Onec",
          enrollment."LastName_Onec",
          enrollment.student_uuid
      `,
      [classroomId],
    );
    return result.rows;
  }

  async findStudentPhotoStorageKey(
    classroomId: number,
    studentUuid: string,
  ): Promise<string | null> {
    const result = await queryDataSource<{ photo_storage_key: string | null }>(
      this.dataSource,
      `
        SELECT person.photo_storage_key
        FROM student_term enrollment
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = enrollment.person_uuid
         AND current_enrollment.selected_student_uuid = enrollment.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        JOIN student_person person ON person.person_uuid = enrollment.person_uuid
        WHERE enrollment.classroom_id = $1
          AND enrollment.student_uuid = $2
          AND enrollment.deleted_at IS NULL
        LIMIT 1
      `,
      [classroomId, studentUuid],
    );
    return result.rows[0]?.photo_storage_key ?? null;
  }

  async lockStartContext(
    classroomId: number,
    classroomSubjectId: number,
    runner: QueryRunner,
  ): Promise<
    | (CheckInClassroomRow & {
        classroom_subject_id: string;
        subject_id: number;
        subject_code: string;
      })
    | null
  > {
    const rows = (await runner.query(
      `
        SELECT
          classroom.id::text AS classroom_id,
          classroom.school_id,
          school.name AS school_name,
          school.school_status,
          classroom.school_term_id::text,
          term.academic_year,
          term.semester,
          term.status AS term_status,
          term.starts_on::text,
          term.ends_on::text,
          classroom.grade_level_id,
          grade.label AS grade_label,
          classroom.legacy_room_number,
          classroom.room_code,
          classroom.room_name,
          classroom.classroom_status,
          offering.id::text AS classroom_subject_id,
          school_subject.subject_id,
          subject.code AS subject_code
        FROM school_classrooms classroom
        JOIN schools school ON school.id = classroom.school_id
        JOIN school_terms term
          ON term.id = classroom.school_term_id
         AND term.school_id = classroom.school_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        JOIN classroom_subjects offering
          ON offering.id = $2
         AND offering.classroom_id = classroom.id
         AND offering.school_id = classroom.school_id
         AND offering.offering_status = 'ACTIVE'
         AND offering.deleted_at IS NULL
        JOIN school_subjects school_subject
          ON school_subject.id = offering.school_subject_id
         AND school_subject.school_id = offering.school_id
         AND school_subject.subject_status = 'ACTIVE'
         AND school_subject.deleted_at IS NULL
        JOIN subjects subject
          ON subject.id = school_subject.subject_id
         AND subject.is_active
         AND subject.deleted_at IS NULL
        WHERE classroom.id = $1
          AND classroom.deleted_at IS NULL
          AND term.deleted_at IS NULL
        FOR UPDATE OF classroom, term, offering, school_subject
      `,
      [classroomId, classroomSubjectId],
    )) as Array<
      CheckInClassroomRow & {
        classroom_subject_id: string;
        subject_id: number;
        subject_code: string;
      }
    >;
    return rows[0] ?? null;
  }

  async insertTargetSession(
    input: {
      context: Awaited<ReturnType<ExceptionAttendanceRepository['lockStartContext']>> & {};
      attendanceDate: string;
      actor: ExceptionAttendanceActor;
    },
    runner: QueryRunner,
  ): Promise<boolean> {
    const context = input.context;
    const rows = (await runner.query(
      `
        INSERT INTO attendance_sessions (
          school_term_id, school_id, grade_level_id, room_id, classroom_id,
          attendance_date, period, session_kind, classroom_subject_id,
          status, expected_roster_count, recorded_count,
          exception_count, record_storage_mode, checking_started_at,
          started_by_teacher_membership_id, created_by, updated_by
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, NULL, 'SUBJECT', $7,
          'OPEN', 0, 0,
          0, 'EXCEPTIONS', now(),
          $8, $9, $9
        )
        ON CONFLICT (
          school_term_id, classroom_id, classroom_subject_id, attendance_date
        ) WHERE deleted_at IS NULL AND record_storage_mode = 'EXCEPTIONS' DO NOTHING
        RETURNING id
      `,
      [
        context.school_term_id,
        context.school_id,
        context.grade_level_id,
        context.legacy_room_number,
        context.classroom_id,
        input.attendanceDate,
        context.classroom_subject_id,
        input.actor.teacherMembershipId,
        input.actor.actorUserId,
      ],
    )) as Array<{ id: string }>;
    return rows.length === 1;
  }

  async findTargetSessionForUpdate(
    input: {
      schoolTermId: string;
      classroomId: string;
      classroomSubjectId: string;
      attendanceDate: string;
    },
    runner: QueryRunner,
  ): Promise<ExceptionAttendanceSessionRow | null> {
    const rows = (await runner.query(
      `
        SELECT
          id::text, school_term_id::text, school_id, grade_level_id, room_id,
          classroom_id::text, classroom_subject_id::text,
          attendance_date::text, period, status, expected_roster_count,
          recorded_count, exception_count, revision, record_storage_mode,
          checking_started_at, submitted_at
        FROM attendance_sessions
        WHERE school_term_id = $1
          AND classroom_id = $2
          AND classroom_subject_id = $3
          AND attendance_date = $4
          AND record_storage_mode = 'EXCEPTIONS'
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [input.schoolTermId, input.classroomId, input.classroomSubjectId, input.attendanceDate],
    )) as ExceptionAttendanceSessionRow[];
    return rows[0] ?? null;
  }

  async insertRosterSnapshot(
    sessionId: string,
    classroomId: number,
    actorUserId: number | null,
    runner: QueryRunner,
  ): Promise<number> {
    await runner.query(
      `
        INSERT INTO attendance_session_roster (
          session_id, school_id, student_uuid, created_by, updated_by
        )
        SELECT session.id, session.school_id, enrollment.student_uuid, $3, $3
        FROM attendance_sessions session
        JOIN student_term enrollment
          ON enrollment.classroom_id = session.classroom_id
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = enrollment.person_uuid
         AND current_enrollment.selected_student_uuid = enrollment.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        WHERE session.id = $1
          AND session.classroom_id = $2
          AND enrollment.deleted_at IS NULL
        ON CONFLICT (session_id, student_uuid) DO NOTHING
        RETURNING student_uuid
      `,
      [sessionId, classroomId, actorUserId],
    );
    const countRows = (await runner.query(
      `SELECT COUNT(*)::int AS total FROM attendance_session_roster WHERE session_id = $1`,
      [sessionId],
    )) as Array<{ total: number }>;
    return Number(countRows[0]?.total ?? 0);
  }

  async updateExpectedRosterCount(
    sessionId: string,
    rosterCount: number,
    actorUserId: number | null,
    runner: QueryRunner,
  ): Promise<void> {
    await runner.query(
      `
        UPDATE attendance_sessions
        SET expected_roster_count = $2, updated_by = $3
        WHERE id = $1 AND status = 'OPEN'
      `,
      [sessionId, rosterCount, actorUserId],
    );
  }

  async findSessionById(sessionId: string): Promise<ExceptionAttendanceSessionRow | null> {
    const result = await queryDataSource<ExceptionAttendanceSessionRow>(
      this.dataSource,
      `
        SELECT
          id::text, school_term_id::text, school_id, grade_level_id, room_id,
          classroom_id::text, classroom_subject_id::text,
          attendance_date::text, period, status, expected_roster_count,
          recorded_count, exception_count, revision, record_storage_mode,
          checking_started_at, submitted_at
        FROM attendance_sessions
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [sessionId],
    );
    return result.rows[0] ?? null;
  }

  async findSessionForUpdate(
    sessionId: string,
    runner: QueryRunner,
  ): Promise<ExceptionAttendanceSessionRow | null> {
    const rows = (await runner.query(
      `
        SELECT
          id::text, school_term_id::text, school_id, grade_level_id, room_id,
          classroom_id::text, classroom_subject_id::text,
          attendance_date::text, period, status, expected_roster_count,
          recorded_count, exception_count, revision, record_storage_mode,
          checking_started_at, submitted_at
        FROM attendance_sessions
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE
      `,
      [sessionId],
    )) as ExceptionAttendanceSessionRow[];
    return rows[0] ?? null;
  }

  async listSessionRoster(sessionId: string, runner: QueryRunner): Promise<string[]> {
    const rows = (await runner.query(
      `
        SELECT student_uuid::text
        FROM attendance_session_roster
        WHERE session_id = $1
        ORDER BY student_uuid
      `,
      [sessionId],
    )) as Array<{ student_uuid: string }>;
    return rows.map((row) => row.student_uuid);
  }

  async listStoredExceptions(
    sessionId: string,
    runner: QueryRunner,
  ): Promise<StoredAttendanceExceptionRow[]> {
    return (await runner.query(
      `
        SELECT student_uuid::text, attendance_status_code
        FROM attendance_exceptions
        WHERE session_id = $1 AND deleted_at IS NULL
        ORDER BY student_uuid
      `,
      [sessionId],
    )) as StoredAttendanceExceptionRow[];
  }

  async replaceExceptions(
    sessionId: string,
    exceptions: PreparedAttendanceException[],
    actor: ExceptionAttendanceActor,
    runner: QueryRunner,
  ): Promise<void> {
    await runner.query(`DELETE FROM attendance_exceptions WHERE session_id = $1`, [sessionId]);
    if (exceptions.length === 0) return;
    await runner.query(
      `
        INSERT INTO attendance_exceptions (
          session_id, school_id, student_uuid, attendance_status_code, marked_at,
          marked_by_teacher_membership_id, created_by, updated_by
        )
        SELECT
          $1, session.school_id, item.student_id, item.status_code, item.marked_at,
          $3, $4, $4
        FROM attendance_sessions session
        CROSS JOIN jsonb_to_recordset($2::jsonb) AS item(
          student_id uuid,
          status_code smallint,
          marked_at timestamptz
        )
        WHERE session.id = $1
      `,
      [
        sessionId,
        JSON.stringify(
          exceptions.map((item) => ({
            student_id: item.studentId,
            status_code: item.statusCode,
            marked_at: item.markedAt,
          })),
        ),
        actor.teacherMembershipId,
        actor.actorUserId,
      ],
    );
  }

  async finalizeSession(
    session: ExceptionAttendanceSessionRow,
    exceptionCount: number,
    rosterCount: number,
    actor: ExceptionAttendanceActor,
    runner: QueryRunner,
  ): Promise<ExceptionAttendanceSessionRow> {
    const queryResult: unknown = await runner.query(
      `
        UPDATE attendance_sessions
        SET status = 'SUBMITTED',
            expected_roster_count = $2,
            recorded_count = $2,
            exception_count = $3,
            submitted_at = COALESCE(submitted_at, now()),
            submitted_by = COALESCE(submitted_by, $4),
            submitted_by_teacher_membership_id = COALESCE(
              submitted_by_teacher_membership_id,
              $5
            ),
            updated_by = $4
        WHERE id = $1
        RETURNING
          id::text, school_term_id::text, school_id, grade_level_id, room_id,
          classroom_id::text, classroom_subject_id::text,
          attendance_date::text, period, status, expected_roster_count,
          recorded_count, exception_count, revision, record_storage_mode,
          checking_started_at, submitted_at
      `,
      [session.id, rosterCount, exceptionCount, actor.actorUserId, actor.teacherMembershipId],
    );
    const rows =
      Array.isArray(queryResult) && Array.isArray(queryResult[0]) ? queryResult[0] : queryResult;
    if (!Array.isArray(rows) || !rows[0]) {
      throw new Error('Attendance session finalization returned no row');
    }
    return rows[0] as ExceptionAttendanceSessionRow;
  }
}
