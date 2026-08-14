import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildDataScopeQuery, type DataScope } from '../common/utils/authorization';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type { QueryExecutor } from './attendance.types';
import type {
  AttendanceClassMetadataRow,
  AttendanceReconciliationRow,
  AttendanceSessionAnomalyRow,
  AttendanceSessionIdentity,
  AttendanceSessionRow,
  CalendarDayRow,
  CalendarDayType,
  SchoolTermInput,
  SchoolTermRow,
} from './attendance-operations.types';

function pushParams(target: unknown[], source: unknown[]): void {
  source.forEach((value) => target.push(value));
}

const CURRENT_ENROLLMENT_JOIN = `
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
      `;

@Injectable()
export class AttendanceOperationsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async withTransaction<T>(callback: (executor: QueryExecutor) => Promise<T>): Promise<T> {
    return await withDataSourceTransaction(this.dataSource, callback);
  }

  private getExecutor(executor?: QueryExecutor): QueryExecutor {
    return (
      executor ?? {
        query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
          await queryDataSource<T>(this.dataSource, sql, params),
      }
    );
  }

  /**
   * Atomically claim past-date attendance sessions that were started but never
   * finished (recorded fewer students than the roster), flagging each once so a
   * completeness reminder is sent a single time. Returns the claimed sessions.
   */
  async claimIncompleteSessions(cutoffDate: Date): Promise<
    Array<{
      id: string;
      school_id: number;
      grade_level_id: number | null;
      room_id: number | null;
      attendance_date: string;
      expected_roster_count: number;
      recorded_count: number;
    }>
  > {
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        UPDATE attendance_sessions
        SET anomaly_notified_at = now(), updated_at = now()
        WHERE deleted_at IS NULL
          AND anomaly_notified_at IS NULL
          AND attendance_date < $1::date
          AND expected_roster_count > 0
          AND recorded_count < expected_roster_count
        RETURNING id, school_id, grade_level_id, room_id, attendance_date::text AS attendance_date,
                  expected_roster_count, recorded_count
      `,
      [cutoffDate.toISOString().slice(0, 10)],
    );
    return result.rows.map((row) => ({
      id: typeof row.id === 'string' ? row.id : '',
      school_id: Number(row.school_id),
      grade_level_id: row.grade_level_id == null ? null : Number(row.grade_level_id),
      room_id: row.room_id == null ? null : Number(row.room_id),
      attendance_date: typeof row.attendance_date === 'string' ? row.attendance_date : '',
      expected_roster_count: Number(row.expected_roster_count),
      recorded_count: Number(row.recorded_count),
    }));
  }

  async isSchoolInScope(schoolId: number, scope?: DataScope): Promise<boolean> {
    const params: unknown[] = [schoolId];
    const conditions = ['sc.id = $1'];
    if (scope) {
      if (scope.school_ids?.length) {
        params.push(scope.school_ids);
        conditions.push(`sc.id = ANY($${params.length}::int[])`);
      }
      if (scope.provinces?.length) {
        params.push(scope.provinces);
        conditions.push(`sc.province = ANY($${params.length}::text[])`);
      }
      if (scope.districts?.length) {
        params.push(scope.districts);
        conditions.push(`sc.district = ANY($${params.length}::text[])`);
      }
      if (scope.sub_districts?.length) {
        params.push(scope.sub_districts);
        conditions.push(`sc.sub_district = ANY($${params.length}::text[])`);
      }
    }
    const result = await queryDataSource<{ allowed: boolean }>(
      this.dataSource,
      `SELECT TRUE AS allowed FROM schools sc WHERE ${conditions.join(' AND ')} LIMIT 1`,
      params,
    );
    return result.rows.length > 0;
  }

  async listTerms(schoolId: number): Promise<SchoolTermRow[]> {
    const result = await queryDataSource<SchoolTermRow>(
      this.dataSource,
      `
        SELECT
          st.id::text,
          st.school_id,
          sc.name AS school_name,
          st.academic_year,
          st.semester,
          st.starts_on::text,
          st.ends_on::text,
          st.status,
          COUNT(cd.id)::int AS calendar_day_count,
          COUNT(cd.id) FILTER (WHERE cd.day_type = 'SCHOOL_DAY')::int AS school_day_count
        FROM school_terms st
        JOIN schools sc ON sc.id = st.school_id
        LEFT JOIN school_calendar_days cd
          ON cd.school_term_id = st.id AND cd.deleted_at IS NULL
        WHERE st.school_id = $1 AND st.deleted_at IS NULL
        GROUP BY st.id, sc.name
        ORDER BY st.academic_year DESC, st.semester DESC
      `,
      [schoolId],
    );
    return result.rows;
  }

  async findTermById(termId: number, executor?: QueryExecutor): Promise<SchoolTermRow | null> {
    const result = await this.getExecutor(executor).query<SchoolTermRow>(
      `
        SELECT
          st.id::text,
          st.school_id,
          sc.name AS school_name,
          st.academic_year,
          st.semester,
          st.starts_on::text,
          st.ends_on::text,
          st.status,
          (SELECT COUNT(*)::int FROM school_calendar_days cd
            WHERE cd.school_term_id = st.id AND cd.deleted_at IS NULL) AS calendar_day_count,
          (SELECT COUNT(*)::int FROM school_calendar_days cd
            WHERE cd.school_term_id = st.id AND cd.day_type = 'SCHOOL_DAY'
              AND cd.deleted_at IS NULL) AS school_day_count
        FROM school_terms st
        JOIN schools sc ON sc.id = st.school_id
        WHERE st.id = $1 AND st.deleted_at IS NULL
      `,
      [termId],
    );
    return result.rows[0] ?? null;
  }

  async upsertTerm(input: SchoolTermInput, executor: QueryExecutor): Promise<SchoolTermRow> {
    await executor.query(
      `
        INSERT INTO school_terms (
          school_id, academic_year, semester, starts_on, ends_on, status,
          created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        ON CONFLICT (school_id, academic_year, semester) DO UPDATE SET
          starts_on = EXCLUDED.starts_on,
          ends_on = EXCLUDED.ends_on,
          status = EXCLUDED.status,
          updated_by = EXCLUDED.updated_by,
          deleted_at = NULL,
          deleted_by = NULL
      `,
      [
        input.schoolId,
        input.academicYear,
        input.semester,
        input.startsOn,
        input.endsOn,
        input.status,
        input.actorUserId,
      ],
    );
    const result = await executor.query<SchoolTermRow>(
      `
        SELECT
          st.id::text,
          st.school_id,
          sc.name AS school_name,
          st.academic_year,
          st.semester,
          st.starts_on::text,
          st.ends_on::text,
          st.status,
          (SELECT COUNT(*)::int FROM school_calendar_days cd
            WHERE cd.school_term_id = st.id AND cd.deleted_at IS NULL) AS calendar_day_count,
          (SELECT COUNT(*)::int FROM school_calendar_days cd
            WHERE cd.school_term_id = st.id AND cd.day_type = 'SCHOOL_DAY'
              AND cd.deleted_at IS NULL) AS school_day_count
        FROM school_terms st
        JOIN schools sc ON sc.id = st.school_id
        WHERE st.school_id = $1 AND st.academic_year = $2 AND st.semester = $3
      `,
      [input.schoolId, input.academicYear, input.semester],
    );
    return result.rows[0];
  }

  async getCalendarCoverage(
    termId: string,
    startsOn: string,
    endsOn: string,
    executor: QueryExecutor,
  ): Promise<{ calendarDayCount: number; schoolDayCount: number }> {
    const result = await executor.query<{
      calendar_day_count: number | string;
      school_day_count: number | string;
    }>(
      `
        SELECT
          COUNT(*)::int AS calendar_day_count,
          COUNT(*) FILTER (WHERE day_type = 'SCHOOL_DAY')::int AS school_day_count
        FROM school_calendar_days
        WHERE school_term_id = $1
          AND calendar_date BETWEEN $2 AND $3
          AND deleted_at IS NULL
      `,
      [termId, startsOn, endsOn],
    );
    return {
      calendarDayCount: Number(result.rows[0]?.calendar_day_count ?? 0),
      schoolDayCount: Number(result.rows[0]?.school_day_count ?? 0),
    };
  }

  async generateCalendar(
    termId: number,
    schoolDays: number[],
    actorUserId: number | null,
    executor: QueryExecutor,
  ): Promise<void> {
    await executor.query(
      `
        UPDATE school_calendar_days cd
        SET deleted_at = now(), deleted_by = $2, updated_by = $2
        FROM school_terms st
        WHERE st.id = $1
          AND cd.school_term_id = st.id
          AND cd.source = 'GENERATED'
          AND cd.deleted_at IS NULL
          AND (cd.calendar_date < st.starts_on OR cd.calendar_date > st.ends_on)
      `,
      [termId, actorUserId],
    );
    await executor.query(
      `
        INSERT INTO school_calendar_days (
          school_term_id, calendar_date, day_type, reason, source, created_by, updated_by
        )
        SELECT
          st.id,
          day::date,
          CASE WHEN EXTRACT(ISODOW FROM day)::int = ANY($2::int[])
            THEN 'SCHOOL_DAY' ELSE 'HOLIDAY' END,
          NULL,
          'GENERATED',
          $3,
          $3
        FROM school_terms st
        CROSS JOIN LATERAL generate_series(st.starts_on, st.ends_on, INTERVAL '1 day') day
        WHERE st.id = $1 AND st.starts_on IS NOT NULL AND st.ends_on IS NOT NULL
        ON CONFLICT (school_term_id, calendar_date) DO UPDATE SET
          day_type = CASE
            WHEN school_calendar_days.source IN ('MANUAL', 'IMPORT', 'BACKFILL')
              THEN school_calendar_days.day_type
            ELSE EXCLUDED.day_type
          END,
          source = CASE
            WHEN school_calendar_days.source IN ('MANUAL', 'IMPORT', 'BACKFILL')
              THEN school_calendar_days.source
            ELSE EXCLUDED.source
          END,
          updated_by = EXCLUDED.updated_by,
          deleted_at = NULL,
          deleted_by = NULL
      `,
      [termId, schoolDays, actorUserId],
    );
  }

  async listCalendar(termId: number): Promise<CalendarDayRow[]> {
    const result = await queryDataSource<CalendarDayRow>(
      this.dataSource,
      `
        SELECT id::text, school_term_id::text, calendar_date::text, day_type, reason, source
        FROM school_calendar_days
        WHERE school_term_id = $1 AND deleted_at IS NULL
        ORDER BY calendar_date
      `,
      [termId],
    );
    return result.rows;
  }

  async updateCalendarDay(
    calendarDayId: number,
    dayType: CalendarDayType,
    reason: string | null,
    actorUserId: number | null,
    executor: QueryExecutor,
  ): Promise<CalendarDayRow | null> {
    const result = await executor.query<CalendarDayRow>(
      `
        UPDATE school_calendar_days
        SET day_type = $2,
            reason = $3,
            source = 'MANUAL',
            updated_by = $4,
            deleted_at = NULL,
            deleted_by = NULL
        WHERE id = $1
        RETURNING id::text, school_term_id::text, calendar_date::text,
          day_type, reason, source
      `,
      [calendarDayId, dayType, reason, actorUserId],
    );
    return result.rows[0] ?? null;
  }

  async findCalendarDayById(calendarDayId: number): Promise<CalendarDayRow | null> {
    const result = await queryDataSource<CalendarDayRow>(
      this.dataSource,
      `
        SELECT id::text, school_term_id::text, calendar_date::text, day_type, reason, source
        FROM school_calendar_days
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [calendarDayId],
    );
    return result.rows[0] ?? null;
  }

  async findClassMetadata(
    studentIds: string[],
    executor?: QueryExecutor,
  ): Promise<AttendanceClassMetadataRow[]> {
    if (studentIds.length === 0) return [];
    const result = await this.getExecutor(executor).query<AttendanceClassMetadataRow>(
      `
        SELECT
          s.student_uuid,
          s."SchoolID_Onec" AS school_id,
          s."GradeLevelID_Onec" AS grade_level_id,
          gl.label AS grade_label,
          s."RoomID_Onec" AS room_id,
          s."AcademicYear_Onec" AS academic_year,
          s."Semester_Onec" AS semester
        FROM student_term s
        ${CURRENT_ENROLLMENT_JOIN}
        JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        WHERE s.student_uuid = ANY($1::uuid[]) AND s.deleted_at IS NULL
      `,
      [studentIds],
    );
    return result.rows;
  }

  async listRosterIds(
    metadata: Omit<AttendanceClassMetadataRow, 'student_uuid' | 'grade_label'>,
    executor?: QueryExecutor,
  ): Promise<string[]> {
    const result = await this.getExecutor(executor).query<{ student_uuid: string }>(
      `
        SELECT s.student_uuid
        FROM student_term s
        ${CURRENT_ENROLLMENT_JOIN}
        WHERE s."SchoolID_Onec" = $1
          AND s."GradeLevelID_Onec" = $2
          AND s."RoomID_Onec" = $3
          AND s."AcademicYear_Onec" = $4
          AND s."Semester_Onec" = $5
          AND s.deleted_at IS NULL
        ORDER BY student_uuid
      `,
      [
        metadata.school_id,
        metadata.grade_level_id,
        metadata.room_id,
        metadata.academic_year,
        metadata.semester,
      ],
    );
    return result.rows.map((row) => row.student_uuid);
  }

  async findOrCreateTermForClass(
    metadata: AttendanceClassMetadataRow,
    actorUserId: number | null,
    executor: QueryExecutor,
  ): Promise<SchoolTermRow> {
    await executor.query(
      `
        INSERT INTO school_terms (
          school_id, academic_year, semester, status, created_by, updated_by
        )
        VALUES ($1, $2, $3, 'DRAFT', $4, $4)
        ON CONFLICT (school_id, academic_year, semester) DO NOTHING
      `,
      [metadata.school_id, metadata.academic_year, metadata.semester, actorUserId],
    );
    const result = await executor.query<SchoolTermRow>(
      `
        SELECT
          st.id::text,
          st.school_id,
          sc.name AS school_name,
          st.academic_year,
          st.semester,
          st.starts_on::text,
          st.ends_on::text,
          st.status,
          (SELECT COUNT(*)::int FROM school_calendar_days cd
            WHERE cd.school_term_id = st.id AND cd.deleted_at IS NULL) AS calendar_day_count,
          (SELECT COUNT(*)::int FROM school_calendar_days cd
            WHERE cd.school_term_id = st.id AND cd.day_type = 'SCHOOL_DAY'
              AND cd.deleted_at IS NULL) AS school_day_count
        FROM school_terms st
        JOIN schools sc ON sc.id = st.school_id
        WHERE st.school_id = $1 AND st.academic_year = $2 AND st.semester = $3
        FOR UPDATE OF st
      `,
      [metadata.school_id, metadata.academic_year, metadata.semester],
    );
    return result.rows[0];
  }

  /**
   * Term lookup without the `FOR UPDATE` that find-or-create takes. Draft saves
   * run many times per class, and serialising all of them on one `school_terms`
   * row would turn the 08:00 rush into a queue; callers fall back to the
   * locking path when the term does not exist yet.
   */
  async findTermForClass(
    metadata: { school_id: number; academic_year: number; semester: number },
    executor?: QueryExecutor,
  ): Promise<SchoolTermRow | null> {
    const result = await this.getExecutor(executor).query<SchoolTermRow>(
      `
        SELECT
          st.id::text,
          st.school_id,
          sc.name AS school_name,
          st.academic_year,
          st.semester,
          st.starts_on::text,
          st.ends_on::text,
          st.status,
          0 AS calendar_day_count,
          0 AS school_day_count
        FROM school_terms st
        JOIN schools sc ON sc.id = st.school_id
        WHERE st.school_id = $1 AND st.academic_year = $2 AND st.semester = $3
      `,
      [metadata.school_id, metadata.academic_year, metadata.semester],
    );
    return result.rows[0] ?? null;
  }

  async findCalendarDay(
    termId: string,
    date: string,
    executor?: QueryExecutor,
  ): Promise<CalendarDayRow | null> {
    const result = await this.getExecutor(executor).query<CalendarDayRow>(
      `
        SELECT id::text, school_term_id::text, calendar_date::text, day_type, reason, source
        FROM school_calendar_days
        WHERE school_term_id = $1 AND calendar_date = $2 AND deleted_at IS NULL
      `,
      [termId, date],
    );
    return result.rows[0] ?? null;
  }

  async findOrCreateSessionForUpdate(
    identity: AttendanceSessionIdentity,
    expectedRosterCount: number,
    actorUserId: number | null,
    executor: QueryExecutor,
  ): Promise<AttendanceSessionRow> {
    const sessionKind = identity.sessionKind ?? 'DAILY';
    await executor.query(
      `
        INSERT INTO attendance_sessions (
          school_term_id, school_id, grade_level_id, room_id, attendance_date,
          period, session_kind, subject_id, timetable_slot_id, status, expected_roster_count, recorded_count,
          created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OPEN', $10, 0, $11, $11)
        ON CONFLICT (
          school_term_id, grade_level_id, room_id, attendance_date, period, session_kind
        ) DO NOTHING
      `,
      [
        identity.schoolTermId,
        identity.schoolId,
        identity.gradeLevelId,
        identity.roomId,
        identity.attendanceDate,
        identity.period,
        sessionKind,
        identity.subjectId ?? null,
        identity.timetableSlotId ?? null,
        expectedRosterCount,
        actorUserId,
      ],
    );
    const result = await executor.query<AttendanceSessionRow>(
      `
        SELECT
          id,
          school_term_id::text,
          school_id,
          grade_level_id,
          room_id,
          attendance_date::text,
          period,
          session_kind,
          status,
          expected_roster_count,
          recorded_count,
          revision,
          submitted_at,
          correction_reason
        FROM attendance_sessions
        WHERE school_term_id = $1
          AND grade_level_id = $2
          AND room_id = $3
          AND attendance_date = $4
          AND period = $5
          AND session_kind = $6
        FOR UPDATE
      `,
      [
        identity.schoolTermId,
        identity.gradeLevelId,
        identity.roomId,
        identity.attendanceDate,
        identity.period,
        sessionKind,
      ],
    );
    return result.rows[0];
  }

  async findSessionContext(
    schoolId: number,
    gradeLabel: string,
    roomId: number,
    date: string,
    timetableSlotId?: number,
  ): Promise<{
    metadata: AttendanceClassMetadataRow | null;
    term: SchoolTermRow | null;
    calendarDay: CalendarDayRow | null;
    session: AttendanceSessionRow | null;
    expectedRosterCount: number;
  }> {
    const metadataResult = await queryDataSource<AttendanceClassMetadataRow>(
      this.dataSource,
      `
        SELECT
          MIN(s.student_uuid::text)::uuid AS student_uuid,
          s."SchoolID_Onec" AS school_id,
          s."GradeLevelID_Onec" AS grade_level_id,
          gl.label AS grade_label,
          s."RoomID_Onec" AS room_id,
          s."AcademicYear_Onec" AS academic_year,
          s."Semester_Onec" AS semester
        FROM student_term s
        ${CURRENT_ENROLLMENT_JOIN}
        JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        WHERE s."SchoolID_Onec" = $1
          AND gl.label = $2
          AND s."RoomID_Onec" = $3
          AND s.deleted_at IS NULL
        GROUP BY s."SchoolID_Onec", s."GradeLevelID_Onec", gl.label,
          s."RoomID_Onec", s."AcademicYear_Onec", s."Semester_Onec"
        ORDER BY s."AcademicYear_Onec" DESC, s."Semester_Onec" DESC
        LIMIT 1
      `,
      [schoolId, gradeLabel, roomId],
    );
    const metadata = metadataResult.rows[0] ?? null;
    if (!metadata) {
      return {
        metadata: null,
        term: null,
        calendarDay: null,
        session: null,
        expectedRosterCount: 0,
      };
    }
    const terms = await queryDataSource<SchoolTermRow>(
      this.dataSource,
      `
        SELECT
          st.id::text,
          st.school_id,
          sc.name AS school_name,
          st.academic_year,
          st.semester,
          st.starts_on::text,
          st.ends_on::text,
          st.status,
          (SELECT COUNT(*)::int FROM school_calendar_days cd
            WHERE cd.school_term_id = st.id AND cd.deleted_at IS NULL) AS calendar_day_count,
          (SELECT COUNT(*)::int FROM school_calendar_days cd
            WHERE cd.school_term_id = st.id AND cd.day_type = 'SCHOOL_DAY'
              AND cd.deleted_at IS NULL) AS school_day_count
        FROM school_terms st
        JOIN schools sc ON sc.id = st.school_id
        WHERE st.school_id = $1 AND st.academic_year = $2 AND st.semester = $3
          AND st.deleted_at IS NULL
      `,
      [schoolId, metadata.academic_year, metadata.semester],
    );
    const term = terms.rows[0] ?? null;
    if (!term) {
      return { metadata, term: null, calendarDay: null, session: null, expectedRosterCount: 0 };
    }
    const sessionCondition = timetableSlotId
      ? `AND attendance_date = $4 AND session_kind = 'SUBJECT' AND timetable_slot_id = $5`
      : `AND attendance_date = $4 AND period = 1 AND session_kind = 'DAILY'`;
    const sessionParams = timetableSlotId
      ? [term.id, metadata.grade_level_id, roomId, date, timetableSlotId]
      : [term.id, metadata.grade_level_id, roomId, date];
    const [calendarDay, rosterIds, sessionResult] = await Promise.all([
      this.findCalendarDay(term.id, date),
      this.listRosterIds(metadata),
      queryDataSource<AttendanceSessionRow>(
        this.dataSource,
        `
          SELECT id, school_term_id::text, school_id, grade_level_id, room_id,
            attendance_date::text, period, session_kind, status,
            expected_roster_count, recorded_count, revision, submitted_at,
            correction_reason
          FROM attendance_sessions
          WHERE school_term_id = $1 AND grade_level_id = $2 AND room_id = $3
            ${sessionCondition}
        `,
        sessionParams,
      ),
    ]);
    return {
      metadata,
      term,
      calendarDay,
      session: sessionResult.rows[0] ?? null,
      expectedRosterCount: rosterIds.length,
    };
  }

  /**
   * `recorded_count` is derived from the rows that actually exist for the
   * session rather than the payload length, so incremental draft saves and the
   * final submit can never disagree with the table.
   */
  async updateSessionSubmitted(
    sessionId: string,
    actorUserId: number | null,
    executor: QueryExecutor,
  ): Promise<void> {
    await executor.query(
      `
        UPDATE attendance_sessions session
        SET status = 'SUBMITTED',
            recorded_count = (
              SELECT COUNT(*) FROM attendance record WHERE record.session_id = session.id
            ),
            submitted_at = now(),
            submitted_by = $2,
            updated_by = $2
        WHERE session.id = $1
      `,
      [sessionId, actorUserId],
    );
  }

  /**
   * Draft autosave progress: refresh how many students are marked so the
   * reconciliation dashboard shows live progress, without touching `status`,
   * `submitted_at` or `submitted_by` — a draft is not a submission.
   */
  async updateSessionDraftProgress(
    sessionId: string,
    actorUserId: number | null,
    executor: QueryExecutor,
  ): Promise<number> {
    const result = await executor.query<{ recorded_count: number | string }>(
      `
        UPDATE attendance_sessions session
        SET recorded_count = (
              SELECT COUNT(*) FROM attendance record WHERE record.session_id = session.id
            ),
            updated_by = $2,
            updated_at = now()
        WHERE session.id = $1
        RETURNING recorded_count
      `,
      [sessionId, actorUserId],
    );
    return Number(result.rows[0]?.recorded_count ?? 0);
  }

  async recordSessionAudit(
    input: {
      action: 'ATTENDANCE_SUBMIT' | 'ATTENDANCE_REOPEN';
      sessionId: string;
      actorUserId: number | null;
      actorLabel: string;
      metadata: Record<string, unknown>;
    },
    executor: QueryExecutor,
  ): Promise<void> {
    await executor.query(
      `
        INSERT INTO audit_log (
          actor_user_id, actor_label, action, target_type, target_id, metadata
        )
        VALUES ($1, $2, $3, 'attendance_session', $4, $5::jsonb)
      `,
      [
        input.actorUserId,
        input.actorLabel,
        input.action,
        input.sessionId,
        JSON.stringify(input.metadata),
      ],
    );
  }

  async listSessionAttendanceStatuses(
    sessionId: string,
    executor: QueryExecutor,
  ): Promise<Array<{ student_uuid: string; attendance_status: number }>> {
    const result = await executor.query<{
      student_uuid: string;
      attendance_status: number;
    }>(
      `
        SELECT student_uuid::text, "AttendanceStatus"::int AS attendance_status
        FROM attendance
        WHERE session_id = $1
        ORDER BY student_uuid
      `,
      [sessionId],
    );
    return result.rows.map((row) => ({
      student_uuid: row.student_uuid,
      attendance_status: Number(row.attendance_status),
    }));
  }

  async findReopenBaseline(
    sessionId: string,
    revision: number,
    executor: QueryExecutor,
  ): Promise<Array<{ student_uuid: string; attendance_status: number }> | null> {
    const result = await executor.query<{ baseline_statuses: unknown }>(
      `
        SELECT metadata->'baselineStatuses' AS baseline_statuses
        FROM audit_log
        WHERE action = 'ATTENDANCE_REOPEN'
          AND target_type = 'attendance_session'
          AND target_id = $1
          AND metadata->>'revision' = $2::text
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [sessionId, revision],
    );
    const raw = result.rows[0]?.baseline_statuses;
    const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
    if (!Array.isArray(parsed)) return null;
    return parsed.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      if (typeof row.studentUuid !== 'string' || !Number.isFinite(Number(row.statusCode))) {
        return [];
      }
      return [{ student_uuid: row.studentUuid, attendance_status: Number(row.statusCode) }];
    });
  }

  async reopenSession(
    sessionId: string,
    reason: string,
    actorUserId: number | null,
    executor: QueryExecutor,
  ): Promise<AttendanceSessionRow | null> {
    const result = await executor.query<AttendanceSessionRow>(
      `
        UPDATE attendance_sessions
        SET status = 'REOPENED',
            revision = revision + 1,
            reopened_at = now(),
            reopened_by = $3,
            correction_reason = $2,
            updated_by = $3
        WHERE id = $1 AND status = 'SUBMITTED'
        RETURNING id, school_term_id::text, school_id, grade_level_id, room_id,
          attendance_date::text, period, session_kind, status,
          expected_roster_count, recorded_count, revision, submitted_at,
          correction_reason
      `,
      [sessionId, reason, actorUserId],
    );
    return result.rows[0] ?? null;
  }

  async findSessionById(sessionId: string): Promise<AttendanceSessionRow | null> {
    const result = await queryDataSource<AttendanceSessionRow>(
      this.dataSource,
      `
        SELECT id, school_term_id::text, school_id, grade_level_id, room_id,
          attendance_date::text, period, session_kind, status,
          expected_roster_count, recorded_count, revision, submitted_at,
          correction_reason
        FROM attendance_sessions
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [sessionId],
    );
    return result.rows[0] ?? null;
  }

  async listReconciliation(
    term: SchoolTermRow,
    date: string,
    scope: DataScope | undefined,
    page: number,
    limit: number,
    gradeLevelId?: number,
    room?: number,
  ): Promise<{
    rows: AttendanceReconciliationRow[];
    totalCount: number;
    summary: { completed: number; missing: number; incomplete: number };
  }> {
    const params: unknown[] = [term.school_id, term.academic_year, term.semester];
    const conditions = [
      `s."SchoolID_Onec" = $1`,
      `s."AcademicYear_Onec" = $2`,
      `s."Semester_Onec" = $3`,
      's.deleted_at IS NULL',
    ];
    if (scope) {
      const scoped = buildDataScopeQuery(
        scope,
        {
          school_id: `s."SchoolID_Onec"`,
          grade: `s."GradeLevelID_Onec"`,
          room: `s."RoomID_Onec"::text`,
          province: 'sc.province',
          district: 'sc.district',
          sub_district: 'sc.sub_district',
        },
        params.length + 1,
      );
      if (scoped.sql) {
        conditions.push(`(${scoped.sql})`);
        pushParams(params, scoped.params);
      }
    }
    if (gradeLevelId) {
      params.push(gradeLevelId);
      conditions.push(`s."GradeLevelID_Onec" = $${params.length}`);
    }
    if (room) {
      params.push(room);
      conditions.push(`s."RoomID_Onec"::int = $${params.length}`);
    }
    const rosterSql = `
      SELECT s."GradeLevelID_Onec" AS grade_level_id,
        gl.label AS grade_label,
        s."RoomID_Onec" AS room_id,
        COUNT(*)::int AS expected_roster_count
      FROM student_term s
      ${CURRENT_ENROLLMENT_JOIN}
      JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
      JOIN schools sc ON sc.id = s."SchoolID_Onec"
      WHERE ${conditions.join(' AND ')}
      GROUP BY s."GradeLevelID_Onec", gl.label, s."RoomID_Onec"
    `;
    const termPlaceholder = params.length + 1;
    const datePlaceholder = params.length + 2;
    const summaryResult = await queryDataSource<{
      count: string;
      completed: number | string;
      missing: number | string;
      incomplete: number | string;
    }>(
      this.dataSource,
      `
        WITH roster AS (${rosterSql}), states AS (
          SELECT CASE
            WHEN sess.id IS NULL THEN 'MISSING'
            WHEN sess.status = 'SUBMITTED'
              AND sess.recorded_count = roster.expected_roster_count THEN 'COMPLETED'
            ELSE 'INCOMPLETE'
          END AS operational_status
          FROM roster
          LEFT JOIN attendance_sessions sess
            ON sess.school_term_id = $${termPlaceholder}
           AND sess.grade_level_id = roster.grade_level_id
           AND sess.room_id = roster.room_id
           AND sess.attendance_date = $${datePlaceholder}
           AND sess.period = 1
           AND sess.session_kind = 'DAILY'
           AND sess.deleted_at IS NULL
        )
        SELECT
          COUNT(*)::text AS count,
          COUNT(*) FILTER (WHERE operational_status = 'COMPLETED')::int AS completed,
          COUNT(*) FILTER (WHERE operational_status = 'MISSING')::int AS missing,
          COUNT(*) FILTER (WHERE operational_status = 'INCOMPLETE')::int AS incomplete
        FROM states
      `,
      [...params, term.id, date],
    );
    const offset = (page - 1) * limit;
    const limitPlaceholder = params.length + 3;
    const offsetPlaceholder = params.length + 4;
    const result = await queryDataSource<AttendanceReconciliationRow>(
      this.dataSource,
      `
        WITH roster AS (${rosterSql})
        SELECT
          roster.grade_level_id,
          roster.grade_label,
          roster.room_id,
          roster.expected_roster_count,
          COALESCE(sess.recorded_count, 0)::int AS recorded_count,
          sess.id AS session_id,
          sess.status AS session_status,
          sess.revision,
          CASE
            WHEN sess.id IS NULL THEN 'MISSING'
            WHEN sess.status = 'SUBMITTED'
              AND sess.recorded_count = roster.expected_roster_count THEN 'COMPLETED'
            ELSE 'INCOMPLETE'
          END AS operational_status
        FROM roster
        LEFT JOIN attendance_sessions sess
          ON sess.school_term_id = $${termPlaceholder}
         AND sess.grade_level_id = roster.grade_level_id
         AND sess.room_id = roster.room_id
         AND sess.attendance_date = $${datePlaceholder}
         AND sess.period = 1
         AND sess.session_kind = 'DAILY'
         AND sess.deleted_at IS NULL
        ORDER BY roster.grade_level_id, roster.room_id
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      [...params, term.id, date, limit, offset],
    );
    return {
      rows: result.rows,
      totalCount: Number.parseInt(summaryResult.rows[0]?.count ?? '0', 10),
      summary: {
        completed: Number(summaryResult.rows[0]?.completed ?? 0),
        missing: Number(summaryResult.rows[0]?.missing ?? 0),
        incomplete: Number(summaryResult.rows[0]?.incomplete ?? 0),
      },
    };
  }

  async listSessionAnomalies(
    term: SchoolTermRow,
    scope: DataScope | undefined,
    page: number,
    limit: number,
    gradeLevelId?: number,
    room?: number,
  ): Promise<{
    rows: AttendanceSessionAnomalyRow[];
    totalCount: number;
    summary: {
      holidayAttendance: number;
      cancelledAttendance: number;
      outOfTerm: number;
      missingCalendarDay: number;
    };
  }> {
    const params: unknown[] = [term.id, term.school_id];
    const conditions = [
      'sess.school_term_id = $1',
      'sess.school_id = $2',
      "sess.session_kind = 'DAILY'",
      'sess.deleted_at IS NULL',
    ];
    if (scope) {
      const scoped = buildDataScopeQuery(
        scope,
        {
          school_id: 'sess.school_id',
          grade: 'sess.grade_level_id',
          room: 'sess.room_id::text',
          province: 'sc.province',
          district: 'sc.district',
          sub_district: 'sc.sub_district',
        },
        params.length + 1,
      );
      if (scoped.sql) {
        conditions.push(`(${scoped.sql})`);
        pushParams(params, scoped.params);
      }
    }
    if (gradeLevelId) {
      params.push(gradeLevelId);
      conditions.push(`sess.grade_level_id = $${params.length}`);
    }
    if (room) {
      params.push(room);
      conditions.push(`sess.room_id = $${params.length}`);
    }
    const baseSql = `
      SELECT
        sess.id AS session_id,
        sess.attendance_date::text,
        sess.grade_level_id,
        gl.label AS grade_label,
        sess.room_id,
        sess.expected_roster_count,
        sess.recorded_count,
        sess.status AS session_status,
        sess.revision,
        day.day_type,
        day.reason AS calendar_reason,
        CASE
          WHEN st.starts_on IS NOT NULL AND st.ends_on IS NOT NULL
            AND (sess.attendance_date < st.starts_on OR sess.attendance_date > st.ends_on)
            THEN 'OUT_OF_TERM'
          WHEN day.id IS NULL THEN 'MISSING_CALENDAR_DAY'
          WHEN day.day_type = 'HOLIDAY' THEN 'HOLIDAY_ATTENDANCE'
          WHEN day.day_type = 'CANCELLED' THEN 'CANCELLED_ATTENDANCE'
        END AS anomaly_type
      FROM attendance_sessions sess
      JOIN school_terms st ON st.id = sess.school_term_id AND st.deleted_at IS NULL
      JOIN schools sc ON sc.id = sess.school_id
      LEFT JOIN grade_levels gl ON gl.id = sess.grade_level_id
      LEFT JOIN school_calendar_days day
        ON day.school_term_id = sess.school_term_id
       AND day.calendar_date = sess.attendance_date
       AND day.deleted_at IS NULL
      WHERE ${conditions.join(' AND ')}
        AND (
          (st.starts_on IS NOT NULL AND st.ends_on IS NOT NULL
            AND (sess.attendance_date < st.starts_on OR sess.attendance_date > st.ends_on))
          OR day.id IS NULL
          OR day.day_type IN ('HOLIDAY', 'CANCELLED')
        )
    `;
    const summaryResult = await queryDataSource<{
      count: string;
      holiday_attendance: number | string;
      cancelled_attendance: number | string;
      out_of_term: number | string;
      missing_calendar_day: number | string;
    }>(
      this.dataSource,
      `
        WITH anomalies AS (${baseSql})
        SELECT
          COUNT(*)::text AS count,
          COUNT(*) FILTER (WHERE anomaly_type = 'HOLIDAY_ATTENDANCE')::int AS holiday_attendance,
          COUNT(*) FILTER (WHERE anomaly_type = 'CANCELLED_ATTENDANCE')::int AS cancelled_attendance,
          COUNT(*) FILTER (WHERE anomaly_type = 'OUT_OF_TERM')::int AS out_of_term,
          COUNT(*) FILTER (WHERE anomaly_type = 'MISSING_CALENDAR_DAY')::int AS missing_calendar_day
        FROM anomalies
      `,
      params,
    );
    const offset = (page - 1) * limit;
    const limitPlaceholder = params.length + 1;
    const offsetPlaceholder = params.length + 2;
    const result = await queryDataSource<AttendanceSessionAnomalyRow>(
      this.dataSource,
      `
        WITH anomalies AS (${baseSql})
        SELECT *
        FROM anomalies
        ORDER BY attendance_date DESC, grade_level_id, room_id
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      [...params, limit, offset],
    );
    return {
      rows: result.rows,
      totalCount: Number.parseInt(summaryResult.rows[0]?.count ?? '0', 10),
      summary: {
        holidayAttendance: Number(summaryResult.rows[0]?.holiday_attendance ?? 0),
        cancelledAttendance: Number(summaryResult.rows[0]?.cancelled_attendance ?? 0),
        outOfTerm: Number(summaryResult.rows[0]?.out_of_term ?? 0),
        missingCalendarDay: Number(summaryResult.rows[0]?.missing_calendar_day ?? 0),
      },
    };
  }
}
