import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import {
  EXECUTIVE_REPORTING_GROUPS,
  type ExecutiveReportingGroup,
} from '../executive-reporting.types';

function trimOptionalText({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ExecutiveReportingOverviewQueryDto {
  @IsOptional()
  @IsIn(EXECUTIVE_REPORTING_GROUPS)
  groupBy?: ExecutiveReportingGroup;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(120)
  province?: string;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schoolId?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class SuppressedCountDto {
  value!: number | null;
  suppressed!: boolean;
}

export class ExecutiveRiskMetricsDto {
  high!: SuppressedCountDto;
  medium!: SuppressedCountDto;
  low!: SuppressedCountDto;
  watch!: SuppressedCountDto;
  normal!: SuppressedCountDto;
  missingProfile!: SuppressedCountDto;
  humanConcernStudentsInPeriod!: SuppressedCountDto;
}

export class ExecutiveCaseMetricsDto {
  createdInPeriod!: SuppressedCountDto;
  unresolved!: SuppressedCountDto;
  resolvedInPeriod!: SuppressedCountDto;
  reportedUp!: SuppressedCountDto;
}

export class ExecutiveDataFreshnessDto {
  enrollmentAcademicYear!: number | null;
  enrollmentSemester!: number | null;
  riskProfileCalculatedAt!: string | null;
  humanObservationAt!: string | null;
  caseUpdatedAt!: string | null;
}

export class ExecutiveReportingAreaDto {
  level!: ExecutiveReportingGroup;
  province!: string | null;
  district!: string | null;
  schoolId!: number | null;
  schoolName!: string | null;
  activeStudents!: SuppressedCountDto;
  risk!: ExecutiveRiskMetricsDto;
  cases!: ExecutiveCaseMetricsDto;
  freshness!: ExecutiveDataFreshnessDto;
}

export class ExecutiveReportingSummaryDto {
  activeStudents!: SuppressedCountDto;
  risk!: ExecutiveRiskMetricsDto;
  cases!: ExecutiveCaseMetricsDto;
  freshness!: ExecutiveDataFreshnessDto;
}

export class ExecutiveReportingOverviewDto {
  groupBy!: ExecutiveReportingGroup;
  period!: { from: string | null; to: string | null };
  suppression!: { minimumCellSize: number; rule: 'NON_ZERO_BELOW_MINIMUM' };
  summary!: ExecutiveReportingSummaryDto;
  areas!: ExecutiveReportingAreaDto[];
}
