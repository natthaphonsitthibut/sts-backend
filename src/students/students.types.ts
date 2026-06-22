import type { SqlQueryResult } from '../database/sql-query';

export interface StudentListFilters {
  grade?: string;
  room?: number;
  schoolId?: number;
  searchTerm?: string;
  page?: number;
  limit?: number;
}

export interface StudentListResult {
  rows: StudentListRow[];
  totalCount: number;
}

export interface StudentFilterOptions {
  grades: string[];
  rooms: string[];
}

export interface StudentListRow extends Record<string, unknown> {
  id: string;
  name: string;
  grade: string;
  room: string;
  school_name: string | null;
  school_id: number | null;
}

export interface StudentDetailRow extends Record<string, unknown> {
  PersonID_Onec: string;
  student_uuid?: string | null;
  grade?: string | null;
  room?: string | null;
  school_name?: string | null;
}

export interface StudentCaseRow extends Record<string, unknown> {
  id: string | number;
  created_at: string;
  reason_flagged: string | null;
  status: string;
}

export interface StudentAttendanceRow extends Record<string, unknown> {
  date: string;
  status: string | number;
  period: string | number | null;
}

export type StudentsQueryResult<T extends Record<string, unknown>> = SqlQueryResult<T>;

/** One row to append to the immutable `pii_access_events` log. */
export interface PiiAccessEventInput {
  actorUserId: number | null;
  actorRoles: string[];
  actorKind: 'STAFF' | 'GUEST';
  subjectStudentRef: string;
  subjectRefKeyVersion: number;
  fieldGroup: string;
  reasonCode: string;
  reasonNote: string | null;
  purposeLinkId: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}
