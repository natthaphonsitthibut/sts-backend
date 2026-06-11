export const MASTER_DATA_TABLES = [
  'risk_factors',
  'dropout_reasons',
  'assistance_measures',
  'related_agencies',
  'schools',
  'educational_areas',
] as const;

export type MasterDataTable = (typeof MASTER_DATA_TABLES)[number];

const MASTER_DATA_NAME_TABLES = new Set<MasterDataTable>([
  'related_agencies',
  'schools',
  'educational_areas',
]);

export type MasterDataValueColumn = 'label' | 'name';

export interface MasterDataRow extends Record<string, unknown> {
  id: number;
  label?: string | null;
  name?: string | null;
}

export interface QueryResultLike<T extends Record<string, unknown>> {
  rows: T[];
}

export function isMasterDataTable(value: string): value is MasterDataTable {
  return (MASTER_DATA_TABLES as readonly string[]).includes(value);
}

export function getMasterDataValueColumn(table: MasterDataTable): MasterDataValueColumn {
  return MASTER_DATA_NAME_TABLES.has(table) ? 'name' : 'label';
}
