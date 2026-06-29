import type { DataScope } from '../common/utils/authorization';

export type AttendanceSelectionStatus = 'P_PRESENT' | 'P_ABSENT' | 'P_LATE';

export interface QueryResultLike<T extends Record<string, unknown>> {
  rows: T[];
  rowCount?: number | null;
}

export interface QueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>>;
}

export interface SchoolFilters {
  province?: string;
  district?: string;
  subDistrict?: string;
  searchTerm?: string;
  limit?: number;
}

export interface StudentFilters {
  grade?: string;
  room?: number;
  schoolId?: number;
}

export interface GradeLevelRow extends Record<string, unknown> {
  id: number;
  label: string;
  category?: string | null;
}

export interface SchoolRow extends Record<string, unknown> {
  id: number;
  name: string;
  province?: string | null;
  district?: string | null;
  sub_district?: string | null;
}

export interface LocationProvinceRow extends Record<string, unknown> {
  province: string;
}

export interface LocationDistrictRow extends Record<string, unknown> {
  province: string;
  district: string;
}

export interface LocationSubDistrictRow extends Record<string, unknown> {
  province: string;
  district: string;
  sub_district: string;
}

export interface RoomRow extends Record<string, unknown> {
  room: string;
}

export interface AttendanceStudentRow extends Record<string, unknown> {
  id: string;
  name: string;
  grade: string;
  room: string;
  school_id: number | string;
  school_name?: string | null;
  total_late: number | string;
  total_absent: number | string;
}

export interface AttendanceHistoryRow extends Record<string, unknown> {
  PersonID_Onec?: string;
  student_id?: string;
  id?: string;
  name?: string;
  grade?: string;
  room?: string;
  status: number | string;
  RecordedBy?: string;
  school_id?: number | string;
}

export interface AttendanceTaskRow extends Record<string, unknown> {
  task_id: string;
  task_type: string;
  target_grade?: string | null;
  target_room?: string | null;
  target_school_id?: number | null;
  target_school_name?: string | null;
  task_status?: string | null;
  created_at?: string | Date;
  active_link_id?: string | null;
  active_link?: string | null;
  active_link_created_at?: string | Date | null;
  active_link_expires_at?: string | Date | null;
  link_assigned_to?: string | null;
  link_assigned_to_email?: string | null;
  active_link_locked?: boolean | number | null;
  active_link_lock_reason?: string | null;
  active_link_lock_at?: string | Date | null;
  link_state?: 'ACTIVE' | 'LOCKED' | 'EXPIRED' | null;
  attendance_session_id?: string | null;
  attendance_session_status?: string | null;
  attendance_expected_roster_count?: number | string | null;
  attendance_recorded_count?: number | string | null;
  attendance_check_status?: 'COMPLETED' | 'NOT_CHECKED' | null;
}

export interface StudentAttendanceMetadataRow extends Record<string, unknown> {
  SchoolID_Onec: number;
  GradeLevelID_Onec: number;
  RoomID_Onec: number;
  AcademicYear_Onec: number | string;
  Semester_Onec: number | string;
}

export interface SettingValueRow extends Record<string, unknown> {
  setting_value: string;
}

export interface AttendanceWriteRecord {
  student_id: string;
  status: AttendanceSelectionStatus;
}

export interface AttendanceSaveRecordInput {
  student_id: string;
  status: string;
}

export interface AttendanceInsertRecord {
  studentUuid: string;
  date: string;
  statusCode: number;
  recordedBy: string;
  period: number;
  sessionId: string;
  metadata: StudentAttendanceMetadataRow;
}

export interface AttendanceWriteContext {
  actorUserId: number | null;
  actorLabel: string;
  recorder: string;
  allowedStudentIds?: string[];
}

export type AttendanceScope = DataScope | undefined;
