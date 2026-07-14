export const REPORT_UP_SOURCE_STATUSES = ['IN_PROGRESS', 'PENDING_REVIEW'] as const;

export type ReportUpSourceStatus = (typeof REPORT_UP_SOURCE_STATUSES)[number];

export interface CaseReportUpRow extends Record<string, unknown> {
  id: string;
  case_id: number;
  case_status: string;
  school_id: number | null;
  school_name: string | null;
  student_name: string | null;
  reported_by: number | null;
  reported_by_label: string | null;
  report_reason: string | null;
  report_summary: string | null;
  province_snapshot: string | null;
  district_snapshot: string | null;
  sub_district_snapshot: string | null;
  reported_at: Date | string;
  total_count?: number | string;
}

export interface SchoolOwnedCaseRow extends Record<string, unknown> {
  id: number;
  status: string;
  school_id: number;
  school_name: string | null;
  province: string | null;
  district: string | null;
  sub_district: string | null;
  student_name: string | null;
}
