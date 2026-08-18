import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { isUnconfiguredDataScope } from '../auth/auth.types';
import { appConfig } from '../config/app.config';
import { buildDataScopeQuery, type DataScope } from '../common/utils/authorization';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type {
  AttendanceHistoryRow,
  AttendanceInsertRecord,
  AttendanceStudentRow,
  GradeLevelRow,
  LocationDistrictRow,
  LocationProvinceRow,
  LocationSubDistrictRow,
  QueryExecutor,
  QueryResultLike,
  RoomRow,
  SchoolFilters,
  SchoolRow,
  SettingValueRow,
  StudentAttendanceMetadataRow,
  StudentFilters,
} from './attendance.types';

import { rosterProfileColumnsSql, rosterProfileJoinsSql } from '../common/utils/student-roster.sql';

function pushScopeParams(target: unknown[], values: unknown[]): void {
  values.forEach((value) => {
    target.push(value);
  });
}

const CURRENT_ENROLLMENT_JOIN = `
      JOIN student_current_enrollment_resolution current_enrollment
        ON current_enrollment.person_uuid = s.person_uuid
       AND current_enrollment.selected_student_uuid = s.student_uuid
       AND current_enrollment.resolution_state = 'ACTIVE'
    `;

@Injectable()
export class AttendanceRepository {
  private readonly logger = new Logger(AttendanceRepository.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly tokenEncryption: TokenEncryptionService,
    @Inject(appConfig.KEY)
    private readonly appRuntimeConfig: ConfigType<typeof appConfig>,
  ) {}

  /** See TaskRepository.resolveMagicLink — same reconstruct-from-ciphertext logic. */
  private resolveMagicLink(tokenEncrypted: string | null | undefined): string | null {
    if (!tokenEncrypted) return null;
    try {
      const token = this.tokenEncryption.decrypt(tokenEncrypted);
      return `${this.appRuntimeConfig.frontendBaseUrl ?? ''}/task/${token}`;
    } catch {
      this.logger.warn('Unable to decrypt a stored task link; returning it as unavailable');
      return null;
    }
  }

  private async query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>> {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  private getExecutor(executor?: QueryExecutor): QueryExecutor {
    if (executor) {
      return executor;
    }

    return {
      query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
        return await this.query<T>(sql, params);
      },
    };
  }

  async withTransaction<T>(callback: (executor: QueryExecutor) => Promise<T>): Promise<T> {
    return await withDataSourceTransaction(this.dataSource, async (executor) => {
      return await callback(executor);
    });
  }

  async listGradeLevels(): Promise<GradeLevelRow[]> {
    const result = await this.query<GradeLevelRow>(
      'SELECT id, label, category FROM grade_levels ORDER BY id',
    );

    return result.rows;
  }

