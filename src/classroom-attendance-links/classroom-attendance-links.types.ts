export interface ClassroomLinkRow extends Record<string, unknown> {
  id: string;
  school_id: number;
  school_name: string;
  school_term_id: string;
  academic_year: number;
  semester: number;
  term_status: string;
  classroom_id: string;
  grade_level_id: number;
  grade_label: string;
  legacy_room_number: string;
  room_name: string;
  classroom_status: string;
  token_hash: string;
  token_encrypted: string;
  link_status: 'ACTIVE' | 'INACTIVE';
  issued_at: Date | string;
  rotated_at: Date | string | null;
  last_used_at: Date | string | null;
  homeroom_teacher_membership_id: string | null;
  homeroom_teacher_name: string | null;
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
  classroom_id: string;
  grade_level_id: number;
  grade_label: string;
  legacy_room_number: string;
  room_name: string;
  classroom_status: string;
  token_hash: string | null;
  token_encrypted: string | null;
  link_status: 'ACTIVE' | 'INACTIVE' | null;
  issued_at: Date | string | null;
  rotated_at: Date | string | null;
  last_used_at: Date | string | null;
  homeroom_teacher_membership_id: string | null;
  homeroom_teacher_id: string | null;
  homeroom_teacher_name: string | null;
  homeroom_teacher_has_photo: boolean;
  homeroom_teachers: Array<{
    teacherId: string;
    teacherName: string;
    hasPhoto: boolean;
    isPrimary: boolean;
  }>;
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

export interface AuthorizedClassroomCheckIn {
  linkId: string;
  schoolId: number;
  schoolTermId: number;
  classroomId: number;
  gradeLevelId: number;
  roomNumber: number;
  teacherId: string;
  teacherMembershipId: string;
  teacherDisplayName: string;
  provider: 'GOOGLE' | 'THAID';
}
