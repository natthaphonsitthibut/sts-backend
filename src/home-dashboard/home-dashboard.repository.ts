import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isUnconfiguredDataScope, normalizeDataScope } from '../auth/auth.types';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { queryDataSource } from '../database/sql-query';
import type {
  CountRow,
  HomeDashboardActor,
  HomeDashboardCaseMovementPoint,
  HomeDashboardCasePipeline,
  HomeDashboardFilterOptions,
  HomeDashboardFilters,
  HomeDashboardOption,
  HomeDashboardRiskAreaDimension,
  HomeDashboardRiskAreaPoint,
  HomeDashboardRiskDistribution,
  HomeDashboardTrendPoint,
  NormalizedHomeDashboardFilters,
} from './home-dashboard.types';

interface ScopeQuery {
  sql: string;
  params: unknown[];
}

interface AttentionRow extends Record<string, unknown> {
  id: string;
  kind: 'RISK_HIGH' | 'CASE_OVERDUE' | 'CASE_PENDING_REVIEW';
  label: string;
  reason: string;
  count: number | string;
  age_label: string | null;
  target_path: string;
  target_query: Record<string, string | number> | null;
  priority: number | string;
}

interface RiskSummaryRow extends Record<string, unknown> {
  HIGH: number | string;
  WATCH: number | string;
  NORMAL: number | string;
}

interface CasePipelineRow extends Record<string, unknown> {
  OPEN: number | string;
  IN_PROGRESS: number | string;
  PENDING_REVIEW: number | string;
  RESOLVED: number | string;
}

interface RiskAreaRankingRow extends Record<string, unknown> {
  key: string;
  label: string;
  count: number | string;
  areaCode: string | null;
}

const CURRENT_ENROLLMENT_JOIN = `
  JOIN student_current_enrollment_resolution current_enrollment
    ON current_enrollment.person_uuid = s.person_uuid
   AND current_enrollment.selected_student_uuid = s.student_uuid
   AND current_enrollment.resolution_state = 'ACTIVE'
`;

function toNumber(value: unknown): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function trimOrUndefined(value?: string): string | undefined {
  const next = value?.trim();
  return next && next.length > 0 ? next : undefined;
}

const DEFAULT_RISK_THRESHOLDS = {
  /** Cumulative absent days that open a case and mark a student เสี่ยง. */
  highAbsentDays: 3,
};

@Injectable()
export class HomeDashboardRepository {
  constructor(private readonly dataSource: DataSource) {}

  private async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  private buildStudentScopeQuery(
    actor: HomeDashboardActor,
    filters: HomeDashboardFilters,
    startIndex = 1,
  ): ScopeQuery {
    if (actor.data_scope?.own_only === true || isUnconfiguredDataScope(actor.data_scope)) {
      return { sql: '1=0', params: [] };
    }

    const params: unknown[] = [];
    const conditions: string[] = [];

    if (actor.data_scope) {
      const normalizedScope = normalizeDataScope(actor.data_scope);
      if (!normalizedScope) {
        return { sql: '1=0', params: [] };
      }
      const scope = buildDataScopeQuery(
        normalizedScope,
        {
          school_id: `s."SchoolID_Onec"`,
          grade: `s."GradeLevelID_Onec"`,
          room: `s."RoomID_Onec"::text`,
          province: 'sc.province',
          district: 'sc.district',
          sub_district: 'sc.sub_district',
        },
        startIndex,
      );
      if (scope.sql) {
        conditions.push(`(${scope.sql})`);
        params.push(...scope.params);
      }
    }

    let index = startIndex + params.length;
    if (filters.province) {
      conditions.push(`sc.province = $${index++}`);
      params.push(filters.province);
    }
    if (filters.district) {
      conditions.push(`sc.district = $${index++}`);
      params.push(filters.district);
    }
    if (filters.subDistrict) {
      conditions.push(`sc.sub_district = $${index++}`);
      params.push(filters.subDistrict);
    }
    if (filters.schoolId) {
      conditions.push(`s."SchoolID_Onec" = $${index++}`);
      params.push(filters.schoolId);
    }
    if (filters.grade) {
      conditions.push(`gl.label = $${index++}`);
      params.push(filters.grade);
    }
    if (filters.room) {
      conditions.push(`s."RoomID_Onec"::text = $${index++}`);
      params.push(filters.room);
    }

    return { sql: conditions.join(' AND '), params };
  }

