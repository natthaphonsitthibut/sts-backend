import type { AttendanceExceptionDto } from './dto/exception-attendance.dto';

export interface ExceptionAttendanceActor {
  source: 'INTERNAL' | 'CLASSROOM_LINK';
  schoolId: number;
  classroomId: number;
  actorUserId: number | null;
  teacherMembershipId: string | null;
  actorLabel: string;
  /**
   * The link this register was taken through, when it was. It is what lets the
   * school that issued a link see what came of it; a register taken in the app
   * has none.
   */
  classroomAttendanceLinkId?: string | null;
  /**
   * The lessons this actor may act on in the room. A room's timetable belongs to
   * the room; what a link grants is one teacher's share of it, so the list is
   * narrowed at the door. Undefined in the app, where the account's permissions
   * already answer the question.
   */
  allowedClassroomSubjectIds?: number[];
}

export interface CheckInClassroomRow extends Record<string, unknown> {
  classroom_id: string;
  school_id: number;
  school_name: string;
  school_status: string;
  school_term_id: string;
  academic_year: number;
  semester: number;
  term_status: string;
  starts_on: string | null;
  ends_on: string | null;
  grade_level_id: number;
  grade_label: string;
  legacy_room_number: number;
  room_code: string;
  room_name: string | null;
  classroom_status: string;
}

export interface CheckInSubjectRow extends Record<string, unknown> {
  classroom_subject_id: string;
  school_subject_id: string;
  subject_id: number;
  code: string;
  name_th: string;
}

export interface CheckInRosterRow extends Record<string, unknown> {
  student_uuid: string;
  student_number: string | null;
  first_name: string;
  last_name: string;
  has_photo: boolean;
  photo_updated_at: Date | string | null;
  risk_tier: string | null;
  teacher_comment: string | null;
}

export interface ExceptionAttendanceSessionRow extends Record<string, unknown> {
  id: string;
  school_term_id: string;
  school_id: number;
  grade_level_id: number;
  room_id: number;
  classroom_id: string;
  classroom_subject_id: string;
  attendance_date: string;
  period: number | null;
  status: 'OPEN' | 'SUBMITTED' | 'REOPENED' | 'VOIDED';
  expected_roster_count: number;
  recorded_count: number;
  exception_count: number;
  revision: number;
  record_storage_mode: 'FULL_ROSTER' | 'EXCEPTIONS';
  checking_started_at: Date | string;
  submitted_at: Date | string | null;
}

export interface StoredAttendanceExceptionRow extends Record<string, unknown> {
  student_uuid: string;
  attendance_status_code: number;
}

export interface PreparedAttendanceException extends AttendanceExceptionDto {
  statusCode: 2 | 3 | 4;
  markedAt: string;
}
