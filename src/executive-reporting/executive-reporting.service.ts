import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  isUnconfiguredDataScope,
  normalizeDataScope,
  type AuthenticatedRequestUser,
} from '../auth';
import type {
  ExecutiveCaseMetricsDto,
  ExecutiveDataFreshnessDto,
  ExecutiveReportingAreaDto,
  ExecutiveReportingOverviewDto,
  ExecutiveReportingOverviewQueryDto,
  ExecutiveReportingSummaryDto,
  ExecutiveRiskMetricsDto,
  SuppressedCountDto,
} from './dto/executive-reporting.dto';
import { EXECUTIVE_REPORTING_POLICY } from './executive-reporting.policy';
import { ExecutiveReportingRepository } from './executive-reporting.repository';
import type {
  ExecutiveReportingAggregateRow,
  ExecutiveReportingFilters,
  ExecutiveReportingPolicy,
} from './executive-reporting.types';

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

@Injectable()
export class ExecutiveReportingService {
  constructor(
    private readonly repository: ExecutiveReportingRepository,
    @Inject(EXECUTIVE_REPORTING_POLICY)
    private readonly policy: ExecutiveReportingPolicy,
  ) {}

  async getOverview(
    actor: AuthenticatedRequestUser,
    query: ExecutiveReportingOverviewQueryDto,
  ): Promise<ExecutiveReportingOverviewDto> {
    const scope = normalizeDataScope(actor.data_scope);
    if (
      !scope ||
      isUnconfiguredDataScope(scope) ||
      scope.own_only === true ||
      (scope.grade_levels?.length ?? 0) > 0 ||
      (scope.room_ids?.length ?? 0) > 0
    ) {
      throw new ForbiddenException('Executive aggregate reporting requires an area scope');
    }

    const filters = this.normalizeFilters(query);
    const allowed = await this.repository.isFilterWithinScope({ scope, ...filters });
    if (!allowed) {
      throw new ForbiddenException('Requested area is outside the authenticated scope');
    }

    const rows = await this.repository.getOverview({ scope, ...filters });
    return {
      groupBy: filters.groupBy,
      period: { from: filters.from ?? null, to: filters.to ?? null },
      suppression: {
        minimumCellSize: this.policy.minimumCellSize,
        rule: 'NON_ZERO_BELOW_MINIMUM',
      },
      summary: this.mapSummary(rows),
      areas: rows.map((row) => this.mapArea(row, filters.groupBy)),
    };
  }

  private normalizeFilters(query: ExecutiveReportingOverviewQueryDto): ExecutiveReportingFilters {
    const groupBy = query.groupBy ?? 'PROVINCE';
    if (query.district && !query.province && !query.schoolId) {
      throw new BadRequestException('province is required when district is supplied');
    }
    if (groupBy === 'DISTRICT' && !query.province && !query.schoolId) {
      throw new BadRequestException('province is required when grouping by district');
    }
    if (groupBy === 'SCHOOL' && !query.province && !query.schoolId) {
      throw new BadRequestException('province or schoolId is required when grouping by school');
    }
    if (query.from && query.to && new Date(query.from).getTime() > new Date(query.to).getTime()) {
      throw new BadRequestException('from must not be later than to');
    }
    return {
      groupBy,
      province: query.province,
      district: query.district,
      schoolId: query.schoolId,
      from: query.from,
      to: query.to,
    };
  }

  private suppress(count: unknown): SuppressedCountDto {
    const value = Math.max(0, Math.trunc(toNumber(count)));
    const suppressed = value > 0 && value < this.policy.minimumCellSize;
    return { value: suppressed ? null : value, suppressed };
  }

  private mapRisk(row: ExecutiveReportingAggregateRow): ExecutiveRiskMetricsDto {
    return {
      high: this.suppress(row.risk_high_count),
      medium: this.suppress(row.risk_medium_count),
      low: this.suppress(row.risk_low_count),
      watch: this.suppress(row.risk_watch_count),
      normal: this.suppress(row.risk_normal_count),
      missingProfile: this.suppress(row.risk_missing_profile_count),
      humanConcernStudentsInPeriod: this.suppress(row.human_concern_student_count),
    };
  }

  private mapCases(row: ExecutiveReportingAggregateRow): ExecutiveCaseMetricsDto {
    return {
      createdInPeriod: this.suppress(row.case_created_count),
      unresolved: this.suppress(row.unresolved_case_count),
      resolvedInPeriod: this.suppress(row.resolved_case_count),
      reportedUp: this.suppress(row.reported_up_case_count),
    };
  }

