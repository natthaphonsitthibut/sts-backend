import type { MigrationInterface, QueryRunner } from 'typeorm';
import { DATA_EXPORT_TABLES_SQL, SET_UPDATED_AT_FUNCTION_SQL } from '../bootstrap-sql';

export class AddDataExportJobs20260714170000 implements MigrationInterface {
  name = 'AddDataExportJobs20260714170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(SET_UPDATED_AT_FUNCTION_SQL);
    await queryRunner.query(DATA_EXPORT_TABLES_SQL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_data_export_job_event_no_delete ON data_export_job_event`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_data_export_job_event_no_update ON data_export_job_event`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_data_export_job_event_mutation`);
    await queryRunner.query(`DROP TABLE IF EXISTS data_export_job_event`);
    await queryRunner.query(`DROP TABLE IF EXISTS data_export_job`);
  }
}
