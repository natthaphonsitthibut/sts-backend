export interface SystemSettingRow extends Record<string, unknown> {
  setting_key: string;
  setting_value: string;
  description: string | null;
  updated_at?: string | Date | null;
}

export interface QueryResultLike<T extends Record<string, unknown>> {
  rows: T[];
}
