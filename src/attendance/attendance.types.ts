import type { DataScope } from '../common/utils/authorization';
import type { AttendanceSelectionStatus } from './attendance-status';

export type { AttendanceHistoryStatus, AttendanceSelectionStatus } from './attendance-status';

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
  first_name?: string | null;
  last_name?: string | null;
  classroom_id?: number | string | null;
  risk_tier?: string | null;
  teacher_comment?: string | null;
  id: string;
  name: string;
  grade: string;
  room: string;
  school_id: number | string;
  school_name?: string | null;
  student_number: string | null;
  photo_storage_key: string | null;
  photo_updated_at: string | Date | null;
  term_absent_days: number | string;
  absent_days_since_case_reset: number | string;
  absence_reset_after_date: string | Date | null;
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
  /** Selected via `a.*`; null for rows written before marked_at existed. */
  marked_at?: string | null;
  school_id?: number | string;
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
  /**
   * When the teacher tapped this status on their device, already clamped into
   * the attendance day. `null` when the caller sent nothing usable.
   */
  marked_at: string | null;
}

export interface AttendanceSaveRecordInput {
  student_id: string;
  status: string;
  /** Raw client timestamp; validated and clamped before it reaches the row. */
  marked_at?: string | null;
}

export interface AttendanceInsertRecord {
  studentUuid: string;
  date: string;
  statusCode: number;
  recordedBy: string;
  recordedByTeacherId?: number | null;
  period: number;
  sessionId: string;
  metadata: StudentAttendanceMetadataRow;
}

export interface AttendanceWriteContext {
  actorUserId: number | null;
  actorLabel: string;
  recorder: string;
  /** `teachers.id` when a teacher recorded it; null for staff, who are not teachers. */
  recorderTeacherId?: number | null;
  allowedStudentIds?: string[];
  session?: {
    kind: 'SUBJECT';
    period: number;
    subjectId?: number | null;
    timetableSlotId?: number | null;
  };
}

export type AttendanceScope = DataScope | undefined;
