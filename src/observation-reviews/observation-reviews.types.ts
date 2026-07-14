export const HUMAN_RISK_DECISIONS = ['CONFIRM_RISK', 'WATCH', 'NO_ACTION'] as const;
export type HumanRiskDecision = (typeof HUMAN_RISK_DECISIONS)[number];

export const FOLLOW_UP_URGENCIES = ['NORMAL', 'URGENT'] as const;
export type FollowUpUrgency = (typeof FOLLOW_UP_URGENCIES)[number];

export const FOLLOW_UP_REVIEW_DECISIONS = [
  'APPROVE_AND_ASSIGN',
  'NEED_MORE_INFO',
  'REJECT',
] as const;
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
  status: 'PENDING_REVIEW' | FollowUpReviewDecision;
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
  revision_number: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  sources: ObservationSourceRef[] | string;
  total_count?: number | string;
}
