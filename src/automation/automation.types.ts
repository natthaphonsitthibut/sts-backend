export interface QueryResultLike<T extends Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface QueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>>;
}

export interface SettingValueRow extends Record<string, unknown> {
  setting_value: string;
}

export interface OpenAbsenceCaseRow extends Record<string, unknown> {
  id: number;
  student_name: string | null;
  student_uuid: string | null;
  school_id: number | string | null;
}

export interface CaseAutoCancelAuditEvent {
  caseId: number;
  studentUuid: string | null;
}

/**
 * Cases are opened by one rule now (cumulative absence), so every automated
 * case is เสี่ยง; tiers below it no longer open or escalate a case.
 */
export type CaseRiskTier = 'HIGH';

export interface ActiveAbsenceCaseRow extends Record<string, unknown> {
  id: number;
  risk_tier: string | null;
}

export interface CumulativeAbsentStudentRow extends Record<string, unknown> {
  student_uuid: string;
  absent_days_since_case_reset: number;
  first_name_onec: string | null;
  last_name_onec: string | null;
  school_id_onec: number | null;
  village_number_onec: string | null;
  street_onec: string | null;
  soi_onec: string | null;
  sub_district_name_thai_onec: string | null;
  district_name_thai_onec: string | null;
  province_name_thai_onec: string | null;
  school_name: string | null;
}

export interface CreatedCaseRow extends Record<string, unknown> {
  id: number;
}

export interface CreateAutomatedCaseInput {
  studentName: string;
  studentUuid: string | null;
  schoolId: number | null;
  schoolName: string;
  studentAddress: string | null;
  reason: string;
  riskTier: CaseRiskTier;
}

export interface NewCase {
  case_id: number;
  student_name: string;
  student_school: string;
  reason_flagged: string;
  school_id?: number | null;
}
