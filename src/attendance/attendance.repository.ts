import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { isUnconfiguredDataScope } from '../auth/auth.types';
import { appConfig } from '../config/app.config';
import { buildDataScopeQuery, type DataScope } from '../common/utils/authorization';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import { queryDataSource } from '../database/sql-query';
import type {
  AttendanceHistoryRow,
  AttendanceStudentRow,
  GradeLevelRow,
  LocationDistrictRow,
  LocationProvinceRow,
  LocationSubDistrictRow,
  QueryResultLike,
  RoomRow,
  SchoolFilters,
  SchoolRow,
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
      FROM attendance_effective_records a
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
}
