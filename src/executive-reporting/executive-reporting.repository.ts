import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { queryDataSource } from '../database/sql-query';
import type {
  ExecutiveReportingAggregateRow,
  ExecutiveReportingFilters,
  ExecutiveReportingGroup,
  ExecutiveReportingRepositoryInput,
} from './executive-reporting.types';

interface ExistsRow extends Record<string, unknown> {
  allowed: boolean;
}

interface GroupSql {
  province: string;
  district: string;
  schoolId: string;
  schoolName: string;
  groupBy: string;
  orderBy: string;
}

const GROUP_SQL: Record<ExecutiveReportingGroup, GroupSql> = {
  PROVINCE: {
    province: 'school_metrics.province',
    district: 'NULL::text',
    schoolId: 'NULL::integer',
    schoolName: 'NULL::text',
    groupBy: 'school_metrics.province',
    orderBy: 'province NULLS LAST',
  },
  DISTRICT: {
    province: 'school_metrics.province',
    district: 'school_metrics.district',
    schoolId: 'NULL::integer',
    schoolName: 'NULL::text',
    groupBy: 'school_metrics.province, school_metrics.district',
    orderBy: 'province NULLS LAST, district NULLS LAST',
  },
  SCHOOL: {
    province: 'school_metrics.province',
    district: 'school_metrics.district',
    schoolId: 'school_metrics.school_id',
    schoolName: 'school_metrics.school_name',
    groupBy:
      'school_metrics.province, school_metrics.district, school_metrics.school_id, school_metrics.school_name',
    orderBy: 'province NULLS LAST, district NULLS LAST, school_name, school_id',
  },
};

@Injectable()
export class ExecutiveReportingRepository {
  constructor(private readonly dataSource: DataSource) {}

