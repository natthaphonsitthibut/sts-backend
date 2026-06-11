export interface QueryResultLike<T extends Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface QueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>>;
}

export interface SettingValueRow extends Record<string, unknown> {
  setting_value: string;
}

export interface OpenAbsenceCaseRow extends Record<string, unknown> {
  id: number;
  student_name: string | null;
}

export interface ConsecutiveAbsentStudentRow extends Record<string, unknown> {
  person_id_onec: string;
  consecutive_days: number;
  first_name_onec: string | null;
  last_name_onec: string | null;
  school_id_onec: number | null;
  village_number_onec: string | null;
  street_onec: string | null;
  soi_onec: string | null;
  sub_district_name_thai_onec: string | null;
  district_name_thai_onec: string | null;
  province_name_thai_onec: string | null;
  school_name: string | null;
}

export interface CreatedCaseRow extends Record<string, unknown> {
  id: number;
}

export interface CreateAutomatedCaseInput {
  studentName: string;
  schoolName: string;
  studentAddress: string | null;
  reason: string;
}

export interface NewCase {
  case_id: number;
  student_name: string;
  student_school: string;
  reason_flagged: string;
}
