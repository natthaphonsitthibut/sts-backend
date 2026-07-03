import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  SET_UPDATED_AT_FUNCTION_SQL,
  STUDENT_IMPORT_QUARANTINE_TABLES_SQL,
} from '../bootstrap-sql';

export class AddStudentImportQuarantine20260702170000 implements MigrationInterface {
  name = 'AddStudentImportQuarantine20260702170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(SET_UPDATED_AT_FUNCTION_SQL);
    await queryRunner.query(STUDENT_IMPORT_QUARANTINE_TABLES_SQL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS student_import_quarantine_rows`);
    await queryRunner.query(`DROP TABLE IF EXISTS student_import_batches`);
  }
}