  async listSchools(filters: SchoolFilters, userScope?: DataScope): Promise<SchoolRow[]> {
    // Self-only actors (student logins) own no rows in these operational lists;
    // their reads go through explicit own-uuid paths, never area lists. An
    // unconfigured scope (no areas, no explicit global) likewise fails closed —
    // this query builds its scope clauses manually, so guard it here.
    if (userScope && (userScope.own_only === true || isUnconfiguredDataScope(userScope))) {
      return [];
    }
    let query = 'SELECT id, name, province, district, sub_district FROM schools';
    const params: unknown[] = [];
    const conditions: string[] = [];

    // Scope enforcement: schools table only has school_id/province/district/sub_district
    // dimensions — grade/room are not columns on schools, so only map the 4 supported
    // dimensions. buildDataScopeQuery falls back to bare column names for unmapped
    // dimensions (grade_level_id, room_id) which don't exist in schools, so we build
    // scope conditions manually for only the supported columns instead.
    if (userScope) {
      if (userScope.school_ids && userScope.school_ids.length > 0) {
        params.push(userScope.school_ids);
        conditions.push(`id = ANY($${params.length}::int[])`);
      }
      if (userScope.provinces && userScope.provinces.length > 0) {
        params.push(userScope.provinces);
        conditions.push(`province = ANY($${params.length}::text[])`);
      }
      if (userScope.districts && userScope.districts.length > 0) {
        params.push(userScope.districts);
        conditions.push(`district = ANY($${params.length}::text[])`);
      }
      if (userScope.sub_districts && userScope.sub_districts.length > 0) {
        params.push(userScope.sub_districts);
        conditions.push(`sub_district = ANY($${params.length}::text[])`);
      }
    }

    if (filters.province) {
      params.push(filters.province);
      conditions.push(`province = $${params.length}`);
    }
    if (filters.district) {
      params.push(filters.district);
      conditions.push(`district = $${params.length}`);
    }
    if (filters.subDistrict) {
      params.push(filters.subDistrict);
      conditions.push(`sub_district = $${params.length}`);
    }
    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      conditions.push(`name ILIKE $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY name ASC';

    const limit = filters.limit ?? 50;
    params.push(limit);
    query += ` LIMIT $${params.length}`;

    const result = await this.query<SchoolRow>(query, params);

    return result.rows;
  }

  async listLocationProvinces(): Promise<LocationProvinceRow[]> {
    const result = await this.query<LocationProvinceRow>(
      'SELECT DISTINCT province FROM schools ORDER BY province ASC',
    );

    return result.rows;
  }

  async listLocationDistricts(): Promise<LocationDistrictRow[]> {
    const result = await this.query<LocationDistrictRow>(
      'SELECT DISTINCT province, district FROM schools ORDER BY province ASC, district ASC',
    );

    return result.rows;
  }

  async listLocationSubDistricts(): Promise<LocationSubDistrictRow[]> {
    const result = await this.query<LocationSubDistrictRow>(
      'SELECT DISTINCT province, district, sub_district FROM schools ORDER BY province ASC, district ASC, sub_district ASC',
    );

    return result.rows;
  }

  async listStudents(
    filters: StudentFilters,
    userScope?: DataScope,
  ): Promise<AttendanceStudentRow[]> {
    // Self-only actors own no roster rows (see listSchools note).
    if (userScope?.own_only === true) {
      return [];
    }
    // Roster guard: this list is a class roster, not a national directory. A
    // global/area admin must pin a school (explicit filter or school-scoped
    // login) before we run it — otherwise return empty instead of every student
    // in the country.
    const hasSchoolBound =
      Number.isInteger(filters.schoolId) ||
      (Array.isArray(userScope?.school_ids) && userScope.school_ids.length > 0);
    if (!hasSchoolBound) {
      return [];
    }
    let query = `
      SELECT
        s.student_uuid as id,
        (s."FirstName_Onec" || ' ' || s."LastName_Onec") as name,
        ${rosterProfileColumnsSql('s')},
        COALESCE(gl.label, 'ไม่ทราบ') as grade,
        s."RoomID_Onec"::text as room,
        s."SchoolID_Onec" as school_id,
        sc.name as school_name,
        s.student_number,
        person.photo_storage_key,
        person.updated_at AS photo_updated_at,
        COALESCE(risk.term_absent_days, 0)::int AS term_absent_days,
        COALESCE(risk.absent_days_since_case_reset, 0)::int AS absent_days_since_case_reset,
        risk.absence_reset_after_date
      FROM student_term s
      ${CURRENT_ENROLLMENT_JOIN}
      ${rosterProfileJoinsSql('s')}
      LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
      LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
    `;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (userScope) {
      const scopeResult = buildDataScopeQuery(
        userScope,
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

      if (scopeResult.sql) {
        conditions.push(`(${scopeResult.sql})`);
        pushScopeParams(params, scopeResult.params);
      }
    }

    if (filters.grade) {
      params.push(filters.grade);
      conditions.push(`gl.label = $${params.length}`);
    }
    if (typeof filters.room === 'number') {
      params.push(filters.room);
      conditions.push(`s."RoomID_Onec" = $${params.length}`);
    }
    if (typeof filters.schoolId === 'number') {
      params.push(filters.schoolId);
      conditions.push(`s."SchoolID_Onec" = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY s."GradeLevelID_Onec" ASC, s."RoomID_Onec" ASC, s.student_uuid ASC';
    const result = await this.query<AttendanceStudentRow>(query, params);

    return result.rows;
  }

  async listAttendanceHistory(
    date: string,
    userScope?: DataScope,
    schoolId?: number | null,
    sessionKind?: 'SUBJECT',
    timetableSlotId?: number,
  ): Promise<AttendanceHistoryRow[]> {
    // Self-only actors own no history rows (see listSchools note).
    if (userScope?.own_only === true) {
      return [];
    }
    // Bound the query to a single school's day. Without a school the result set
    // is a whole day nationwide (global admin) — return empty instead. Scope is
    // still applied on top so an actor can't read a school outside their area.
    if (!Number.isInteger(schoolId)) {
      return [];
    }
    let query = `
      SELECT
        a.*,
        -- The roster is keyed by student and every reader of this list asks what
        -- a given student got, so the student is this row's identity; the table
        -- itself has no id column.
        a.student_uuid::text as id,
        a."SchoolID_Onec" as school_id,
        (s."FirstName_Onec" || ' ' || s."LastName_Onec") as name,
        COALESCE(gl.label, 'ไม่ทราบ') as grade,
        s."RoomID_Onec"::text as room,
        a."AttendanceStatus" as status
      FROM attendance a
      LEFT JOIN attendance_sessions sess ON sess.id = a.session_id
      JOIN student_term s ON s.student_uuid = a.student_uuid
      LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
      LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
      WHERE a."AttendanceDate" = $1
        AND a."SchoolID_Onec" = $2
        AND a.session_kind = 'SUBJECT'
    `;
    const params: unknown[] = [date, schoolId];

    if (sessionKind) {
      params.push(sessionKind);
      query += ` AND a.session_kind = $${params.length}`;
    }

    if (Number.isInteger(timetableSlotId)) {
      params.push(timetableSlotId);
      query += ` AND sess.timetable_slot_id = $${params.length}`;
    }

    if (userScope) {
      const scopeResult = buildDataScopeQuery(
        userScope,
        {
          school_id: `a."SchoolID_Onec"`,
          grade: `s."GradeLevelID_Onec"`,
          room: `s."RoomID_Onec"::text`,
          province: 'sc.province',
          district: 'sc.district',
          sub_district: 'sc.sub_district',
        },
        params.length + 1,
      );

      if (scopeResult.sql) {
        query += ` AND (${scopeResult.sql})`;
        pushScopeParams(params, scopeResult.params);
      }
    }

    query += ' ORDER BY s."GradeLevelID_Onec" ASC, s."RoomID_Onec" ASC';
    const result = await this.query<AttendanceHistoryRow>(query, params);

    return result.rows;
  }

  async listRooms(
    gradeLabel: string,
    schoolId?: number,
    userScope?: DataScope,
  ): Promise<RoomRow[]> {
    if (userScope && (userScope.own_only === true || isUnconfiguredDataScope(userScope))) {
      return [];
    }
    let query = `
      SELECT DISTINCT s."RoomID_Onec"::text as room
      FROM student_term s
      ${CURRENT_ENROLLMENT_JOIN}
      JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
      LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
      WHERE gl.label = $1
    `;
    const params: unknown[] = [gradeLabel];

    if (userScope) {
      const scopeResult = buildDataScopeQuery(
        userScope,
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
      if (scopeResult.sql) {
        query += ` AND (${scopeResult.sql})`;
        pushScopeParams(params, scopeResult.params);
      }
    }

    if (typeof schoolId === 'number') {
      params.push(schoolId);
      query += ` AND s."SchoolID_Onec" = $${params.length}`;
    }

    query += ' ORDER BY room ASC';
    const result = await this.query<RoomRow>(query, params);

    return result.rows;
  }

  async deleteAttendanceBatchForDate(
    date: string,
    studentIds: string[],
    executor?: QueryExecutor,
  ): Promise<void> {
    if (studentIds.length === 0) {
      return;
    }

    const queryExecutor = this.getExecutor(executor);
    await queryExecutor.query(
      `
        DELETE FROM attendance
        WHERE "AttendanceDate" = $1
          AND student_uuid = ANY($2::uuid[])
      `,
      [date, studentIds],
    );
  }

  async findStudentAttendanceMetadata(
    studentId: string,
    executor?: QueryExecutor,
  ): Promise<StudentAttendanceMetadataRow | null> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<StudentAttendanceMetadataRow>(
      `
        SELECT
          "SchoolID_Onec",
          "GradeLevelID_Onec",
          "RoomID_Onec",
          "AcademicYear_Onec",
          "Semester_Onec"
        FROM student_term
        WHERE student_uuid = $1
      `,
      [studentId],
    );

    return result.rows[0] || null;
  }

  /**
   * Return the subset of studentIds whose student_term row falls within the
   * actor's data scope. Mirrors the scope clause used by listStudents so write
   * authorization matches read visibility. Empty scope (global admin) imposes no
   * scope filter, so all existing requested ids are returned.
   */
  async filterStudentIdsInScope(
    studentIds: string[],
    userScope?: DataScope,
    executor?: QueryExecutor,
  ): Promise<string[]> {
    if (studentIds.length === 0) {
      return [];
    }
    // Self-only actors may not validate/write roster attendance at all.
    if (userScope?.own_only === true) {
      return [];
    }

    const params: unknown[] = [studentIds];
    const conditions: string[] = [`s.student_uuid = ANY($1::uuid[])`];

    if (userScope) {
      const scopeResult = buildDataScopeQuery(
        userScope,
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

      if (scopeResult.sql) {
        conditions.push(`(${scopeResult.sql})`);
        pushScopeParams(params, scopeResult.params);
      }
    }

    const result = await this.getExecutor(executor).query<{ id: string }>(
      `
        SELECT s.student_uuid AS id
        FROM student_term s
        ${CURRENT_ENROLLMENT_JOIN}
        LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
        WHERE ${conditions.join(' AND ')}
      `,
      params,
    );

    return result.rows.map((row) => String(row.id));
  }

  async insertAttendanceRecord(
    data: AttendanceInsertRecord,
    executor?: QueryExecutor,
  ): Promise<void> {
    const queryExecutor = this.getExecutor(executor);
    await queryExecutor.query(
      `
        INSERT INTO attendance (
          student_uuid,
          "SchoolID_Onec",
          "GradeLevelID_Onec",
          "RoomID_Onec",
          "AcademicYear_Onec",
          "Semester_Onec",
          "AttendanceDate",
          "Period",
          "AttendanceStatus",
          "RecordedBy",
          recorded_by_teacher_id,
          session_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        data.studentUuid,
        data.metadata.SchoolID_Onec,
        data.metadata.GradeLevelID_Onec,
        data.metadata.RoomID_Onec,
        data.metadata.AcademicYear_Onec,
        data.metadata.Semester_Onec,
        data.date,
        data.period,
        data.statusCode,
        data.recordedBy,
        data.recordedByTeacherId ?? null,
        data.sessionId,
      ],
    );
  }

  /**
   * Removes marks a teacher took back during a check-in in progress. Tapping the
   * same status twice clears the student, so the stored row has to go — leaving
   * it would make the next prefill resurrect a status the teacher undid.
   */
  async deleteAttendanceMarks(
    input: { sessionId: string; studentIds: string[] },
    executor: QueryExecutor,
  ): Promise<void> {
    if (input.studentIds.length === 0) {
      return;
    }
    await executor.query(
      `
        DELETE FROM attendance
        WHERE session_id = $1 AND student_uuid = ANY($2::uuid[])
      `,
      [input.sessionId, input.studentIds],
    );
  }

  async upsertAttendanceBatch(
    input: {
      studentIds: string[];
      statusCodes: number[];
      /** Per-student tap time (already clamped); `null` where unknown. */
      markedAt: Array<string | null>;
      date: string;
      period: number;
      sessionKind: 'SUBJECT';
      recordedBy: string;
      recordedByTeacherId?: number | null;
      sessionId: string;
      metadata: StudentAttendanceMetadataRow;
    },
    executor: QueryExecutor,
  ): Promise<void> {
    const sessionKind = 'SUBJECT';
    const conflictTarget = `ON CONFLICT (student_uuid, "AttendanceDate", "Period") WHERE session_kind = 'SUBJECT' DO UPDATE SET`;

    await executor.query(
      `
        INSERT INTO attendance (
          student_uuid,
          "SchoolID_Onec",
          "GradeLevelID_Onec",
          "RoomID_Onec",
          "AcademicYear_Onec",
          "Semester_Onec",
          "AttendanceDate",
          "Period",
          session_kind,
          "AttendanceStatus",
          "RecordedAt",
          marked_at,
          "RecordedBy",
          recorded_by_teacher_id,
          session_id
        )
        SELECT
          input.student_uuid,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          input.status_code,
          now(),
          input.marked_at,
          $11,
          $14,
          $12
        FROM UNNEST($1::uuid[], $2::smallint[], $13::timestamptz[])
          AS input(student_uuid, status_code, marked_at)
        ${conflictTarget}
          "SchoolID_Onec" = EXCLUDED."SchoolID_Onec",
          "GradeLevelID_Onec" = EXCLUDED."GradeLevelID_Onec",
          "RoomID_Onec" = EXCLUDED."RoomID_Onec",
          "AcademicYear_Onec" = EXCLUDED."AcademicYear_Onec",
          "Semester_Onec" = EXCLUDED."Semester_Onec",
          "AttendanceStatus" = EXCLUDED."AttendanceStatus",
          "RecordedAt" = now(),
          marked_at = EXCLUDED.marked_at,
          "RecordedBy" = EXCLUDED."RecordedBy",
          recorded_by_teacher_id = EXCLUDED.recorded_by_teacher_id,
          session_id = EXCLUDED.session_id
      `,
      [
        input.studentIds,
        input.statusCodes,
        input.metadata.SchoolID_Onec,
        input.metadata.GradeLevelID_Onec,
        input.metadata.RoomID_Onec,
        input.metadata.AcademicYear_Onec,
        input.metadata.Semester_Onec,
        input.date,
        input.period,
        sessionKind,
        input.recordedBy,
        input.sessionId,
        input.markedAt,
        input.recordedByTeacherId ?? null,
      ],
    );
  }

  async getAlertTriggerType(): Promise<string> {
    const result = await this.query<SettingValueRow>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'ALERT_TRIGGER_TYPE'",
    );

    return result.rowCount && result.rowCount > 0 ? result.rows[0].setting_value : 'SCHEDULED';
  }
}
