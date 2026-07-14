import type { DataScope } from '../auth';

export const EXECUTIVE_REPORTING_GROUPS = ['PROVINCE', 'DISTRICT', 'SCHOOL'] as const;

export type ExecutiveReportingGroup = (typeof EXECUTIVE_REPORTING_GROUPS)[number];

export interface ExecutiveReportingFilters {
  groupBy: ExecutiveReportingGroup;
  province?: string;
  district?: string;
  schoolId?: number;
  from?: string;
  to?: string;
}

export interface ExecutiveReportingRepositoryInput extends ExecutiveReportingFilters {
  scope: DataScope;
}

export interface ExecutiveReportingAggregateRow extends Record<string, unknown> {
  province: string | null;
  district: string | null;
  school_id: number | string | null;
  school_name: string | null;
  active_student_count: number | string;
  risk_high_count: number | string;
  risk_medium_count: number | string;
  risk_low_count: number | string;
  risk_watch_count: number | string;
  risk_normal_count: number | string;
  risk_missing_profile_count: number | string;
  human_concern_student_count: number | string;
  case_created_count: number | string;
  unresolved_case_count: number | string;
  resolved_case_count: number | string;
  reported_up_case_count: number | string;
  enrollment_academic_year: number | string | null;
  enrollment_semester: number | string | null;
  risk_profile_calculated_at: Date | string | null;
  human_observation_at: Date | string | null;
  case_updated_at: Date | string | null;
}

export interface ExecutiveReportingPolicy {
  minimumCellSize: number;
}

export interface ResolveExecutiveReportingPolicyInput {
  minimumCellSize?: number | null;
  environment: 'development' | 'test' | 'production';
}
