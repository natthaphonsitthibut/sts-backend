export const IMPORT_TARGETS = ['student_term'] as const;

export type ImportTarget = (typeof IMPORT_TARGETS)[number];
export type ImportBatchTarget =
  | ImportTarget
  | 'student_exit_events'
  | 'school_teacher_membership'
  | 'school_classroom'
  | 'classroom_teacher_assignment';

/**
 * Per-target whitelist of column identifiers that may be written by an import.
 * Mirrors the canonical table definitions in database/bootstrap-sql.ts. Column
 * names arrive from a client-supplied mapping and are interpolated into SQL
 * identifiers, so any name outside this set MUST be rejected (fail closed) to
 * prevent identifier-based SQL injection.
 */
export const IMPORT_TARGET_COLUMNS: Record<ImportTarget, ReadonlySet<string>> = {
  student_term: new Set([
    'AcademicYear_Onec',
    'Semester_Onec',
    'DepartmentID_Onec',
    'SchoolID_Onec',
    'PersonID_Onec',
    'student_number',
    'PassportNumber_Onec',
    'PrefixID_Onec',
    'FirstName_Onec',
    'MiddleName_Onec',
    'LastName_Onec',
    'GenderID_Onec',
    'NationalityID_Onec',
    'DisabilityID_Onec',
    'DisadvantageEducationID_Onec',
    'VillageNumber_Onec',
    'Street_Onec',
    'Soi_Onec',
    'Trok_Onec',
    'SubDistrictID_Onec',
    'SchoolAdmissionYear_Onec',
    'GradeLevelID_Onec',
    'RoomID_Onec',
    'GPAX_Onec',
    'term_gpa',
    'StudentStatusID_Onec',
    'ProvinceNameThai_Onec',
    'DistrictNameThai_Onec',
    'SubDistrictNameThai_Onec',
  ]),
};

export const SERVER_INJECTED_COLUMNS: ReadonlySet<string> = new Set([
  'person_uuid',
  'student_status_code',
  'school_term_id',
  'classroom_id',
]);

/** Input-only fields transformed into canonical table columns before persistence. */
export const DERIVED_IMPORT_COLUMNS: Record<ImportTarget, ReadonlySet<string>> = {
  student_term: new Set(['FullName_Onec']),
};

export const STUDENT_TERM_NATURAL_KEY_COLUMNS: readonly string[] = [
  'person_uuid',
  'AcademicYear_Onec',
  'Semester_Onec',
  'SchoolID_Onec',
];

export const STUDENT_TERM_MUTABLE_IMPORT_COLUMNS: ReadonlySet<string> = new Set([
  'student_number',
  'DepartmentID_Onec',
  'PassportNumber_Onec',
  'PrefixID_Onec',
  'FirstName_Onec',
  'MiddleName_Onec',
  'LastName_Onec',
  'GenderID_Onec',
  'NationalityID_Onec',
  'DisabilityID_Onec',
  'DisadvantageEducationID_Onec',
  'VillageNumber_Onec',
  'Street_Onec',
  'Soi_Onec',
  'Trok_Onec',
  'SubDistrictID_Onec',
  'SchoolAdmissionYear_Onec',
  'GradeLevelID_Onec',
  'RoomID_Onec',
  'GPAX_Onec',
  'term_gpa',
  'StudentStatusID_Onec',
  'student_status_code',
  'ProvinceNameThai_Onec',
  'DistrictNameThai_Onec',
  'SubDistrictNameThai_Onec',
  'school_term_id',
  'classroom_id',
]);

export interface SchoolRosterImportContextRow extends Record<string, unknown> {
  school_id: number;
  school_term_id: string;
  classroom_id: string;
  academic_year: number;
  semester: number;
  grade_level_id: number;
  legacy_room_number: number | null;
  province: string | null;
  district: string | null;
  sub_district: string | null;
}

export interface TeacherImportCandidateRow extends Record<string, unknown> {
  user_id: number;
  username: string;
  display_name: string;
  is_eligible: boolean;
  is_active_member: boolean;
}

export type SheetRow = Record<string, unknown>;

export interface ExistingSchoolIdRow extends Record<string, unknown> {
  id: number;
}

export interface ExistingImportPersonIdRow extends Record<string, unknown> {
  person_id: string;
}

export interface ExistingStudentTermRow extends ExistingImportPersonIdRow {
  academic_year: string;
  semester: string;
  school_id: string;
  mutable_values?: Record<string, unknown>;
}

export interface ImportReferenceRow extends Record<string, unknown> {
  id: number;
  label: string;
  category?: string;
}

export type ImportWriteAction = 'inserted' | 'updated' | 'skipped';

export interface ImportWriteSummary {
  inserted: number;
  updated: number;
}

export const IMPORT_QUARANTINE_REASONS = [
  'MISSING_NATURAL_KEY_FIELD',
  'UNMAPPED_STUDENT_STATUS',
  'DUPLICATE_ROW_IN_FILE',
  'MULTIPLE_ACTIVE_ENROLLMENTS',
  'IDENTIFIER_CONFLICT',
  'NAME_CONFLICT_FOR_IDENTIFIER',
  'INVALID_NATIONAL_ID_CHECKSUM',
  'SCHOOL_NOT_FOUND',
  'GRADE_NOT_FOUND',
  'ROOM_NOT_FOUND',
  'STATUS_CAUSE_UNMAPPED',
  'BLANK_REQUIRED_IDENTITY',
  'BLANK_TEACHER_USERNAME',
  'DUPLICATE_TEACHER_ROW',
  'TEACHER_ACCOUNT_NOT_FOUND',
  'INVALID_TEACHER_PERMISSION',
  'INVALID_TEACHER_START_DATE',
  'MISSING_IMPORT_FIELD',
  'CLASSROOM_IDENTITY_CONFLICT',
  'TEACHER_MEMBERSHIP_NOT_FOUND',
  'SUBJECT_NOT_FOUND',
  'INVALID_ASSIGNMENT_KIND',
  'INVALID_IMPORT_DATE',
  'ASSIGNMENT_CONFLICT',
] as const;

export type ImportQuarantineReason = (typeof IMPORT_QUARANTINE_REASONS)[number];

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

export function isImportTarget(value: string): value is ImportTarget {
  return (IMPORT_TARGETS as readonly string[]).includes(value);
}
