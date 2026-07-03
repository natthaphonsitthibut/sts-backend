import type { SystemSettingEnumOption, SystemSettingValueType } from './settings-catalog';

export interface SystemSettingRow extends Record<string, unknown> {
  setting_key: string;
  setting_value: string;
  description: string | null;
  updated_at?: string | Date | null;
}

export interface SystemSettingResponse extends SystemSettingRow {
  value_type: SystemSettingValueType | null;
  enum_options: SystemSettingEnumOption[] | null;
  min: number | null;
  max: number | null;
  editable: boolean;
}

export interface QueryResultLike<T extends Record<string, unknown>> {
  rows: T[];
}
