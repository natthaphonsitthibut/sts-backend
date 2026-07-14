export const MASTER_DATA_TABLES = [
  'risk_factors',
  'assistance_measures',
  'educational_areas',
  'school_affiliations',
  'disability_types',
  'absence_reason_categories',
  'absence_reasons',
  'non_follow_up_reasons',
] as const;

export type MasterDataTable = (typeof MASTER_DATA_TABLES)[number];

export const CODED_MASTER_DATA_TABLES = [
  'school_affiliations',
  'disability_types',
  'absence_reason_categories',
  'absence_reasons',
  'non_follow_up_reasons',
] as const;

export type CodedMasterDataTable = (typeof CODED_MASTER_DATA_TABLES)[number];

const MASTER_DATA_NAME_TABLES = new Set<MasterDataTable>([
  'educational_areas',
  'school_affiliations',
  'disability_types',
  'absence_reason_categories',
  'absence_reasons',
  'non_follow_up_reasons',
]);

export type MasterDataValueColumn = 'label' | 'name';
export type CodedMasterDataColumn =
  | 'code'
  | 'name'
  | 'note'
  | 'is_active'
  | 'legal_category'
  | 'category_id';

export interface MasterDataRow extends Record<string, unknown> {
  id: number | string;
  label?: string | null;
  name?: string | null;
  code?: string | null;
  note?: string | null;
  is_active?: boolean | null;
  legal_category?: string | null;
  category_id?: string | number | null;
}

export interface QueryResultLike<T extends Record<string, unknown>> {
  rows: T[];
}

export const SCHOOL_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type SchoolStatus = (typeof SCHOOL_STATUSES)[number];

export interface SchoolMasterDataRow extends Record<string, unknown> {
  id: number;
  name: string;
  province: string | null;
  district: string | null;
  sub_district: string | null;
  school_status: SchoolStatus;
}

export interface SchoolMasterDataInput {
  name: string;
  province: string | null;
  district: string | null;
  subDistrict: string | null;
}

export function isMasterDataTable(value: string): value is MasterDataTable {
  return (MASTER_DATA_TABLES as readonly string[]).includes(value);
}

export function isCodedMasterDataTable(table: MasterDataTable): table is CodedMasterDataTable {
  return (CODED_MASTER_DATA_TABLES as readonly string[]).includes(table);
}

export function getMasterDataValueColumn(table: MasterDataTable): MasterDataValueColumn {
  return MASTER_DATA_NAME_TABLES.has(table) ? 'name' : 'label';
}

export function getCodedMasterDataWritableColumns(
  table: CodedMasterDataTable,
): CodedMasterDataColumn[] {
  if (table === 'disability_types') {
    return ['code', 'name', 'note', 'is_active', 'legal_category'];
  }
  if (table === 'absence_reasons') {
    return ['code', 'name', 'category_id', 'note', 'is_active'];
  }

  return ['code', 'name', 'note', 'is_active'];
}
