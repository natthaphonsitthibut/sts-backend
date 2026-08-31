import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DataScope } from '../common/utils/authorization';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type { QueryExecutor } from './attendance.types';
import type {
  AttendanceClassMetadataRow,
  AttendanceSessionRow,
  SchoolTermInput,
  SchoolTermRow,
} from './attendance-operations.types';

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

  /**
   * The school/grade/room a classroom sits in, so an endpoint that only receives
   * a `classroomId` can still be scope-checked against the actor.
   */
  async findClassroomScope(classroomId: number): Promise<{
    school_id: number;
    school_term_id: number;
    grade_level_id: number;
    legacy_room_number: number;
  } | null> {
    const result = await queryDataSource<{
      school_id: number;
      school_term_id: number;
      grade_level_id: number;
      legacy_room_number: number;
    }>(
      this.dataSource,
      `
        SELECT school_id, school_term_id, grade_level_id, legacy_room_number
        FROM school_classrooms
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [classroomId],
    );
    return result.rows[0] ?? null;
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
          st.status
        FROM school_terms st
        JOIN schools sc ON sc.id = st.school_id
        WHERE st.school_id = $1 AND st.deleted_at IS NULL
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
          st.status
        FROM school_terms st
        JOIN schools sc ON sc.id = st.school_id
        WHERE st.id = $1 AND st.deleted_at IS NULL
      `,
      [termId],
    );
    return result.rows[0] ?? null;
  }

  async findTermByIdForUpdate(
    termId: number,
    executor: QueryExecutor,
  ): Promise<SchoolTermRow | null> {
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
          st.status
        FROM school_terms st
        JOIN schools sc ON sc.id = st.school_id
        WHERE st.id = $1 AND st.deleted_at IS NULL
        FOR UPDATE OF st
      `,
      [termId],
    );
    return result.rows[0] ?? null;
  }

  async deleteTerm(termId: number, executor: QueryExecutor): Promise<string | null> {
    const result = await executor.query<{ id: string }>(
      `DELETE FROM school_terms WHERE id = $1 RETURNING id::text`,
      [termId],
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Editing must follow the row, not its natural key: the dialog can change the
   * academic year or semester, and an upsert on (school, year, semester) would
   * write a second row and orphan the one the user opened.
   */
  async updateTerm(
    termId: number,
    input: SchoolTermInput,
    executor: QueryExecutor,
  ): Promise<SchoolTermRow | null> {
    const updated = await executor.query<{ id: string }>(
      `
        UPDATE school_terms
        SET academic_year = $2,
            semester = $3,
            starts_on = $4,
            ends_on = $5,
            status = $6,
            updated_by = $7
        WHERE id = $1 AND school_id = $8 AND deleted_at IS NULL
        RETURNING id::text
      `,
      [
        termId,
        input.academicYear,
        input.semester,
        input.startsOn,
        input.endsOn,
        input.status,
        input.actorUserId,
        input.schoolId,
      ],
    );
    if (!updated.rows[0]) return null;
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
          st.status
        FROM school_terms st
        JOIN schools sc ON sc.id = st.school_id
        WHERE st.id = $1
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
          st.status
        FROM school_terms st
        JOIN schools sc ON sc.id = st.school_id
        WHERE st.school_id = $1 AND st.academic_year = $2 AND st.semester = $3
      `,
      [input.schoolId, input.academicYear, input.semester],
    );
    return result.rows[0];
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
          s.classroom_id,
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
          st.status
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
          st.status
        FROM school_terms st
        JOIN schools sc ON sc.id = st.school_id
        WHERE st.school_id = $1 AND st.academic_year = $2 AND st.semester = $3
      `,
      [metadata.school_id, metadata.academic_year, metadata.semester],
    );
    return result.rows[0] ?? null;
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
              SELECT COUNT(*) FROM attendance_session_roster roster
              WHERE roster.session_id = session.id
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
              SELECT COUNT(*) FROM attendance_session_roster roster
              WHERE roster.session_id = session.id
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
        FROM attendance_effective_records
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

  async findSessionById(sessionId: string): Promise<AttendanceSessionRow | null> {
    const result = await queryDataSource<AttendanceSessionRow>(
      this.dataSource,
      `
        SELECT id, school_term_id::text, school_id, grade_level_id, room_id,
          attendance_date::text, period, session_kind, status,
          expected_roster_count, recorded_count, submission_number, lock_version, submitted_at,
          correction_reason
        FROM attendance_sessions
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [sessionId],
    );
    return result.rows[0] ?? null;
  }
}
