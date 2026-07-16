export type StructureStatus = 'ACTIVE' | 'INACTIVE';
export type TeacherAssignmentKind = 'HOMEROOM' | 'SUBJECT';

export interface ScopedSchoolRow extends Record<string, unknown> {
  id: number;
  name: string;
  province: string | null;
  district: string | null;
  sub_district: string | null;
}

export interface SchoolClassroomRow extends Record<string, unknown> {
  id: string;
  school_term_id: string;
  school_id: number;
  academic_year: number;
  semester: number;
  grade_level_id: number;
  grade_label: string;
  legacy_room_number: number | null;
  room_code: string;
  room_name: string | null;
  classroom_status: StructureStatus;
  student_count: number | string;
}

export interface SchoolClassroomSummaryRow extends Record<string, unknown> {
  classroom_count: number | string;
  teacher_count: number | string;
  student_count: number | string;
}

export interface SchoolClassroomOptionRow extends Record<string, unknown> {
  id: string;
  grade_level_id: number;
  grade_label: string;
  room_code: string;
  room_name: string | null;
}

export interface SchoolTeacherMembershipRow extends Record<string, unknown> {
  id: string;
  school_id: number;
  teacher_user_id: number;
  username: string;
  display_name: string;
  membership_status: StructureStatus;
  started_on: string;
  ended_on: string | null;
}

export interface SchoolTeacherCandidateRow extends Record<string, unknown> {
  id: number;
  display_name: string;
}

export interface ClassroomTeacherAssignmentRow extends Record<string, unknown> {
  id: string;
  school_id: number;
  classroom_id: string;
  teacher_membership_id: string;
  teacher_user_id: number;
  teacher_name: string;
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  assignment_kind: TeacherAssignmentKind;
  assignment_status: StructureStatus;
  effective_on: string | null;
  effective_until: string | null;
}

export interface ClassroomRosterRow extends Record<string, unknown> {
  student_uuid: string;
  first_name: string | null;
  last_name: string | null;
  student_status_code: number | null;
  student_status_label: string | null;
  student_status_badge_variant:
    | 'default'
    | 'secondary'
    | 'destructive'
    | 'success'
    | 'warning'
    | null;
  classroom_id: string;
  grade_label: string;
  room_code: string;
}
