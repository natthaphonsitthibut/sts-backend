export type SchoolTermStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';
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
}

export interface AttendanceSessionRow extends Record<string, unknown> {
  id: string;
  school_term_id: string;
  school_id: number;
  grade_level_id: number;
  room_id: number;
  attendance_date: string;
  period: number;
  session_kind: 'SUBJECT';
  status: AttendanceSessionStatus;
  expected_roster_count: number;
  recorded_count: number;
  revision: number;
  submitted_at: string | Date | null;
  correction_reason: string | null;
}

export interface AttendanceClassMetadataRow extends Record<string, unknown> {
  student_uuid: string;
  classroom_id: number;
  school_id: number;
  grade_level_id: number;
  grade_label: string;
  room_id: number;
  academic_year: number;
  semester: number;
}

export interface SchoolTermInput {
  termId?: number;
  schoolId: number;
  academicYear: number;
  semester: number;
  startsOn: string;
  endsOn: string;
  status: SchoolTermStatus;
  actorUserId: number | null;
}
