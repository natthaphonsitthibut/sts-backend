import type { SqlQueryResult } from '../database/sql-query';

export const STUDENT_ENROLLMENT_STATES = ['current-active', 'all'] as const;
export type StudentEnrollmentState = (typeof STUDENT_ENROLLMENT_STATES)[number];

/** `AT_RISK` = every tier except NORMAL; mirrors `student_risk_profiles.risk_tier`. */
export const STUDENT_RISK_TIER_FILTERS = ['AT_RISK', 'HIGH', 'WATCH', 'NORMAL'] as const;
export type StudentRiskTierFilter = (typeof STUDENT_RISK_TIER_FILTERS)[number];

export interface StudentListFilters {
  grade?: string;
  room?: number;
  schoolId?: number;
  province?: string;
  district?: string;
  subDistrict?: string;
  searchTerm?: string;
  studentStatusCode?: number;
  enrollmentState?: StudentEnrollmentState;
  riskTier?: StudentRiskTierFilter;
  page?: number;
  limit?: number;
}

export interface StudentListResult {
  rows: StudentListRow[];
  totalCount: number;
}

export interface StudentFilterOptions {
  grades: string[];
  rooms: string[];
}

export interface StudentListRow extends Record<string, unknown> {
  id: string;
  photo_storage_key?: string | null;
  photo_updated_at?: string | Date | null;
  name: string;
  grade: string;
  room: string;
  school_name: string | null;
  school_id: number | null;
  student_status_label: string;
  student_status_category: string;
  student_status_badge_variant: string;
}

export interface StudentDetailRow extends Record<string, unknown> {
  PersonID_Onec: string;
  photo_storage_key?: string | null;
  photo_updated_at?: string | Date | null;
  student_uuid?: string | null;
  grade?: string | null;
  room?: string | null;
  school_name?: string | null;
  risk_tier?: 'HIGH' | 'WATCH' | 'NORMAL';
  homeroom_teacher_name?: string | null;
  student_status_label?: string | null;
  student_status_category?: string | null;
  student_status_badge_variant?: string | null;
}

/** Live guardian contact row (student_guardian), wire-ready. */
export interface StudentGuardianRow extends Record<string, unknown> {
  id: string;
  relation: 'FATHER' | 'MOTHER' | 'GUARDIAN';
  relation_note: string | null;
  full_name: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  line_id: string | null;
  is_primary: boolean;
}

/** Canonical person-level contact channels; independent of login accounts. */
export interface StudentPersonContactRow extends Record<string, unknown> {
  phone: string | null;
  email: string | null;
  line_id: string | null;
}

export interface StudentCaseRow extends Record<string, unknown> {
  id: string | number;
  created_at: string;
  reason_flagged: string | null;
  status: string;
}

export interface StudentAttendanceRow extends Record<string, unknown> {
  date: string;
  status: string | number;
  period: string | number | null;
}

export interface StudentProfileSummaryRow extends Record<string, unknown> {
  academic_year: number;
  semester: number;
  starts_on: string | null;
  ends_on: string | null;
  term_gpa: string | number | null;
  cumulative_gpax: string | number | null;
  present_count: string | number;
  absent_count: string | number;
  late_count: string | number;
  leave_count: string | number;
  total_count: string | number;
}

export interface StudentCareConsiderationRow extends Record<string, unknown> {
  care_kind: 'DISADVANTAGE' | 'DISABILITY';
  code: string;
  label_th: string;
  recorded_at: string;
}

export interface StudentAttendanceCalendarRow extends Record<string, unknown> {
  attendance_category: 'ALL_PERIODS' | 'SOME_PERIODS' | 'NO_PERIODS';
  attendance_category_label: string;
  date: string;
  status_code: number;
  status_internal_code: string;
  status_label: string;
  status_badge_variant: string;
}

export interface StudentSubjectAttendanceRow extends Record<string, unknown> {
  date: string;
  period: number;
  status_code: number;
  status_internal_code: string;
  status_label: string;
  status_badge_variant: string;
  subject_code: string | null;
  subject_name: string | null;
  recorded_at: string | Date | null;
  recorded_by: string | null;
}

export type StudentsQueryResult<T extends Record<string, unknown>> = SqlQueryResult<T>;

/** One row to append to the immutable `pii_access_events` log. */
export interface PiiAccessEventInput {
  actorUserId: number | null;
  actorRoles: string[];
  actorKind: 'STAFF' | 'GUEST';
  subjectStudentRef: string;
  subjectType: 'STUDENT' | 'USER';
  subjectRef: string;
  subjectRefKeyVersion: number;
  fieldGroup: string;
  reasonCode: string;
  reasonNote: string | null;
  purposeLinkId: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}
