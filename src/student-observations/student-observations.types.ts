export type ObservationConcernLevel = 'NOTE' | 'WATCH' | 'CONCERN';
export type ObservationAuthorKind = 'USER' | 'TEACHER_ACCESS';

export interface ObservationDimensionRow extends Record<string, unknown> {
  id: string;
  code: string;
  label_th: string;
  requires_comment: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface ObservationBehaviorTagRow extends Record<string, unknown> {
  id: string;
  code: string;
  label_th: string;
  observation_dimension_id: string | null;
  dimension_code: string | null;
  requires_comment: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface ObservationEnrollmentRow extends Record<string, unknown> {
  student_uuid: string;
  school_id: number;
  school_name: string;
  school_status: string;
  school_term_id: string;
  academic_year: number;
  semester: number;
  term_status: string;
  term_starts_on: string | null;
  term_ends_on: string | null;
  classroom_id: string | null;
  classroom_status: string | null;
}

export interface ObservationAssignmentRow extends Record<string, unknown> {
  assignment_id: string;
  teacher_membership_id: string;
  teacher_user_id: number;
  school_id: number;
  school_term_id: string;
  classroom_id: string;
  subject_id: number | null;
  assignment_kind: 'HOMEROOM' | 'SUBJECT';
}

export interface StudentObservationTagView {
  id: string;
  code: string;
  labelTh: string;
}

export interface StudentObservationRow extends Record<string, unknown> {
  id: string;
  student_uuid: string;
  school_id: number;
  author_kind: ObservationAuthorKind;
  author_user_id: number;
  author_username: string;
  author_display_name: string;
  author_teacher_membership_id: string | null;
  source_teacher_access_grant_id: string | null;
  source_assignment_id: string | null;
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  observation_dimension_id: string;
  dimension_code: string;
  dimension_label: string;
  concern_level: ObservationConcernLevel;
  comment: string | null;
  comment_required: boolean;
  observed_at: string | Date;
  revision_number: number;
  created_at: string | Date;
  updated_at: string | Date;
  tags: StudentObservationTagView[];
  total_count?: number | string;
}

export interface StudentObservationRevisionRow extends Record<string, unknown> {
  id: string;
  observation_id: string;
  revision_number: number;
  dimension_code: string;
  dimension_label: string;
  concern_level: ObservationConcernLevel;
  comment: string | null;
  comment_required: boolean;
  observed_at: string | Date;
  behavior_tag_ids: string[];
  changed_by_user_id: number;
  changed_by_display_name: string;
  source_teacher_access_grant_id: string | null;
  change_reason: string | null;
  changed_at: string | Date;
  total_count?: number | string;
}

export interface ObservationWriteInput {
  studentUuid: string;
  schoolId: number;
  authorKind: ObservationAuthorKind;
  authorUserId: number;
  authorTeacherMembershipId: number | null;
  sourceTeacherAccessGrantId: string | null;
  sourceAssignmentId: number;
  dimensionId: number;
  concernLevel: ObservationConcernLevel;
  comment: string | null;
  commentRequired: boolean;
  observedAt: Date;
  behaviorTagIds: number[];
  changeReason?: string | null;
}
