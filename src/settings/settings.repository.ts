import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import type { QueryResultLike, SystemSettingRow } from './settings.types';

@Injectable()
export class SettingsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async listSettings(): Promise<SystemSettingRow[]> {
    const result = (await queryDataSource<SystemSettingRow>(
      this.dataSource,
      'SELECT * FROM system_settings ORDER BY setting_key',
    )) as QueryResultLike<SystemSettingRow>;

    return result.rows;
  }

  async findSettingByKey(key: string): Promise<SystemSettingRow | null> {
    const result = (await queryDataSource<SystemSettingRow>(
      this.dataSource,
      'SELECT * FROM system_settings WHERE setting_key = $1',
      [key],
    )) as QueryResultLike<SystemSettingRow>;

    return result.rows[0] || null;
  }

  async upsertSetting(key: string, value: string, description?: string): Promise<SystemSettingRow> {
    const result = (await queryDataSource<SystemSettingRow>(
      this.dataSource,
      `
        INSERT INTO system_settings (
          setting_key,
          setting_value,
          description,
          updated_at
        )
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (setting_key)
        DO UPDATE SET
          setting_value = EXCLUDED.setting_value,
          description = EXCLUDED.description,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *;
      `,
      [key, value, description],
    )) as QueryResultLike<SystemSettingRow>;

    return result.rows[0];
  }
}
