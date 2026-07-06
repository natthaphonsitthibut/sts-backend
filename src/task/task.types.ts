import type { ActorContext, DataScope, RequestWithActor } from '../auth';

export type { ActorContext, DataScope, RequestWithActor };

export type NormalizedDataScope = Required<Omit<DataScope, 'own_only'>> &
  Pick<DataScope, 'own_only'>;

export interface RoleDefinition {
  id: number;
  name: string;
  label: string;
  rank: number;
  default_permissions: string[];
  scope_mode: string;
  scope_policy: 'ASSIGNABLE' | 'OWN_ONLY';
  is_assignable: boolean;
  is_system: boolean;
}

export interface QueryResultRow {
  [key: string]: unknown;
}

export interface QueryResultLike<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
  rowCount?: number | null;
}

export interface QueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>>;
}

export type RiskDashboardTier = 'HIGH' | 'MEDIUM' | 'LOW' | 'WATCH' | 'NORMAL';
export type RiskDashboardSortBy =
  | 'risk'
  | 'name'
  | 'school'
  | 'grade'
  | 'room'
  | 'attendance'
  | 'openCases';
export type RiskDashboardSortDirection = 'asc' | 'desc';

export interface RiskDashboardFilters {
  riskTier?: RiskDashboardTier;
  searchTerm?: string;
  province?: string;
  district?: string;
  subDistrict?: string;
  schoolId?: number;
  grade?: string;
  room?: string;
  page?: number;
  limit?: number;
  sortBy?: RiskDashboardSortBy;
  sortDirection?: RiskDashboardSortDirection;
}

export interface RiskDashboardThresholds {
  lowConsecutiveAbsentDays: number;
  mediumConsecutiveAbsentDays: number;
  highConsecutiveAbsentDays: number;
  watchProgressRatio: number;
  lowAttendancePercent: number;
  mediumAttendancePercent: number;
  highAttendancePercent: number;
  lateWeight: number;
}

export interface RiskDashboardSummary {
  HIGH: number;
  MEDIUM: number;
  LOW: number;
  WATCH: number;
  NORMAL: number;
}

export interface RiskDashboardRow extends QueryResultRow {
  student_uuid: string;
  student_name: string;
  school_id: number | null;
  school_name: string | null;
  grade: string | null;
  room: string | null;
  consecutive_absent_days: number | string;
  absent_days: number | string;
  late_count: number | string;
  school_day_count: number | string;
  weighted_absence_days: number | string;
  weighted_attendance_percent: number | string | null;
  risk_tier: RiskDashboardTier;
  risk_score: number | string;
  open_case_count: number | string;
  latest_open_case_id: number | string | null;
  latest_open_case_reason: string | null;
  latest_open_task_id: string | null;
  latest_case_at: string | null;
}

export interface RiskDashboardResult {
  rows: RiskDashboardRow[];
  totalCount: number;
  summary: RiskDashboardSummary;
}

export function getTaskErrorMessage(error: unknown, fallback = 'เกิดข้อผิดพลาด'): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return fallback;
}

export function hasHttpStatusGetter(error: unknown): error is { getStatus: () => number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'getStatus' in error &&
    typeof error.getStatus === 'function'
  );
}

export function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }

  return undefined;
}
