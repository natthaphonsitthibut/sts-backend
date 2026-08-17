import type {
  TeacherAccessCapability,
  TeacherAccessStepUpPolicy,
} from './teacher-access.constants';

export type TeacherAccessGrantStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'SUSPENDED';
export type TeacherAccessScope = 'FULL' | 'ATTENDANCE_ONLY';

export interface TeacherAccessGrantRow extends Record<string, unknown> {
  id: string;
  teacher_membership_id: string;
  teacher_id: string;
  teacher_display_name: string;
  teacher_email: string | null;
  teacher_citizen_id: string | null;
  teacher_status: string;
  membership_status: 'ACTIVE' | 'INACTIVE';
  membership_deleted_at: string | Date | null;
  school_id: number;
  school_name: string;
  school_status: string;
  school_term_id: string;
  academic_year: number;
  semester: number;
  term_status: string;
  term_deleted_at: string | Date | null;
  term_starts_on: string | null;
  term_ends_on: string | null;
  token_hash: string;
  token_encrypted: string | null;
  access_scope: TeacherAccessScope;
  attendance_date: string | null;
  attendance_starts_at: string | Date | null;
  attendance_ends_at: string | Date | null;
  step_up_policy: TeacherAccessStepUpPolicy;
  issued_by: number;
  issuer_name: string;
  issued_at: string | Date;
  expires_at: string | Date;
  last_used_at: string | Date | null;
  revoked_at: string | Date | null;
  revoked_by: number | null;
  revocation_reason: string | null;
  rotated_at: string | Date | null;
  rotation_count: number;
  capabilities: TeacherAccessCapability[];
  assignment_count: number | string;
  total_count?: number | string;
}

export interface TeacherAccessAssignmentRow extends Record<string, unknown> {
  assignment_id: string;
  teacher_membership_id: string;
  school_id: number;
  classroom_id: string;
  school_term_id: string;
  grade_level_id: number;
  grade_label: string;
  legacy_room_number: number | null;
  room_code: string;
  room_name: string | null;
  classroom_status: 'ACTIVE' | 'INACTIVE';
  card_cover_color: string;
  has_cover_image: boolean;
  cover_image_position_x: number;
  cover_image_position_y: number;
  cover_image_scale: number;
  assignment_kind: 'HOMEROOM' | 'SUBJECT';
  assignment_status: 'ACTIVE' | 'INACTIVE';
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  timetable_slot_id?: string | null;
  timetable_slot_period?: number | null;
  effective_on: string | null;
  effective_until: string | null;
}

export interface TeacherAttendanceDelegationRow extends Record<string, unknown> {
  grant_id: string;
  teacher_membership_id: string;
  teacher_display_name: string;
  assignment_id: string;
  assignment_kind: 'HOMEROOM' | 'SUBJECT';
  subject_name: string | null;
  timetable_slot_id: string | null;
  timetable_slot_period: number | null;
  attendance_date: string;
  starts_at: string | Date;
  ends_at: string | Date;
  token_encrypted: string | null;
}

/** A delegation as the history screens list it, in any state. */
export interface TeacherAttendanceDelegationHistoryRow extends Record<string, unknown> {
  grant_id: string;
  assignment_id: string;
  teacher_membership_id: string;
  issued_by_name: string;
  teacher_display_name: string;
  subject_name: string | null;
  timetable_slot_period: number | null;
  attendance_date: string;
  starts_at: string | Date;
  ends_at: string | Date;
  delegation_status: 'PENDING' | 'COMPLETED' | 'REVOKED' | 'EXPIRED';
  token_encrypted: string | null;
  total_count: number;
}

export interface TeacherAccessRosterRow extends Record<string, unknown> {
  student_uuid: string;
  student_number: string | null;
  has_photo: boolean;
  first_name: string | null;
  last_name: string | null;
  student_status_code: number | null;
  student_status_label: string | null;
  risk_tier: string | null;
  teacher_comment: string | null;
  total_count: number | string;
}

export interface TeacherAttendanceHistoryRow extends Record<string, unknown> {
  id: string;
  attendance_date: string;
  period: number;
  status: string;
  submitted_at: string | Date | null;
  recorded_by: string | null;
  present_count: number;
  late_count: number;
  leave_count: number;
  absent_count: number;
  total_count: number | string;
}

export interface TeacherAccessGrantDetail {
  grant: TeacherAccessGrantRow;
  capabilities: TeacherAccessCapability[];
  assignments: TeacherAccessAssignmentRow[];
}

export interface ActiveTeacherGrantContext {
  grantId: string;
  teacherMembershipId: string;
  /** `teachers.id` — the identity an attendance row is attributed to. */
  teacherId: string;
  teacherDisplayName: string;
  issuerUserId: number;
  schoolId: number;
  schoolName: string;
  schoolTermId: string;
  academicYear: number;
  semester: number;
  assignmentId: string | null;
  classroomId: string | null;
  subjectId: number | null;
  capabilities: TeacherAccessCapability[];
  accessScope: TeacherAccessScope;
  attendanceDate: string | null;
}
