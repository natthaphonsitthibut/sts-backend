import type { MigrationInterface, QueryRunner } from 'typeorm';
import { SET_UPDATED_AT_FUNCTION_SQL, STUDENT_ACCOUNT_BATCH_TABLES_SQL } from '../bootstrap-sql';

export class AddStudentAccountBatchJob20260701120000 implements MigrationInterface {
  name = 'AddStudentAccountBatchJob20260701120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Ensure the shared updated_at trigger function exists before attaching it.
    await queryRunner.query(SET_UPDATED_AT_FUNCTION_SQL);
    await queryRunner.query(STUDENT_ACCOUNT_BATCH_TABLES_SQL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS student_account_batch_job_item`);
    await queryRunner.query(`DROP TABLE IF EXISTS student_account_batch_job`);
  }
}