  private buildCaseScopeQuery(
    actor: HomeDashboardActor,
    filters: HomeDashboardFilters,
    startIndex = 1,
  ): ScopeQuery {
    if (actor.data_scope?.own_only === true || isUnconfiguredDataScope(actor.data_scope)) {
      return { sql: '1=0', params: [] };
    }

    const params: unknown[] = [];
    const conditions: string[] = [];

    if (actor.data_scope) {
      const normalizedScope = normalizeDataScope(actor.data_scope);
      if (!normalizedScope) {
        return { sql: '1=0', params: [] };
      }
      const { grade_levels: gradeLevels, room_ids: roomIds, ...areaScope } = normalizedScope;
      const scope = buildDataScopeQuery(
        areaScope,
        {
          school_id: 'c.school_id',
          province: 'sc.province',
          district: 'sc.district',
          sub_district: 'sc.sub_district',
        },
        startIndex,
      );
      if (scope.sql) {
        conditions.push(`(${scope.sql})`);
        params.push(...scope.params);
      }
      let scopeIndex = startIndex + params.length;
      if ((gradeLevels?.length ?? 0) > 0 || (roomIds?.length ?? 0) > 0) {
        const enrollmentConditions = [
          'case_scope_student.student_uuid = c.student_uuid',
          'case_scope_current.selected_student_uuid = case_scope_student.student_uuid',
          'case_scope_current.person_uuid = case_scope_student.person_uuid',
          `case_scope_current.resolution_state = 'ACTIVE'`,
        ];
        if (gradeLevels?.length) {
          enrollmentConditions.push(
            `case_scope_student."GradeLevelID_Onec" = ANY($${scopeIndex++}::int[])`,
          );
          params.push(gradeLevels);
        }
        if (roomIds?.length) {
          enrollmentConditions.push(
            `case_scope_student."RoomID_Onec"::text = ANY($${scopeIndex++}::text[])`,
          );
          params.push(roomIds.map(String));
        }
        conditions.push(`EXISTS (
          SELECT 1
          FROM student_term case_scope_student
          JOIN student_current_enrollment_resolution case_scope_current
            ON case_scope_current.person_uuid = case_scope_student.person_uuid
          WHERE ${enrollmentConditions.join(' AND ')}
        )`);
      }
    }

    let index = startIndex + params.length;
    if (filters.province) {
      conditions.push(`sc.province = $${index++}`);
      params.push(filters.province);
    }
    if (filters.district) {
      conditions.push(`sc.district = $${index++}`);
      params.push(filters.district);
    }
    if (filters.subDistrict) {
      conditions.push(`sc.sub_district = $${index++}`);
      params.push(filters.subDistrict);
    }
    if (filters.schoolId) {
      conditions.push(`c.school_id = $${index++}`);
      params.push(filters.schoolId);
    }
    if (filters.grade || filters.room) {
      const classConditions: string[] = [`case_student.student_uuid = c.student_uuid`];
      if (filters.grade) {
        classConditions.push(`case_grade.label = $${index++}`);
        params.push(filters.grade);
      }
      if (filters.room) {
        classConditions.push(`case_student."RoomID_Onec"::text = $${index++}`);
        params.push(filters.room);
      }
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM student_term case_student
          LEFT JOIN grade_levels case_grade ON case_grade.id = case_student."GradeLevelID_Onec"
          WHERE ${classConditions.join(' AND ')}
        )
      `);
    }

    return { sql: conditions.join(' AND '), params };
  }

  async countStudents(actor: HomeDashboardActor, filters: HomeDashboardFilters): Promise<number> {
    const scope = this.buildStudentScopeQuery(actor, filters);
    const whereSql = scope.sql ? `WHERE ${scope.sql}` : '';
    const result = await this.query<CountRow>(
      `
        SELECT COUNT(DISTINCT s.student_uuid)::int AS count
        FROM student_term s
        ${CURRENT_ENROLLMENT_JOIN}
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        ${whereSql}
      `,
      scope.params,
    );
    return toNumber(result.rows[0]?.count);
  }

  async countActiveCases(
    actor: HomeDashboardActor,
    filters: HomeDashboardFilters,
  ): Promise<number> {
    const scope = this.buildCaseScopeQuery(actor, filters);
    const whereSql = ['c.deleted_at IS NULL', `c.status = 'IN_PROGRESS'`, scope.sql]
      .filter(Boolean)
      .join(' AND ');
    const result = await this.query<CountRow>(
      `
        SELECT COUNT(*)::int AS count
        FROM cases c
        LEFT JOIN schools sc ON sc.id = c.school_id
        WHERE ${whereSql}
      `,
      scope.params,
    );
    return toNumber(result.rows[0]?.count);
  }

  async countHighRiskStudents(
    actor: HomeDashboardActor,
    filters: HomeDashboardFilters,
  ): Promise<number> {
    const scope = this.buildStudentScopeQuery(actor, filters);
    const whereSql = [scope.sql, `profile.risk_tier = 'HIGH'`].filter(Boolean).join(' AND ');
    const result = await this.query<CountRow>(
      `
        SELECT COUNT(DISTINCT s.student_uuid)::int AS count
        FROM student_term s
        ${CURRENT_ENROLLMENT_JOIN}
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        LEFT JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
        WHERE ${whereSql}
      `,
      scope.params,
    );
    return toNumber(result.rows[0]?.count);
  }

  async getHighRiskAreaRanking(
    actor: HomeDashboardActor,
    filters: HomeDashboardFilters,
    dimension: HomeDashboardRiskAreaDimension,
  ): Promise<Array<Omit<HomeDashboardRiskAreaPoint, 'targetFilter'>>> {
    const scope = this.buildStudentScopeQuery(actor, filters);
    const dimensions: Record<
      HomeDashboardRiskAreaDimension,
      { key: string; label: string; areaCode: string; present: string }
    > = {
      PROVINCE: {
        key: 'sc.province',
        label: 'sc.province',
        areaCode: 'sc.province_code',
        present: `NULLIF(BTRIM(sc.province), '') IS NOT NULL`,
      },
      DISTRICT: {
        key: 'sc.district',
        label: 'sc.district',
        areaCode: 'sc.district_code',
        present: `NULLIF(BTRIM(sc.district), '') IS NOT NULL`,
      },
      SUB_DISTRICT: {
        key: 'sc.sub_district',
        label: 'sc.sub_district',
        areaCode: 'sc.sub_district_code',
        present: `NULLIF(BTRIM(sc.sub_district), '') IS NOT NULL`,
      },
      SCHOOL: {
        key: 'sc.id::text',
        label: `COALESCE(NULLIF(BTRIM(sc.name), ''), 'โรงเรียน ' || sc.id::text)`,
        areaCode: 'NULL::text',
        present: 'sc.id IS NOT NULL',
      },
    };
    const selected = dimensions[dimension];
    const whereSql = [scope.sql, `profile.risk_tier = 'HIGH'`, selected.present]
      .filter(Boolean)
      .join(' AND ');
    const result = await this.query<RiskAreaRankingRow>(
      `
        SELECT
          ${selected.key} AS key,
          ${selected.label} AS label,
          ${selected.areaCode} AS "areaCode",
          COUNT(DISTINCT s.student_uuid)::int AS count
        FROM student_term s
        ${CURRENT_ENROLLMENT_JOIN}
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        INNER JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
        WHERE ${whereSql}
        GROUP BY ${selected.key}, ${selected.label}, ${selected.areaCode}
        ORDER BY count DESC, label ASC
      `,
      scope.params,
    );
    return result.rows.map((row) => ({
      key: String(row.key),
      label: String(row.label),
      count: toNumber(row.count),
      areaCode: row.areaCode ? String(row.areaCode) : null,
    }));
  }

  async getCasePipeline(
    actor: HomeDashboardActor,
    filters: HomeDashboardFilters,
  ): Promise<HomeDashboardCasePipeline> {
    const scope = this.buildCaseScopeQuery(actor, filters);
    const whereSql = ['c.deleted_at IS NULL', scope.sql].filter(Boolean).join(' AND ');
    const result = await this.query<CasePipelineRow>(
      `
        SELECT
          COUNT(*) FILTER (WHERE c.status = 'OPEN')::int AS "OPEN",
          COUNT(*) FILTER (WHERE c.status = 'IN_PROGRESS')::int AS "IN_PROGRESS",
          COUNT(*) FILTER (WHERE c.status = 'PENDING_REVIEW')::int AS "PENDING_REVIEW",
          COUNT(*) FILTER (WHERE c.status = 'RESOLVED')::int AS "RESOLVED"
        FROM cases c
        LEFT JOIN schools sc ON sc.id = c.school_id
        WHERE ${whereSql}
      `,
      scope.params,
    );
    const row = result.rows[0] || {};
    return {
      OPEN: toNumber(row.OPEN),
      IN_PROGRESS: toNumber(row.IN_PROGRESS),
      PENDING_REVIEW: toNumber(row.PENDING_REVIEW),
      RESOLVED: toNumber(row.RESOLVED),
    };
  }

  async getRiskDistribution(
    actor: HomeDashboardActor,
    filters: HomeDashboardFilters,
  ): Promise<HomeDashboardRiskDistribution> {
    const scope = this.buildStudentScopeQuery(actor, filters);
    const whereSql = scope.sql ? `WHERE ${scope.sql}` : '';
    const result = await this.query<RiskSummaryRow>(
      `
        SELECT
          COUNT(*) FILTER (WHERE COALESCE(profile.risk_tier, 'NORMAL') = 'HIGH')::int AS "HIGH",
          COUNT(*) FILTER (WHERE COALESCE(profile.risk_tier, 'NORMAL') = 'WATCH')::int AS "WATCH",
          COUNT(*) FILTER (WHERE COALESCE(profile.risk_tier, 'NORMAL') = 'NORMAL')::int AS "NORMAL"
        FROM student_term s
        ${CURRENT_ENROLLMENT_JOIN}
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        LEFT JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
        ${whereSql}
      `,
      scope.params,
    );
    const row = result.rows[0] || {};
    return {
      HIGH: toNumber(row.HIGH),
      WATCH: toNumber(row.WATCH),
      NORMAL: toNumber(row.NORMAL),
    };
  }

  async getRiskThresholds(): Promise<Record<string, number>> {
    const result = await this.query<{ setting_key: string; setting_value: string }>(
      `
        SELECT setting_key, setting_value
        FROM system_settings
        WHERE setting_key = $1
      `,
      ['CASE_RISK_HIGH_ABSENCE_DAYS'],
    );
    const raw = Number(result.rows[0]?.setting_value);
    return {
      highAbsentDays:
        Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_RISK_THRESHOLDS.highAbsentDays,
    };
  }

  async getCurrentTermStart(
    actor: HomeDashboardActor,
    filters: NormalizedHomeDashboardFilters,
    today: string,
  ): Promise<string | null> {
    const normalizedScope = normalizeDataScope(actor.data_scope);
    if (
      !normalizedScope ||
      normalizedScope.own_only === true ||
      isUnconfiguredDataScope(normalizedScope)
    ) {
      return null;
    }
    const areaScope = { ...normalizedScope };
    delete areaScope.grade_levels;
    delete areaScope.room_ids;
    const params: unknown[] = [today];
    const conditions = [
      `st.status = 'ACTIVE'`,
      'st.deleted_at IS NULL',
      'st.starts_on IS NOT NULL',
      'st.ends_on IS NOT NULL',
      'st.starts_on <= $1::date',
      'st.ends_on >= $1::date',
    ];
    const scope = buildDataScopeQuery(
      areaScope,
      {
        school_id: 'st.school_id',
        province: 'sc.province',
        district: 'sc.district',
        sub_district: 'sc.sub_district',
      },
      2,
    );
    if (scope.sql) {
      conditions.push(`(${scope.sql})`);
      params.push(...scope.params);
    }
    let index = params.length + 1;
    for (const [value, column] of [
      [filters.province, 'sc.province'],
      [filters.district, 'sc.district'],
      [filters.subDistrict, 'sc.sub_district'],
      [filters.schoolId, 'st.school_id'],
    ] as const) {
      if (value) {
        conditions.push(`${column} = $${index++}`);
        params.push(value);
      }
    }
    const result = await this.query<{ starts_on: string | null }>(
      `
        SELECT MIN(st.starts_on)::text AS starts_on
        FROM school_terms st
        LEFT JOIN schools sc ON sc.id = st.school_id
        WHERE ${conditions.join(' AND ')}
      `,
      params,
    );
    return result.rows[0]?.starts_on ?? null;
  }

  async getAttendanceTrend(
    actor: HomeDashboardActor,
    filters: NormalizedHomeDashboardFilters,
    startsOn: string,
    endsOn: string,
  ): Promise<HomeDashboardTrendPoint[]> {
    const scope = this.buildStudentScopeQuery(actor, filters, 3);
    const whereSql = [scope.sql].filter(Boolean).join(' AND ');
    const result = await this.query<{
      key: string;
      present: number | string;
      absent: number | string;
      late: number | string;
      total: number | string;
    }>(
      `
        SELECT
          a."AttendanceDate"::text AS key,
          COUNT(*) FILTER (WHERE a."AttendanceStatus" = 1)::int AS present,
          COUNT(*) FILTER (WHERE a."AttendanceStatus" = 2)::int AS absent,
          COUNT(*) FILTER (WHERE a."AttendanceStatus" = 3)::int AS late,
          COUNT(*)::int AS total
        -- One row per student per day, derived from that day's periods, so the
        -- chart and the risk engine answer "came to school" the same way.
        FROM attendance_day a
        JOIN student_term s ON s.student_uuid = a.student_uuid
        ${CURRENT_ENROLLMENT_JOIN}
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        WHERE a."AttendanceDate" BETWEEN $1::date AND $2::date
          ${whereSql ? `AND ${whereSql}` : ''}
        GROUP BY a."AttendanceDate"
        ORDER BY a."AttendanceDate" ASC
      `,
      [startsOn, endsOn, ...scope.params],
    );
    return result.rows.map((row) => {
      const present = toNumber(row.present);
      const absent = toNumber(row.absent);
      const late = toNumber(row.late);
      const total = toNumber(row.total);
      return {
        key: row.key,
        label: row.key,
        present,
        absent,
        late,
        total,
        attendanceRate: total > 0 ? Math.round((present / total) * 10000) / 100 : null,
      };
    });
  }

  async getCaseMovement(
    actor: HomeDashboardActor,
    filters: NormalizedHomeDashboardFilters,
    startsOn: string,
    endsOn: string,
  ): Promise<HomeDashboardCaseMovementPoint[]> {
    const scope = this.buildCaseScopeQuery(actor, filters, 3);
    const whereSql = ['c.deleted_at IS NULL', scope.sql].filter(Boolean).join(' AND ');
    const result = await this.query<{
      key: string;
      opened: number | string;
      resolved: number | string;
    }>(
      `
        WITH case_events AS (
          SELECT date_trunc('week', c.created_at)::date AS event_week, 1 AS opened, 0 AS resolved
          FROM cases c
          LEFT JOIN schools sc ON sc.id = c.school_id
          WHERE ${whereSql}
            AND c.created_at::date BETWEEN $1::date AND $2::date
          UNION ALL
          SELECT date_trunc('week', c.updated_at)::date AS event_week, 0 AS opened, 1 AS resolved
          FROM cases c
          LEFT JOIN schools sc ON sc.id = c.school_id
          WHERE ${whereSql}
            AND c.status = 'RESOLVED'
            AND c.updated_at::date BETWEEN $1::date AND $2::date
        )
        SELECT event_week::text AS key,
               SUM(opened)::int AS opened,
               SUM(resolved)::int AS resolved
        FROM case_events
        GROUP BY event_week
        ORDER BY event_week ASC
      `,
      [startsOn, endsOn, ...scope.params],
    );
    return result.rows.map((row) => ({
      key: row.key,
      label: row.key,
      opened: toNumber(row.opened),
      resolved: toNumber(row.resolved),
    }));
  }

  async getAttentionItems(
    actor: HomeDashboardActor,
    filters: NormalizedHomeDashboardFilters,
    today: string,
  ): Promise<AttentionRow[]> {
    const studentScope = this.buildStudentScopeQuery(actor, filters, 2);
    const caseScope = this.buildCaseScopeQuery(actor, filters, 2 + studentScope.params.length);
    const studentWhere = studentScope.sql ? `AND ${studentScope.sql}` : '';
    const caseWhere = caseScope.sql ? `AND ${caseScope.sql}` : '';
    const result = await this.query<AttentionRow>(
      `
        WITH high_risk AS (
          SELECT COUNT(DISTINCT s.student_uuid)::int AS count
          FROM student_term s
          ${CURRENT_ENROLLMENT_JOIN}
          LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
          LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
          LEFT JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
          WHERE profile.risk_tier = 'HIGH'
            ${studentWhere}
        ),
        overdue_cases AS (
          SELECT
            COUNT(*)::int AS count,
            MIN(c.created_at)::date::text AS oldest
          FROM cases c
          LEFT JOIN schools sc ON sc.id = c.school_id
          WHERE c.deleted_at IS NULL
            AND c.status = 'IN_PROGRESS'
            AND c.created_at < ($1::date - INTERVAL '7 days')
            ${caseWhere}
        ),
        pending_review AS (
          SELECT
            COUNT(*)::int AS count,
            MIN(c.updated_at)::date::text AS oldest
          FROM cases c
          LEFT JOIN schools sc ON sc.id = c.school_id
          WHERE c.deleted_at IS NULL
            AND c.status = 'PENDING_REVIEW'
            ${caseWhere}
        )
        SELECT * FROM (
          SELECT
            'risk-high',
            'RISK_HIGH',
            'นักเรียนที่ต้องเฝ้าระวังสูง',
            'มีนักเรียนระดับ HIGH ในขอบเขตปัจจุบัน',
            count,
            NULL,
            '/student-risk-report',
            jsonb_build_object('riskTier', 'HIGH'),
            10
          FROM high_risk
          UNION ALL
          SELECT
            'case-overdue',
            'CASE_OVERDUE',
            'เคสกำลังติดตามค้างเกิน 7 วัน',
            'เคสสถานะกำลังติดตามที่ยังไม่ปิด',
            count,
            oldest,
            '/cases',
            jsonb_build_object('status', 'IN_PROGRESS'),
            20
          FROM overdue_cases
          UNION ALL
          SELECT
            'case-pending-review',
            'CASE_PENDING_REVIEW',
            'เคสรอตรวจผล',
            'มีเคสที่ส่งผลกลับมาแล้วและรอผู้มีสิทธิ์ตรวจ',
            count,
            oldest,
            '/cases',
            jsonb_build_object('status', 'PENDING_REVIEW'),
            30
          FROM pending_review
        ) items
        WHERE count > 0
        ORDER BY priority ASC
        LIMIT 8
      `,
      [today, ...studentScope.params, ...caseScope.params],
    );
    return result.rows;
  }

  async validateAreaFilters(
    actor: HomeDashboardActor,
    filters: HomeDashboardFilters,
  ): Promise<boolean> {
    const schoolFilters = {
      province: trimOrUndefined(filters.province),
      district: trimOrUndefined(filters.district),
      subDistrict: trimOrUndefined(filters.subDistrict),
      schoolId: filters.schoolId,
    };
    if (
      !schoolFilters.province &&
      !schoolFilters.district &&
      !schoolFilters.subDistrict &&
      !schoolFilters.schoolId
    ) {
      return true;
    }
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (actor.data_scope) {
      const scope = buildDataScopeQuery(
        actor.data_scope,
        {
          school_id: 'sc.id',
          province: 'sc.province',
          district: 'sc.district',
          sub_district: 'sc.sub_district',
        },
        1,
      );
      if (scope.sql) {
        conditions.push(`(${scope.sql})`);
        params.push(...scope.params);
      }
    }
    let index = params.length + 1;
    if (schoolFilters.province) {
      conditions.push(`sc.province = $${index++}`);
      params.push(schoolFilters.province);
    }
    if (schoolFilters.district) {
      conditions.push(`sc.district = $${index++}`);
      params.push(schoolFilters.district);
    }
    if (schoolFilters.subDistrict) {
      conditions.push(`sc.sub_district = $${index++}`);
      params.push(schoolFilters.subDistrict);
    }
    if (schoolFilters.schoolId) {
      conditions.push(`sc.id = $${index++}`);
      params.push(schoolFilters.schoolId);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.query<CountRow>(
      `SELECT COUNT(*)::int AS count FROM schools sc ${whereSql}`,
      params,
    );
    return toNumber(result.rows[0]?.count) > 0;
  }

  async getFilterOptions(
    actor: HomeDashboardActor,
    filters: HomeDashboardFilters,
  ): Promise<HomeDashboardFilterOptions['data']['options']> {
    const scope = this.buildStudentScopeQuery(actor, filters);
    const whereSql = scope.sql ? `WHERE ${scope.sql}` : '';
    const result = await this.query<{
      provinces: HomeDashboardOption[];
      districts: HomeDashboardOption[];
      sub_districts: HomeDashboardOption[];
      schools: HomeDashboardOption[];
      grades: HomeDashboardOption[];
      rooms: HomeDashboardOption[];
    }>(
      `
        WITH scoped AS (
          SELECT DISTINCT
            sc.province,
            sc.district,
            sc.sub_district,
            sc.id AS school_id,
            sc.name AS school_name,
            gl.label AS grade_label,
            s."RoomID_Onec"::text AS room
          FROM student_term s
          ${CURRENT_ENROLLMENT_JOIN}
          LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
          LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
          ${whereSql}
        )
        SELECT
          COALESCE(jsonb_agg(DISTINCT jsonb_build_object('value', province, 'label', province))
            FILTER (WHERE province IS NOT NULL), '[]'::jsonb) AS provinces,
          COALESCE(jsonb_agg(DISTINCT jsonb_build_object('value', district, 'label', district))
            FILTER (WHERE district IS NOT NULL), '[]'::jsonb) AS districts,
          COALESCE(jsonb_agg(DISTINCT jsonb_build_object('value', sub_district, 'label', sub_district))
            FILTER (WHERE sub_district IS NOT NULL), '[]'::jsonb) AS sub_districts,
          COALESCE(jsonb_agg(DISTINCT jsonb_build_object('value', school_id, 'label', school_name))
            FILTER (WHERE school_id IS NOT NULL), '[]'::jsonb) AS schools,
          COALESCE(jsonb_agg(DISTINCT jsonb_build_object('value', grade_label, 'label', grade_label))
            FILTER (WHERE grade_label IS NOT NULL), '[]'::jsonb) AS grades,
          COALESCE(jsonb_agg(DISTINCT jsonb_build_object('value', room, 'label', room))
            FILTER (WHERE room IS NOT NULL), '[]'::jsonb) AS rooms
        FROM scoped
      `,
      scope.params,
    );
    const row = result.rows[0] || {};
    return {
      provinces: row.provinces || [],
      districts: row.districts || [],
      subDistricts: row.sub_districts || [],
      schools: row.schools || [],
      grades: row.grades || [],
      rooms: row.rooms || [],
    };
  }

  async getCauseCategoryDistribution(
    actor: HomeDashboardActor,
    filters: HomeDashboardFilters,
  ): Promise<{ key: string; label: string; count: number }[]> {
    const scope = this.buildCaseScopeQuery(actor, filters);
    const whereSql = [
      'c.deleted_at IS NULL',
      't.deleted_at IS NULL',
      'tl.deleted_at IS NULL',
      'ts.deleted_at IS NULL',
      "t.task_type = 'VISIT'",
      scope.sql,
    ]
      .filter(Boolean)
      .join(' AND ');
    const result = await this.query<{
      category: string;
      category_label: string;
      count: number | string;
    }>(
      `
        SELECT
          COALESCE(ts.follow_up_problem_category_code, 'UNSPECIFIED') AS category,
          COALESCE(problem_category.label_th, 'ไม่ระบุสาเหตุ') AS category_label,
          COUNT(*)::int AS count
        FROM task_submissions ts
        JOIN task_links tl ON tl.id = ts.task_link_id
        JOIN tasks t ON t.id = tl.task_id
        JOIN cases c ON c.id = t.case_id
        LEFT JOIN follow_up_problem_categories problem_category
          ON problem_category.code = ts.follow_up_problem_category_code
        LEFT JOIN schools sc ON sc.id = c.school_id
        ${whereSql ? `WHERE ${whereSql}` : ''}
        GROUP BY
          COALESCE(ts.follow_up_problem_category_code, 'UNSPECIFIED'),
          COALESCE(problem_category.label_th, 'ไม่ระบุสาเหตุ')
        ORDER BY count DESC
      `,
      scope.params,
    );
    return result.rows.map((row) => ({
      key: row.category,
      label: row.category_label,
      count: toNumber(row.count),
    }));
  }

  async getMonthlySuccessRates(
    actor: HomeDashboardActor,
    filters: HomeDashboardFilters,
  ): Promise<{ month: string; opened: number; resolved: number }[]> {
    const scope = this.buildCaseScopeQuery(actor, filters);
    const result = await this.query<{
      month: string;
      opened: number | string;
      resolved: number | string;
    }>(
      `
        WITH months AS (
          SELECT date_trunc('month', d)::date AS month_date
          FROM generate_series(
            date_trunc('month', CURRENT_DATE - INTERVAL '11 months'),
            date_trunc('month', CURRENT_DATE),
            '1 month'::interval
          ) d
        ),
        opened_cases AS (
          SELECT
            date_trunc('month', c.created_at)::date AS month_date,
            COUNT(*)::int AS count
          FROM cases c
          LEFT JOIN schools sc ON sc.id = c.school_id
          WHERE c.deleted_at IS NULL
          ${scope.sql ? `AND ${scope.sql}` : ''}
          GROUP BY 1
        ),
        resolved_cases AS (
          SELECT
            date_trunc('month', c.updated_at)::date AS month_date,
            COUNT(*)::int AS count
          FROM cases c
          LEFT JOIN schools sc ON sc.id = c.school_id
          WHERE c.deleted_at IS NULL
            AND c.status = 'RESOLVED'
          ${scope.sql ? `AND ${scope.sql}` : ''}
          GROUP BY 1
        )
        SELECT
          to_char(m.month_date, 'YYYY-MM') AS month,
          COALESCE(o.count, 0)::int AS opened,
          COALESCE(r.count, 0)::int AS resolved
        FROM months m
        LEFT JOIN opened_cases o ON o.month_date = m.month_date
        LEFT JOIN resolved_cases r ON r.month_date = m.month_date
        ORDER BY m.month_date ASC
      `,
      scope.params,
    );
    return result.rows.map((row) => ({
      month: row.month,
      opened: toNumber(row.opened),
      resolved: toNumber(row.resolved),
    }));
  }

  async getSchoolName(schoolId: number): Promise<string | null> {
    const result = await this.query<{ name: string | null }>(
      `
        SELECT NULLIF(BTRIM(name), '') AS name
        FROM schools
        WHERE id = $1
        LIMIT 1
      `,
      [schoolId],
    );
    return result.rows[0]?.name ?? null;
  }
}
