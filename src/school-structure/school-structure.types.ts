export type StructureStatus = 'ACTIVE' | 'INACTIVE';
export type TeacherAssignmentKind = 'HOMEROOM' | 'SUBJECT';
/** Uppercase 7-character hex colour (`#RRGGBB`), enforced by DTO + CHECK constraint. */
export type ClassroomCardCoverColor = string;

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
  card_cover_color: ClassroomCardCoverColor;
  cover_image_storage_key: string | null;
  cover_image_position_x: number;
  cover_image_position_y: number;
  cover_image_scale: number | string;
  updated_at: Date | string;
  is_favorite: boolean;
  favorited_at: Date | string | null;
  homeroom_teacher_name?: string | null;
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
  /** Legacy login account. Null for teachers created without one — the name
   * now comes from `teachers`, so nothing should key off this. */
  teacher_user_id: number | null;
  username: string | null;
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
  student_number: string | null;
  photo_storage_key: string | null;
  photo_updated_at: string | Date | null;
  risk_tier: string | null;
  risk_severity: number | null;
  teacher_comment: string | null;
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

export interface ClassroomDailyAttendanceRow extends Record<string, unknown> {
  attendance_date: string;
  recorded_by: string;
  present_count: number;
  late_count: number;
  leave_count: number;
  absent_count: number;
}

export interface ClassroomStudentAttendanceSummaryRow extends Record<string, unknown> {
  student_uuid: string;
  student_number: string | null;
  photo_storage_key: string | null;
  photo_updated_at: string | Date | null;
  first_name: string | null;
  last_name: string | null;
  present_count: number;
  late_count: number;
  leave_count: number;
  absent_count: number;
}

export interface ClassroomStudentAttendanceDayRow extends Record<string, unknown> {
  attendance_id: string;
  attendance_date: string;
  recorded_time: string | null;
  recorded_by: string;
  attendance_status: number;
}