  private mapFreshness(row: ExecutiveReportingAggregateRow): ExecutiveDataFreshnessDto {
    return {
      enrollmentAcademicYear: toNullableNumber(row.enrollment_academic_year),
      enrollmentSemester: toNullableNumber(row.enrollment_semester),
      riskProfileCalculatedAt: toIsoString(row.risk_profile_calculated_at),
      humanObservationAt: toIsoString(row.human_observation_at),
      caseUpdatedAt: toIsoString(row.case_updated_at),
    };
  }

  private mapArea(
    row: ExecutiveReportingAggregateRow,
    level: ExecutiveReportingFilters['groupBy'],
  ): ExecutiveReportingAreaDto {
    return {
      level,
      province: row.province,
      district: row.district,
      schoolId: toNullableNumber(row.school_id),
      schoolName: row.school_name,
      activeStudents: this.suppress(row.active_student_count),
      risk: this.mapRisk(row),
      cases: this.mapCases(row),
      freshness: this.mapFreshness(row),
    };
  }

  private mapSummary(rows: ExecutiveReportingAggregateRow[]): ExecutiveReportingSummaryDto {
    const total = rows.reduce<ExecutiveReportingAggregateRow>(
      (aggregate, row) => ({
        ...aggregate,
        active_student_count:
          toNumber(aggregate.active_student_count) + toNumber(row.active_student_count),
        risk_high_count: toNumber(aggregate.risk_high_count) + toNumber(row.risk_high_count),
        risk_medium_count: toNumber(aggregate.risk_medium_count) + toNumber(row.risk_medium_count),
        risk_low_count: toNumber(aggregate.risk_low_count) + toNumber(row.risk_low_count),
        risk_watch_count: toNumber(aggregate.risk_watch_count) + toNumber(row.risk_watch_count),
        risk_normal_count: toNumber(aggregate.risk_normal_count) + toNumber(row.risk_normal_count),
        risk_missing_profile_count:
          toNumber(aggregate.risk_missing_profile_count) + toNumber(row.risk_missing_profile_count),
        human_concern_student_count:
          toNumber(aggregate.human_concern_student_count) +
          toNumber(row.human_concern_student_count),
        case_created_count:
          toNumber(aggregate.case_created_count) + toNumber(row.case_created_count),
        unresolved_case_count:
          toNumber(aggregate.unresolved_case_count) + toNumber(row.unresolved_case_count),
        resolved_case_count:
          toNumber(aggregate.resolved_case_count) + toNumber(row.resolved_case_count),
        reported_up_case_count:
          toNumber(aggregate.reported_up_case_count) + toNumber(row.reported_up_case_count),
        enrollment_academic_year: this.maxNumber(
          aggregate.enrollment_academic_year,
          row.enrollment_academic_year,
        ),
        enrollment_semester: this.maxNumber(aggregate.enrollment_semester, row.enrollment_semester),
        risk_profile_calculated_at: this.maxDate(
          aggregate.risk_profile_calculated_at,
          row.risk_profile_calculated_at,
        ),
        human_observation_at: this.maxDate(
          aggregate.human_observation_at,
          row.human_observation_at,
        ),
        case_updated_at: this.maxDate(aggregate.case_updated_at, row.case_updated_at),
      }),
      {
        province: null,
        district: null,
        school_id: null,
        school_name: null,
        active_student_count: 0,
        risk_high_count: 0,
        risk_medium_count: 0,
        risk_low_count: 0,
        risk_watch_count: 0,
        risk_normal_count: 0,
        risk_missing_profile_count: 0,
        human_concern_student_count: 0,
        case_created_count: 0,
        unresolved_case_count: 0,
        resolved_case_count: 0,
        reported_up_case_count: 0,
        enrollment_academic_year: null,
        enrollment_semester: null,
        risk_profile_calculated_at: null,
        human_observation_at: null,
        case_updated_at: null,
      },
    );
    return {
      activeStudents: this.suppress(total.active_student_count),
      risk: this.mapRisk(total),
      cases: this.mapCases(total),
      freshness: this.mapFreshness(total),
    };
  }

  private maxNumber(left: unknown, right: unknown): number | null {
    const values = [toNullableNumber(left), toNullableNumber(right)].filter(
      (value): value is number => value !== null,
    );
    return values.length > 0 ? Math.max(...values) : null;
  }

  private maxDate(left: unknown, right: unknown): string | null {
    const values = [toIsoString(left), toIsoString(right)].filter(
      (value): value is string => value !== null,
    );
    return values.length > 0 ? values.sort().at(-1)! : null;
  }
}
