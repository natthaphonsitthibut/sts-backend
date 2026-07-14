import type {
  TeacherAccessCapability,
  TeacherAccessStepUpPolicy,
} from './teacher-access.constants';

export type TeacherAccessGrantStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'SUSPENDED';

export interface TeacherAccessGrantRow extends Record<string, unknown> {
  id: string;
  teacher_membership_id: string;
  teacher_user_id: number;
  teacher_username: string;
  teacher_display_name: string;
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
  assignment_kind: 'HOMEROOM' | 'SUBJECT';
  assignment_status: 'ACTIVE' | 'INACTIVE';
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  effective_on: string | null;
  effective_until: string | null;
}

export interface TeacherAccessRosterRow extends Record<string, unknown> {
  student_uuid: string;
  first_name: string | null;
  last_name: string | null;
  student_status_code: number | null;
  student_status_label: string | null;
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
  teacherUserId: number;
  teacherUsername: string;
  teacherDisplayName: string;
  schoolId: number;
  schoolName: string;
  schoolTermId: string;
  academicYear: number;
  semester: number;
  assignmentId: string | null;
  classroomId: string | null;
  subjectId: number | null;
  capabilities: TeacherAccessCapability[];
}
