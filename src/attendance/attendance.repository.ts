import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildDataScopeQuery, type DataScope } from '../common/utils/authorization';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type {
  AttendanceHistoryRow,
  AttendanceInsertRecord,
  AttendanceStudentRow,
  AttendanceTaskRow,
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

function pushScopeParams(target: unknown[], values: unknown[]): void {
  values.forEach((value) => {
    target.push(value);
  });
}

@Injectable()
export class AttendanceRepository {
  constructor(private readonly dataSource: DataSource) {}

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
        COALESCE(gl.label, 'ไม่ทราบ') as grade,
        s."RoomID_Onec"::text as room,
        s."SchoolID_Onec" as school_id,
        sc.name as school_name,
        (
          SELECT COUNT(*)
          FROM attendance a
          WHERE a.student_uuid = s.student_uuid
            AND a."AttendanceStatus" = 3
        ) as total_late,
        (
          SELECT COUNT(*)
          FROM attendance a
          WHERE a.student_uuid = s.student_uuid
            AND a."AttendanceStatus" = 2
        ) as total_absent
      FROM student_term s
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
  ): Promise<AttendanceHistoryRow[]> {
    // Bound the query to a single school's day. Without a school the result set
    // is a whole day nationwide (global admin) — return empty instead. Scope is
    // still applied on top so an actor can't read a school outside their area.
    if (!Number.isInteger(schoolId)) {
      return [];
    }
    let query = `
      SELECT
        a.*,
        a."SchoolID_Onec" as school_id,
        (s."FirstName_Onec" || ' ' || s."LastName_Onec") as name,
        COALESCE(gl.label, 'ไม่ทราบ') as grade,
        s."RoomID_Onec"::text as room,
        a."AttendanceStatus" as status
      FROM attendance a
      JOIN student_term s ON s.student_uuid = a.student_uuid
      LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
      LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
      WHERE a."AttendanceDate" = $1
        AND a."SchoolID_Onec" = $2
    `;
    const params: unknown[] = [date, schoolId];

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

  async listAttendanceTasks(userScope?: DataScope): Promise<AttendanceTaskRow[]> {
    const conditions = [`t.task_type = 'ATTENDANCE'`, 't.deleted_at IS NULL'];
    let query = `
      SELECT
        t.id as task_id,
        t.task_type,
        t.target_grade,
        t.target_room,
        t.target_school_id,
        sc.name as target_school_name,
        t.status as task_status,
        t.created_at,
        tl.id as active_link_id,
        tl.magic_link as active_link,
        tl.created_at as active_link_created_at,
        tl.expires_at as active_link_expires_at,
        tl.assigned_to_name as link_assigned_to,
        tl.assigned_to_email as link_assigned_to_email,
        COALESCE(tl.admin_locked, 0) as active_link_locked,
        tl.admin_lock_reason as active_link_lock_reason,
        tl.admin_lock_at as active_link_lock_at,
        sess.id AS attendance_session_id,
        sess.status AS attendance_session_status,
        sess.expected_roster_count AS attendance_expected_roster_count,
        sess.recorded_count AS attendance_recorded_count,
        CASE
          WHEN sess.status = 'SUBMITTED' THEN 'COMPLETED'
          ELSE 'NOT_CHECKED'
        END AS attendance_check_status
      FROM tasks t
      LEFT JOIN schools sc ON sc.id = t.target_school_id
      LEFT JOIN grade_levels gl ON gl.label = t.target_grade
      LEFT JOIN LATERAL (
        SELECT link.*
        FROM task_links link
        WHERE link.task_id = t.id
          AND link.status = 'ACTIVE'
          AND link.deleted_at IS NULL
        ORDER BY link.created_at DESC
        LIMIT 1
      ) tl ON true
      LEFT JOIN LATERAL (
        SELECT attendance_session.*
        FROM attendance_sessions attendance_session
        WHERE attendance_session.school_id = t.target_school_id
          AND attendance_session.grade_level_id = gl.id
          AND attendance_session.room_id::text = t.target_room
          AND attendance_session.attendance_date = (tl.created_at AT TIME ZONE 'Asia/Bangkok')::date
          AND attendance_session.period = 1
          AND attendance_session.session_kind = 'DAILY'
          AND attendance_session.deleted_at IS NULL
        ORDER BY attendance_session.submitted_at DESC NULLS LAST,
          attendance_session.created_at DESC
        LIMIT 1
      ) sess ON true
    `;
    const params: unknown[] = [];

    if (userScope) {
      const scopeResult = buildDataScopeQuery(
        userScope,
        {
          school_id: 't.target_school_id',
          grade: 'gl.id',
          room: 't.target_room',
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

    query += ` WHERE ${conditions.join(' AND ')}`;
    query += ' ORDER BY t.created_at DESC';
    const result = await this.query<AttendanceTaskRow>(query, params);

    return result.rows;
  }

  /**
   * Server-paginated attendance links for the dashboard (replaces loading every
   * task + filtering client-side). Link state (ACTIVE/LOCKED/EXPIRED) is derived
   * in SQL; the summary counts the whole scoped set (not just the page); the
   * LATERAL picks one active link per task so paging is stable.
   */
  async listAttendanceTasksPaginated(
    userScope: DataScope | undefined,
    filters: {
      page: number;
      limit: number;
      searchTerm?: string;
      status?: string;
      province?: string;
      district?: string;
      subDistrict?: string;
      schoolId?: number;
      grade?: string;
      room?: string;
    },
  ): Promise<{
    rows: AttendanceTaskRow[];
    totalCount: number;
    summary: { total: number; active: number; locked: number; expired: number };
  }> {
    const linkStateSql = `
      CASE
        WHEN tl.id IS NULL OR tl.expires_at <= NOW() THEN 'EXPIRED'
        WHEN COALESCE(tl.admin_locked, 0) = 1 THEN 'LOCKED'
        ELSE 'ACTIVE'
      END`;
    const fromSql = `
      FROM tasks t
      LEFT JOIN schools sc ON sc.id = t.target_school_id
      LEFT JOIN grade_levels gl ON gl.label = t.target_grade
      LEFT JOIN LATERAL (
        SELECT l.*
        FROM task_links l
        WHERE l.task_id = t.id AND l.status = 'ACTIVE' AND l.deleted_at IS NULL
        ORDER BY l.created_at DESC
        LIMIT 1
      ) tl ON true
      LEFT JOIN LATERAL (
        SELECT attendance_session.*
        FROM attendance_sessions attendance_session
        WHERE attendance_session.school_id = t.target_school_id
          AND attendance_session.grade_level_id = gl.id
          AND attendance_session.room_id::text = t.target_room
          AND attendance_session.attendance_date = (tl.created_at AT TIME ZONE 'Asia/Bangkok')::date
          AND attendance_session.period = 1
          AND attendance_session.session_kind = 'DAILY'
          AND attendance_session.deleted_at IS NULL
        ORDER BY attendance_session.submitted_at DESC NULLS LAST,
          attendance_session.created_at DESC
        LIMIT 1
      ) sess ON true`;

    const params: unknown[] = [];
    const policyConditions: string[] = [`t.task_type = 'ATTENDANCE'`, 't.deleted_at IS NULL'];
    if (userScope) {
      const scopeResult = buildDataScopeQuery(
        userScope,
        {
          school_id: 't.target_school_id',
          grade: 'gl.id',
          room: 't.target_room',
          province: 'sc.province',
          district: 'sc.district',
          sub_district: 'sc.sub_district',
        },
        params.length + 1,
      );
      if (scopeResult.sql) {
        policyConditions.push(`(${scopeResult.sql})`);
        pushScopeParams(params, scopeResult.params);
      }
    }

    const policyWhereSql = `WHERE ${policyConditions.join(' AND ')}`;
    // Summary spans the whole scoped set, so it runs on policy params only —
    // before search/status params are appended below.
    const summaryResult = await this.query<Record<string, unknown>>(
      `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${linkStateSql} = 'ACTIVE')::int AS active,
        COUNT(*) FILTER (WHERE ${linkStateSql} = 'LOCKED')::int AS locked,
        COUNT(*) FILTER (WHERE ${linkStateSql} = 'EXPIRED')::int AS expired
      ${fromSql}
      ${policyWhereSql}
    `,
      params,
    );

    const filteredConditions = [...policyConditions];
    if (filters.province) {
      params.push(filters.province);
      filteredConditions.push(`sc.province = $${params.length}`);
    }
    if (filters.district) {
      params.push(filters.district);
      filteredConditions.push(`sc.district = $${params.length}`);
    }
    if (filters.subDistrict) {
      params.push(filters.subDistrict);
      filteredConditions.push(`sc.sub_district = $${params.length}`);
    }
    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      const p = params.length;
      filteredConditions.push(
        `(sc.name ILIKE $${p} OR t.target_grade ILIKE $${p} OR t.target_room ILIKE $${p} OR tl.assigned_to_name ILIKE $${p})`,
      );
    }
    if (filters.schoolId) {
      params.push(filters.schoolId);
      filteredConditions.push(`t.target_school_id = $${params.length}`);
    }
    if (filters.grade) {
      params.push(filters.grade);
      filteredConditions.push(`t.target_grade = $${params.length}`);
    }
    if (filters.room) {
      params.push(filters.room);
      filteredConditions.push(`t.target_room = $${params.length}`);
    }
    if (filters.status && filters.status !== 'ALL') {
      params.push(filters.status);
      filteredConditions.push(`${linkStateSql} = $${params.length}`);
    }
    const filteredWhereSql = `WHERE ${filteredConditions.join(' AND ')}`;

    const countResult = await this.query<{ count?: string }>(
      `SELECT count(*) ${fromSql} ${filteredWhereSql}`,
      params,
    );
    const totalCount = Number.parseInt(countResult.rows[0]?.count ?? '0', 10);

    const offset = (filters.page - 1) * filters.limit;
    const selectParams = [...params, filters.limit, offset];
    const limitPlaceholder = selectParams.length - 1;
    const offsetPlaceholder = selectParams.length;

    const result = await this.query<AttendanceTaskRow>(
      `
      SELECT
        t.id as task_id,
        t.task_type,
        t.target_grade,
        t.target_room,
        t.target_school_id,
        sc.name as target_school_name,
        t.status as task_status,
        t.created_at,
        tl.id as active_link_id,
        tl.magic_link as active_link,
        tl.created_at as active_link_created_at,
        tl.expires_at as active_link_expires_at,
        tl.assigned_to_name as link_assigned_to,
        tl.assigned_to_email as link_assigned_to_email,
        COALESCE(tl.admin_locked, 0) as active_link_locked,
        tl.admin_lock_reason as active_link_lock_reason,
        tl.admin_lock_at as active_link_lock_at,
        ${linkStateSql} AS link_state,
        sess.id AS attendance_session_id,
        sess.status AS attendance_session_status,
        sess.expected_roster_count AS attendance_expected_roster_count,
        sess.recorded_count AS attendance_recorded_count,
        CASE
          WHEN sess.status = 'SUBMITTED' THEN 'COMPLETED'
          ELSE 'NOT_CHECKED'
        END AS attendance_check_status
      ${fromSql}
      ${filteredWhereSql}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
    `,
      selectParams,
    );

    const summaryRow = summaryResult.rows[0] || {};
    return {
      rows: result.rows,
      totalCount,
      summary: {
        total: Number(summaryRow.total || 0),
        active: Number(summaryRow.active || 0),
        locked: Number(summaryRow.locked || 0),
        expired: Number(summaryRow.expired || 0),
      },
    };
  }

  async listRooms(gradeLabel: string, schoolId?: number): Promise<RoomRow[]> {
    let query = `
      SELECT DISTINCT s."RoomID_Onec"::text as room
      FROM student_term s
      JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
      WHERE gl.label = $1
    `;
    const params: unknown[] = [gradeLabel];

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
          session_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        data.sessionId,
      ],
    );
  }

  async upsertAttendanceBatch(
    input: {
      studentIds: string[];
      statusCodes: number[];
      date: string;
      period: number;
      recordedBy: string;
      sessionId: string;
      metadata: StudentAttendanceMetadataRow;
    },
    executor: QueryExecutor,
  ): Promise<void> {
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
          "AttendanceStatus",
          "RecordedAt",
          "RecordedBy",
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
          input.status_code,
          now(),
          $10,
          $11
        FROM UNNEST($1::uuid[], $2::smallint[]) AS input(student_uuid, status_code)
        ON CONFLICT (student_uuid, "AttendanceDate", "Period") DO UPDATE SET
          "SchoolID_Onec" = EXCLUDED."SchoolID_Onec",
          "GradeLevelID_Onec" = EXCLUDED."GradeLevelID_Onec",
          "RoomID_Onec" = EXCLUDED."RoomID_Onec",
          "AcademicYear_Onec" = EXCLUDED."AcademicYear_Onec",
          "Semester_Onec" = EXCLUDED."Semester_Onec",
          "AttendanceStatus" = EXCLUDED."AttendanceStatus",
          "RecordedAt" = now(),
          "RecordedBy" = EXCLUDED."RecordedBy",
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
        input.recordedBy,
        input.sessionId,
      ],
    );
  }

  async listAttendanceStatuses(
    studentIds: string[],
    date: string,
    period: number,
    executor: QueryExecutor,
  ): Promise<Array<{ student_uuid: string; attendance_status: number }>> {
    if (studentIds.length === 0) return [];
    const result = await executor.query<{
      student_uuid: string;
      attendance_status: number;
    }>(
      `
        SELECT student_uuid, "AttendanceStatus"::int AS attendance_status
        FROM attendance
        WHERE student_uuid = ANY($1::uuid[])
          AND "AttendanceDate" = $2
          AND "Period" = $3
      `,
      [studentIds, date, period],
    );
    return result.rows;
  }

  async getAlertTriggerType(): Promise<string> {
    const result = await this.query<SettingValueRow>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'ALERT_TRIGGER_TYPE'",
    );

    return result.rowCount && result.rowCount > 0 ? result.rows[0].setting_value : 'SCHEDULED';
  }
}