  private buildSchoolConditions(
    scope: ExecutiveReportingRepositoryInput['scope'],
    filters: ExecutiveReportingFilters,
  ): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const conditions: string[] = [];
    const scopeQuery = buildDataScopeQuery(
      scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
      },
      1,
    );
    if (scopeQuery.sql) conditions.push(`(${scopeQuery.sql})`);
    params.push(...scopeQuery.params);

    if (filters.province) {
      params.push(filters.province);
      conditions.push(`school.province = $${params.length}`);
    }
    if (filters.district) {
      params.push(filters.district);
      conditions.push(`school.district = $${params.length}`);
    }
    if (typeof filters.schoolId === 'number') {
      params.push(filters.schoolId);
      conditions.push(`school.id = $${params.length}`);
    }

    return {
      sql: conditions.length > 0 ? conditions.join(' AND ') : 'TRUE',
      params,
    };
  }

  async isFilterWithinScope(input: ExecutiveReportingRepositoryInput): Promise<boolean> {
    const conditions = this.buildSchoolConditions(input.scope, input);
    const result = await queryDataSource<ExistsRow>(
      this.dataSource,
      `SELECT EXISTS (
         SELECT 1 FROM schools school WHERE ${conditions.sql}
       ) AS allowed`,
      conditions.params,
    );
    return result.rows[0]?.allowed === true;
  }

  async getOverview(
    input: ExecutiveReportingRepositoryInput,
  ): Promise<ExecutiveReportingAggregateRow[]> {
    const conditions = this.buildSchoolConditions(input.scope, input);
    const params = [...conditions.params];
    const fromIndex = input.from ? params.push(input.from) : null;
    const toIndex = input.to ? params.push(input.to) : null;
    const periodCondition = (column: string): string => {
      const parts: string[] = [];
      if (fromIndex) parts.push(`${column} >= $${fromIndex}::timestamptz`);
      if (toIndex) parts.push(`${column} <= $${toIndex}::timestamptz`);
      return parts.length > 0 ? parts.join(' AND ') : 'TRUE';
    };
    const group = GROUP_SQL[input.groupBy];

    const result = await queryDataSource<ExecutiveReportingAggregateRow>(
      this.dataSource,
      `
        WITH scoped_schools AS (
          SELECT school.id, school.name, school.province, school.district
          FROM schools school
          WHERE ${conditions.sql}
        ),
        active_students AS (
          SELECT
            student.student_uuid,
            student."SchoolID_Onec" AS school_id,
            student."AcademicYear_Onec" AS academic_year,
            student."Semester_Onec" AS semester,
            profile.risk_tier,
            profile.profile_calculated_at
          FROM student_term student
          JOIN student_current_enrollment_resolution current_enrollment
            ON current_enrollment.person_uuid = student.person_uuid
           AND current_enrollment.selected_student_uuid = student.student_uuid
           AND current_enrollment.resolution_state = 'ACTIVE'
          JOIN scoped_schools school ON school.id = student."SchoolID_Onec"
          LEFT JOIN student_risk_profiles profile ON profile.student_uuid = student.student_uuid
          WHERE student.deleted_at IS NULL
        ),
        enrollment_metrics AS (
          SELECT
            school_id,
            COUNT(*)::int AS active_student_count,
            COUNT(*) FILTER (WHERE risk_tier = 'HIGH')::int AS risk_high_count,
            COUNT(*) FILTER (WHERE risk_tier = 'MEDIUM')::int AS risk_medium_count,
            COUNT(*) FILTER (WHERE risk_tier = 'LOW')::int AS risk_low_count,
            COUNT(*) FILTER (WHERE risk_tier = 'WATCH')::int AS risk_watch_count,
            COUNT(*) FILTER (WHERE risk_tier = 'NORMAL')::int AS risk_normal_count,
            COUNT(*) FILTER (WHERE risk_tier IS NULL)::int AS risk_missing_profile_count,
            MAX(academic_year)::int AS enrollment_academic_year,
            MAX(semester)::int AS enrollment_semester,
            MAX(profile_calculated_at) AS risk_profile_calculated_at
          FROM active_students
          GROUP BY school_id
        ),
        latest_human_observation AS (
          SELECT DISTINCT ON (observation.student_uuid)
            observation.student_uuid,
            observation.school_id,
            observation.concern_level,
            observation.observed_at
          FROM student_observations observation
          JOIN active_students student ON student.student_uuid = observation.student_uuid
          WHERE observation.deleted_at IS NULL
            AND ${periodCondition('observation.observed_at')}
          ORDER BY observation.student_uuid, observation.observed_at DESC, observation.id DESC
        ),
        human_observation_metrics AS (
          SELECT
            school_id,
            COUNT(*) FILTER (WHERE concern_level = 'CONCERN')::int AS human_concern_student_count,
            MAX(observed_at) AS human_observation_at
          FROM latest_human_observation
          GROUP BY school_id
        ),
        case_metrics AS (
          SELECT
            case_record.school_id,
            COUNT(*) FILTER (WHERE ${periodCondition('case_record.created_at')})::int
              AS case_created_count,
            COUNT(*) FILTER (WHERE case_record.status <> 'RESOLVED')::int
              AS unresolved_case_count,
            COUNT(*) FILTER (
              WHERE case_record.status = 'RESOLVED'
                AND ${periodCondition('case_record.updated_at')}
            )::int AS resolved_case_count,
            COUNT(*) FILTER (
              WHERE case_record.status = 'REPORTED_UP'
            )::int AS reported_up_case_count,
            MAX(case_record.updated_at) AS case_updated_at
          FROM cases case_record
          JOIN scoped_schools school ON school.id = case_record.school_id
          WHERE case_record.deleted_at IS NULL
          GROUP BY case_record.school_id
        ),
        school_metrics AS (
          SELECT
            school.id AS school_id,
            school.name AS school_name,
            school.province,
            school.district,
            COALESCE(enrollment.active_student_count, 0)::int AS active_student_count,
            COALESCE(enrollment.risk_high_count, 0)::int AS risk_high_count,
            COALESCE(enrollment.risk_medium_count, 0)::int AS risk_medium_count,
            COALESCE(enrollment.risk_low_count, 0)::int AS risk_low_count,
            COALESCE(enrollment.risk_watch_count, 0)::int AS risk_watch_count,
            COALESCE(enrollment.risk_normal_count, 0)::int AS risk_normal_count,
            COALESCE(enrollment.risk_missing_profile_count, 0)::int AS risk_missing_profile_count,
            COALESCE(human.human_concern_student_count, 0)::int AS human_concern_student_count,
            COALESCE(case_data.case_created_count, 0)::int AS case_created_count,
            COALESCE(case_data.unresolved_case_count, 0)::int AS unresolved_case_count,
            COALESCE(case_data.resolved_case_count, 0)::int AS resolved_case_count,
            COALESCE(case_data.reported_up_case_count, 0)::int AS reported_up_case_count,
            enrollment.enrollment_academic_year,
            enrollment.enrollment_semester,
            enrollment.risk_profile_calculated_at,
            human.human_observation_at,
            case_data.case_updated_at
          FROM scoped_schools school
          LEFT JOIN enrollment_metrics enrollment ON enrollment.school_id = school.id
          LEFT JOIN human_observation_metrics human ON human.school_id = school.id
          LEFT JOIN case_metrics case_data ON case_data.school_id = school.id
        )
        SELECT
          ${group.province} AS province,
          ${group.district} AS district,
          ${group.schoolId} AS school_id,
          ${group.schoolName} AS school_name,
          SUM(active_student_count)::int AS active_student_count,
          SUM(risk_high_count)::int AS risk_high_count,
          SUM(risk_medium_count)::int AS risk_medium_count,
          SUM(risk_low_count)::int AS risk_low_count,
          SUM(risk_watch_count)::int AS risk_watch_count,
          SUM(risk_normal_count)::int AS risk_normal_count,
          SUM(risk_missing_profile_count)::int AS risk_missing_profile_count,
          SUM(human_concern_student_count)::int AS human_concern_student_count,
          SUM(case_created_count)::int AS case_created_count,
          SUM(unresolved_case_count)::int AS unresolved_case_count,
          SUM(resolved_case_count)::int AS resolved_case_count,
          SUM(reported_up_case_count)::int AS reported_up_case_count,
          MAX(enrollment_academic_year)::int AS enrollment_academic_year,
          MAX(enrollment_semester)::int AS enrollment_semester,
          MAX(risk_profile_calculated_at) AS risk_profile_calculated_at,
          MAX(human_observation_at) AS human_observation_at,
          MAX(case_updated_at) AS case_updated_at
        FROM school_metrics
        GROUP BY ${group.groupBy}
        ORDER BY ${group.orderBy}
      `,
      params,
    );
    return result.rows;
  }
}
