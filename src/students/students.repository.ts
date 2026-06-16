import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildDataScopeQuery, type DataScope } from '../common/utils/authorization';
import { queryDataSource } from '../database/sql-query';
import type {
  PiiAccessEventInput,
  StudentAttendanceRow,
  StudentCaseRow,
  StudentDetailRow,
  StudentListFilters,
  StudentListRow,
  StudentsQueryResult,
} from './students.types';

function pushParams(target: unknown[], values: unknown[]): void {
  values.forEach((value) => {
    target.push(value);
  });
}

@Injectable()
export class StudentsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private async query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<StudentsQueryResult<T>> {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  async listStudents(
    filters: StudentListFilters,
    userScope?: DataScope,
  ): Promise<StudentListRow[]> {
    let query = `
      SELECT
        s."PersonID_Onec" as id,
        (s."FirstName_Onec" || ' ' || s."LastName_Onec") as name,
        COALESCE(gl.label, 'ไม่ทราบ') as grade,
        s."RoomID_Onec"::text as room,
        sc.name as school_name,
        sc.id as school_id
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
        pushParams(params, scopeResult.params);
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

    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      conditions.push(`(s."FirstName_Onec" || ' ' || s."LastName_Onec") ILIKE $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query +=
      ' ORDER BY s."SchoolID_Onec" ASC, s."GradeLevelID_Onec" ASC, s."RoomID_Onec" ASC, s."PersonID_Onec" ASC';
    const result = await this.query<StudentListRow>(query, params);

    return result.rows;
  }

  async findStudentById(id: string, userScope?: DataScope): Promise<StudentDetailRow | null> {
    let query = `
      SELECT
        s.*,
        gl.label as grade,
        s."RoomID_Onec"::text as room,
        sc.name as school_name
      FROM student_term s
      LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
      LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
      WHERE s."PersonID_Onec" = $1
    `;
    const params: unknown[] = [id];

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
        pushParams(params, scopeResult.params);
      }
    }

    const result = await this.query<StudentDetailRow>(query, params);
    return result.rows[0] || null;
  }

  /** Append one immutable PII-reveal record to the access log. */
  async insertPiiAccessEvent(event: PiiAccessEventInput): Promise<void> {
    await this.query(
      `
        INSERT INTO pii_access_events (
          actor_user_id,
          actor_roles,
          actor_kind,
          subject_student_ref,
          subject_ref_key_version,
          field_group,
          reason_code,
          reason_note,
          purpose_link_id,
          request_id,
          ip,
          user_agent
        )
        VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        event.actorUserId,
        JSON.stringify(event.actorRoles ?? []),
        event.actorKind,
        event.subjectStudentRef,
        event.subjectRefKeyVersion,
        event.fieldGroup,
        event.reasonCode,
        event.reasonNote,
        event.purposeLinkId,
        event.requestId,
        event.ip,
        event.userAgent,
      ],
    );
  }

  async findCasesByStudentName(name: string): Promise<StudentCaseRow[]> {
    const result = await this.query<StudentCaseRow>(
      `
        SELECT *
        FROM cases
        WHERE student_name = $1
      `,
      [name],
    );

    return result.rows;
  }

  async listAttendanceByStudentId(
    id: string,
    userScope?: DataScope,
  ): Promise<StudentAttendanceRow[]> {
    let query = `
      SELECT
        a."AttendanceDate" as date,
        a."AttendanceStatus" as status,
        a."Period" as period
      FROM attendance a
      JOIN student_term s ON s."PersonID_Onec" = a."PersonID_Onec"
      LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
      WHERE a."PersonID_Onec" = $1
    `;
    const params: unknown[] = [id];

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
        pushParams(params, scopeResult.params);
      }
    }

    query += ' ORDER BY a."AttendanceDate" DESC';
    const result = await this.query<StudentAttendanceRow>(query, params);

    return result.rows;
  }
}
