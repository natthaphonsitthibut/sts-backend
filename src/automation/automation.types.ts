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

export type CaseRiskTier = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ActiveAbsenceCaseRow extends Record<string, unknown> {
  id: number;
  risk_tier: string | null;
}

export interface ActiveAttendanceRiskCaseRow extends ActiveAbsenceCaseRow {
  reason_flagged: string | null;
}

export interface EscalateCaseRiskTierInput {
  caseId: number;
  riskTier: CaseRiskTier;
  slaDueAt: Date;
  reason: string;
}

export interface CaseRiskTierEscalationAuditEvent {
  caseId: number;
  studentUuid: string | null;
  studentName: string | null;
  schoolId: number | null;
  fromTier: CaseRiskTier;
  toTier: CaseRiskTier;
  consecutiveDays: number;
  reason: string;
}

export interface ConsecutiveAbsentStudentRow extends Record<string, unknown> {
  student_uuid: string;
  consecutive_days: number;
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

export type SubjectRiskSignalCode =
  | 'MIXED_SUBJECT_ABSENCE'
  | 'SUBJECT_AVOIDANCE_STREAK'
  | 'SUBJECT_AVOIDANCE_PERCENT'
  | 'TERM_ABSENCE_ACCUMULATION'
  | 'LOW_ATTENDANCE_PERCENT';

export interface SubjectRiskCandidateRow extends Record<string, unknown> {
  signal_code: SubjectRiskSignalCode;
  student_uuid: string;
  metric_value: number | string;
  threshold_value: number | string;
  subject_id: number | string | null;
  subject_name_th: string | null;
  subject_code: string | null;
  first_name_onec: string | null;
  last_name_onec: string | null;
  school_id_onec: number | string | null;
  village_number_onec: string | null;
  street_onec: string | null;
  soi_onec: string | null;
  sub_district_name_thai_onec: string | null;
  district_name_thai_onec: string | null;
  province_name_thai_onec: string | null;
  grade_level_id_onec: number | string | null;
  room_id_onec: number | string | null;
  school_name: string | null;
}

export interface SubjectLateWatchRow extends Record<string, unknown> {
  student_uuid: string;
  late_count: number | string;
  threshold_value: number | string;
  first_name_onec: string | null;
  last_name_onec: string | null;
  school_id_onec: number | string | null;
  grade_level_id_onec: number | string | null;
  room_id_onec: number | string | null;
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
  slaDueAt: Date;
}

export interface NewCase {
  case_id: number;
  student_name: string;
  student_school: string;
  reason_flagged: string;
  school_id?: number | null;
}
