import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import type { QueryResultLike, SystemSettingRow } from './settings.types';

@Injectable()
export class SettingsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private async runQuery(
    sql: string,
    params: unknown[],
    queryRunner?: QueryRunner,
  ): Promise<SystemSettingRow[]> {
    if (queryRunner) {
      return (await queryRunner.query(sql, params)) as SystemSettingRow[];
    }
    const result = (await queryDataSource<SystemSettingRow>(
      this.dataSource,
      sql,
      params,
    )) as QueryResultLike<SystemSettingRow>;
    return result.rows;
  }

  async withTransaction<T>(operation: (queryRunner: QueryRunner) => Promise<T>): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await operation(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async listSettings(): Promise<SystemSettingRow[]> {
    return await this.runQuery('SELECT * FROM system_settings ORDER BY setting_key', []);
  }

  async findSettingByKey(key: string, queryRunner?: QueryRunner): Promise<SystemSettingRow | null> {
    const rows = await this.runQuery(
      'SELECT * FROM system_settings WHERE setting_key = $1',
      [key],
      queryRunner,
    );
    return rows[0] || null;
  }

  async upsertSetting(
    key: string,
    value: string,
    description: string,
    queryRunner?: QueryRunner,
  ): Promise<SystemSettingRow> {
    const rows = await this.runQuery(
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
      queryRunner,
    );

    return rows[0];
  }
}
