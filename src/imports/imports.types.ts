export const IMPORT_TARGETS = ['student_term', 'student_dropouts'] as const;

export type ImportTarget = (typeof IMPORT_TARGETS)[number];

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
