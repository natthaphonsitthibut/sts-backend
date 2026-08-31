import type { AuthenticatedRequestUser } from '../auth';

export interface ClassroomLinkRow extends Record<string, unknown> {
  id: string;
  school_id: number;
  school_name: string;
  school_term_id: string;
  academic_year: number;
  semester: number;
  term_status: string;
  /** Null on an assignment: it belongs to a classroom, not to a teacher. */
  teacher_membership_id: string | null;
  teacher_name: string | null;
  assigned_classroom_id: string | null;
  assigned_classroom_subject_id: string | null;
  /** Set when a teacher issued this assignment from inside their own link. */
  issued_by_teacher_membership_id: string | null;
  /** Standing teacher link that created this assignment, if it was link-issued. */
  source_teacher_link_id: string | null;
  created_by: number | null;
  assigned_classroom_label: string | null;
  assigned_subject_name: string | null;
  opens_at: Date | string | null;
  expires_at: Date | string | null;
  assignment_note: string | null;
  /** Rooms this teacher's subjects reach in the term — what the link opens. */
  classroom_count: number;
  token_hash: string;
  token_encrypted: string;
  link_status: 'ACTIVE' | 'INACTIVE';
  issued_at: Date | string;
  rotated_at: Date | string | null;
  last_used_at: Date | string | null;
  line_provider_user_id: string | null;
  line_friend_state: 'FRIEND' | 'NOT_FRIEND' | 'BLOCKED' | 'UNKNOWN' | null;
  line_delivery_teacher_membership_id: string | null;
  line_delivery_status: ClassroomLinkLineDeliveryStatus;
  line_delivery_failure_code: ClassroomLinkLineDeliveryFailureCode | null;
  line_delivery_attempt_count: number;
  line_delivery_request_id: string | null;
  line_delivery_last_attempted_at: Date | string | null;
  line_delivered_at: Date | string | null;
  total_count?: number | string;
}

export interface ClassroomLinkListRow extends Record<string, unknown> {
  id: string | null;
  school_id: number;
  school_name: string;
  school_status: string;
  school_term_id: string;
  academic_year: number;
  semester: number;
  term_status: string;
  teacher_membership_id: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  teacher_has_photo: boolean;
  assigned_classroom_id: string | null;
  assigned_classroom_label: string | null;
  opens_at: Date | string | null;
  expires_at: Date | string | null;
  assignment_note: string | null;
  /** Rooms the teacher's subjects reach — what their link opens onto. */
  classroom_count: number;
  classrooms: Array<{ classroomId: string; label: string }>;
  token_hash: string | null;
  token_encrypted: string | null;
  link_status: 'ACTIVE' | 'INACTIVE' | null;
  issued_at: Date | string | null;
  rotated_at: Date | string | null;
  last_used_at: Date | string | null;
  line_provider_user_id: string | null;
  line_friend_state: 'FRIEND' | 'NOT_FRIEND' | 'BLOCKED' | 'UNKNOWN' | null;
  line_delivery_teacher_membership_id: string | null;
  line_delivery_status: ClassroomLinkLineDeliveryStatus;
  line_delivery_failure_code: ClassroomLinkLineDeliveryFailureCode | null;
  line_delivery_attempt_count: number;
  line_delivery_request_id: string | null;
  line_delivery_last_attempted_at: Date | string | null;
  line_delivered_at: Date | string | null;
  latest_session_id: string | null;
  latest_session_date: string | null;
  latest_session_status: string | null;
  latest_session_submitted_at: Date | string | null;
}

export type ClassroomLinkLineDeliveryStatus =
  | 'NOT_READY'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'NEEDS_RESEND';

export type ClassroomLinkLineDeliveryFailureCode =
  | 'HOMEROOM_UNAVAILABLE'
  | 'MESSAGING_DISABLED'
  | 'ACCOUNT_NOT_VERIFIED'
  | 'ACCOUNT_NOT_REACHABLE'
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_UNAVAILABLE';

export interface ExternalTeacherRow extends Record<string, unknown> {
  teacher_id: string;
  teacher_membership_id: string;
  school_id: number;
  teacher_display_name: string;
  normalized_email: string | null;
  citizen_id: string | null;
  teacher_status: string;
  membership_status: string;
  teacher_has_photo: boolean;
  teacher_photo_updated_at: Date | string | null;
  teacher_deleted_at: Date | string | null;
  membership_deleted_at: Date | string | null;
}

export interface ClassroomLinkSession {
  linkId: string;
  tokenHash: string;
  teacherId: string;
  teacherMembershipId: string;
  schoolId: number;
  provider: 'GOOGLE' | 'THAID';
  issuedAt: number;
}

/**
 * Who is asking about the assignments they issued.
 *
 * The admin screen asks as an account and a teacher inside their own link asks
 * as a membership; both are recorded on the link when it is created, so the
 * two doors read the same rows through the same code.
 */
export type AssignmentIssuer =
  | { kind: 'USER'; actor: AuthenticatedRequestUser }
  | { kind: 'LINK'; authorized: AuthorizedClassroomCheckIn };

export interface AuthorizedClassroomCheckIn {
  linkId: string;
  schoolId: number;
  schoolTermId: number;
  /** Set when the link is an assignment: the one lesson it covers. */
  assignedClassroomId: number | null;
  assignedClassroomSubjectId: number | null;
  assignedClassroomLabel: string | null;
  assignedSubjectName: string | null;
  teacherId: string;
  teacherMembershipId: string;
  teacherDisplayName: string;
  provider: 'GOOGLE' | 'THAID';
}
