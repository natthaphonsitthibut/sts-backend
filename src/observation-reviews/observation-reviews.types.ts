export const HUMAN_RISK_DECISIONS = ['CONFIRM_RISK', 'WATCH', 'NO_ACTION'] as const;
export type HumanRiskDecision = (typeof HUMAN_RISK_DECISIONS)[number];

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

export interface TeacherObservationReportRow extends Record<string, unknown> {
  report_kind: 'OBSERVATION';
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
