export const IMPORT_TARGETS = ['student_term', 'student_dropouts'] as const;

export type ImportTarget = (typeof IMPORT_TARGETS)[number];

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
    'StudentStatusID_Onec',
    'ProvinceNameThai_Onec',
    'DistrictNameThai_Onec',
    'SubDistrictNameThai_Onec',
  ]),
  student_dropouts: new Set([
    'ProvinceNameThai_Onec',
    'DistrictNameThai_Onec',
    'SubDistrictNameThai_Onec',
    'PersonID_Onec',
    'Fullname_Onec',
    'Gender_Onec',
    'NationalityName_Onec',
    'BirthDate_Onec',
    'HouseNumber_Onec',
    'VillageNumber_Onec',
    'Street_Onec',
    'Soi_Onec',
    'Trok_Onec',
    'StatusCodeCause_Onec',
    'Remark_Onec',
    'SchoolName_Onec',
    'GradeLevelID_Onec',
    'AcademicYearPresent_Onec',
    'DropoutTransferID_Onec',
    'ACADYEAR',
    'RoomID_Onec',
    'SchoolID_Onec',
    'GenderID_Onec',
    'GPAX_Onec',
  ]),
};

export interface ManualSchool {
  id: number;
  name: string;
  province?: string;
  district?: string;
  sub_district?: string;
}

export type SheetRow = Record<string, unknown>;

export interface ExistingSchoolIdRow extends Record<string, unknown> {
  id: number;
}

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
