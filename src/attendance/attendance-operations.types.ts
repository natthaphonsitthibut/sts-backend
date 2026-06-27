export type SchoolTermStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';
export type CalendarDayType = 'SCHOOL_DAY' | 'HOLIDAY' | 'CANCELLED';
export type AttendanceSessionStatus = 'OPEN' | 'SUBMITTED' | 'REOPENED' | 'VOIDED';

export interface SchoolTermRow extends Record<string, unknown> {
  id: string;
  school_id: number;
  school_name: string;
  academic_year: number;
  semester: number;
  starts_on: string | null;
  ends_on: string | null;
  status: SchoolTermStatus;
  calendar_day_count: number | string;
  school_day_count: number | string;
}

export interface CalendarDayRow extends Record<string, unknown> {
  id: string;
  school_term_id: string;
  calendar_date: string;
  day_type: CalendarDayType;
  reason: string | null;
  source: string;
}

export interface AttendanceSessionRow extends Record<string, unknown> {
  id: string;
  school_term_id: string;
  school_id: number;
  grade_level_id: number;
  room_id: number;
  attendance_date: string;
  period: number;
  session_kind: 'DAILY';
  status: AttendanceSessionStatus;
  expected_roster_count: number;
  recorded_count: number;
  revision: number;
  submitted_at: string | Date | null;
  correction_reason: string | null;
}

export interface AttendanceClassMetadataRow extends Record<string, unknown> {
  student_uuid: string;
  school_id: number;
  grade_level_id: number;
  grade_label: string;
  room_id: number;
  academic_year: number;
  semester: number;
}

export interface AttendanceReconciliationRow extends Record<string, unknown> {
  grade_level_id: number;
  grade_label: string;
  room_id: number;
  expected_roster_count: number;
  recorded_count: number;
  session_id: string | null;
  session_status: AttendanceSessionStatus | null;
  revision: number | null;
  operational_status: 'COMPLETED' | 'MISSING' | 'INCOMPLETE';
}

export interface SchoolTermInput {
  schoolId: number;
  academicYear: number;
  semester: number;
  startsOn: string;
  endsOn: string;
  status: SchoolTermStatus;
  actorUserId: number | null;
}

export interface AttendanceSessionIdentity {
  schoolTermId: string;
  schoolId: number;
  gradeLevelId: number;
  roomId: number;
  attendanceDate: string;
  period: number;
}
