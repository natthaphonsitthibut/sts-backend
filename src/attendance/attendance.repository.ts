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

  async listSchools(filters: SchoolFilters): Promise<SchoolRow[]> {
    let query = 'SELECT id, name, province, district, sub_district FROM schools';
    const params: unknown[] = [];
    const conditions: string[] = [];

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

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY name ASC';
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
        s."PersonID_Onec" as id,
        (s."FirstName_Onec" || ' ' || s."LastName_Onec") as name,
        COALESCE(gl.label, 'ไม่ทราบ') as grade,
        s."RoomID_Onec"::text as room,
        s."SchoolID_Onec" as school_id,
        sc.name as school_name,
        (
          SELECT COUNT(*)
          FROM attendance a
          WHERE a."PersonID_Onec" = s."PersonID_Onec"
            AND a."AttendanceStatus" = 3
        ) as total_late,
        (
          SELECT COUNT(*)
          FROM attendance a
          WHERE a."PersonID_Onec" = s."PersonID_Onec"
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

    query += ' ORDER BY s."GradeLevelID_Onec" ASC, s."RoomID_Onec" ASC, s."PersonID_Onec" ASC';
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
      JOIN student_term s ON s."PersonID_Onec" = a."PersonID_Onec"
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
        tl.assigned_to_name as link_assigned_to,
        COALESCE(tl.admin_locked, 0) as active_link_locked,
        tl.admin_lock_reason as active_link_lock_reason,
        tl.admin_lock_at as active_link_lock_at
      FROM tasks t
      LEFT JOIN schools sc ON sc.id = t.target_school_id
      LEFT JOIN grade_levels gl ON gl.label = t.target_grade
      LEFT JOIN task_links tl ON tl.task_id = t.id AND tl.status = 'ACTIVE' AND tl.deleted_at IS NULL
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
    filters: { page: number; limit: number; searchTerm?: string; status?: string },
  ): Promise<{
    rows: AttendanceTaskRow[];
    totalCount: number;
    summary: { total: number; active: number; locked: number; expired: number };
  }> {
    const linkStateSql = `
      CASE
        WHEN COALESCE(tl.admin_locked, 0) = 1 THEN 'LOCKED'
        WHEN tl.id IS NULL THEN 'EXPIRED'
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
      ) tl ON true`;

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
    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      const p = params.length;
      filteredConditions.push(
        `(sc.name ILIKE $${p} OR t.target_grade ILIKE $${p} OR t.target_room ILIKE $${p} OR tl.assigned_to_name ILIKE $${p})`,
      );
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
        tl.assigned_to_name as link_assigned_to,
        COALESCE(tl.admin_locked, 0) as active_link_locked,
        tl.admin_lock_reason as active_link_lock_reason,
        tl.admin_lock_at as active_link_lock_at,
        ${linkStateSql} AS link_state
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
          AND "PersonID_Onec" = ANY($2::text[])
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
        WHERE "PersonID_Onec" = $1
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
    const conditions: string[] = [`s."PersonID_Onec" = ANY($1::text[])`];

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
        SELECT s."PersonID_Onec" AS id
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
          "PersonID_Onec",
          "SchoolID_Onec",
          "GradeLevelID_Onec",
          "RoomID_Onec",
          "AcademicYear_Onec",
          "Semester_Onec",
          "AttendanceDate",
          "Period",
          "AttendanceStatus",
          "RecordedBy"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        data.studentId,
        data.metadata.SchoolID_Onec,
        data.metadata.GradeLevelID_Onec,
        data.metadata.RoomID_Onec,
        data.metadata.AcademicYear_Onec,
        data.metadata.Semester_Onec,
        data.date,
        data.period,
        data.statusCode,
        data.recordedBy,
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
