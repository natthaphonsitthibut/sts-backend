export const HUMAN_RISK_DECISIONS = ['CONFIRM_RISK', 'WATCH', 'NO_ACTION'] as const;
export type HumanRiskDecision = (typeof HUMAN_RISK_DECISIONS)[number];

export const FOLLOW_UP_URGENCIES = ['NORMAL', 'URGENT'] as const;
export type FollowUpUrgency = (typeof FOLLOW_UP_URGENCIES)[number];

export const FOLLOW_UP_REVIEW_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type FollowUpReviewDecision = (typeof FOLLOW_UP_REVIEW_DECISIONS)[number];

export interface ObservationSourceRef {
  observationId: number;
  revision: number;
}

export interface ObservationReviewEnrollmentRow extends Record<string, unknown> {
  student_uuid: string;
  school_id: number;
  school_term_id: string;
  classroom_id: string | null;
}

export interface ObservationReviewAssignmentRow extends Record<string, unknown> {
  assignment_id: number | string;
  teacher_membership_id: number | string;
  teacher_user_id: number;
  school_id: number;
  school_term_id: number | string;
  classroom_id: number | string;
}

export interface ValidatedObservationSourceRow extends Record<string, unknown> {
  observation_id: number | string;
  observation_revision: number | string;
  concern_level: 'NOTE' | 'WATCH' | 'CONCERN';
}

export interface RiskReviewRow extends Record<string, unknown> {
  id: string;
  student_uuid: string;
  school_id: number;
  calculated_attendance_risk: string;
  teacher_concern_signal: 'NONE' | 'WATCH' | 'CONCERN';
  human_risk_decision: HumanRiskDecision;
  decision_reason: string;
  decided_by: number;
  decided_by_username: string;
  decided_at: Date | string;
  revision_number: number | string;
  sources: ObservationSourceRef[] | string;
}

export interface FollowUpRequestRow extends Record<string, unknown> {
  id: string;
  student_uuid: string;
  school_id: number;
  follow_up_request_type: 'HOME_VISIT_CONSIDERATION';
  status: 'PENDING_REVIEW' | FollowUpReviewDecision | 'NEED_MORE_INFO';
  status_label_th: string;
  status_badge_variant: string;
  urgency: FollowUpUrgency;
  request_reason: string;
  supplemental_note: string | null;
  requested_by: number;
  requested_by_username: string;
  requester_teacher_membership_id: number | string;
  source_assignment_id: number | string;
  review_decision: FollowUpReviewDecision | null;
  review_reason: string | null;
  reviewed_by: number | null;
  reviewed_by_username: string | null;
  reviewed_at: Date | string | null;
  assigned_task_id: string | null;
  assigned_by: number | null;
  assigned_by_username: string | null;
  assigned_at: Date | string | null;
  opened_case_id: number | null;
  opened_case_status: string | null;
  student_first_name: string | null;
  student_last_name: string | null;
  student_name: string;
  student_school: string | null;
  student_address: string | null;
  address_line: string | null;
  address_province: string | null;
  address_district: string | null;
  address_sub_district: string | null;
  postal_code: string | null;
  student_lat: number | null;
  student_lng: number | null;
  grade_label: string | null;
  room_no: number | null;
  revision_number: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  sources: ObservationSourceRef[] | string;
  total_count?: number | string;
}

export interface TeacherObservationReportRow extends Record<string, unknown> {
  report_kind: 'FOLLOW_UP_REQUEST' | 'OBSERVATION';
  report_id: string;
  observation_id: string;
  observation_revision: number | string;
  student_uuid: string;
  student_name: string;
  school_id: number;
  school_name: string;
  grade_level_id: number | null;
  grade_label: string | null;
  classroom_id: string | null;
  room_no: number | null;
  author_display_name: string;
  dimension_label: string;
  concern_level: 'NOTE' | 'WATCH' | 'CONCERN';
  comment: string | null;
  observed_at: Date | string;
  follow_up_request_id: string | null;
  follow_up_status: 'PENDING_REVIEW' | FollowUpReviewDecision | 'NEED_MORE_INFO' | null;
  urgency: FollowUpUrgency | null;
  opened_case_id: number | null;
  opened_case_status: string | null;
  total_count?: number | string;
}

export interface TeacherWatchlistRow extends Record<string, unknown> {
  student_uuid: string;
  student_name: string;
  school_id: number | string;
  school_name: string;
  grade_label: string | null;
  room_no: number | string | null;
  latest_comment_id: string;
  latest_comment: string;
  latest_author_display_name: string;
  latest_commented_at: Date | string;
  comment_count: number | string;
  total_count?: number | string;
}

export interface ClassroomCommentListRow extends Record<string, unknown> {
  id: string;
  student_uuid: string;
  student_name: string;
  school_name: string | null;
  grade_label: string | null;
  room_no: string | null;
  comment: string;
  author_display_name: string;
  commented_at: Date | string;
  total_count?: number | string;
}

export interface StudentClassroomCommentRow extends Record<string, unknown> {
  id: string;
  student_uuid: string;
  comment: string;
  author_display_name: string;
  commented_at: Date | string;
  total_count?: number | string;
}
