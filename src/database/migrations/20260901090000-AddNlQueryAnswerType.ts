import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNlQueryAnswerType20260901090000 implements MigrationInterface {
  name = 'AddNlQueryAnswerType20260901090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE nl_query_log ADD COLUMN IF NOT EXISTS answer_type VARCHAR(16) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE nl_query_log ADD COLUMN IF NOT EXISTS steps_used INTEGER NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE nl_query_log DROP COLUMN IF EXISTS steps_used
    `);
    await queryRunner.query(`
      ALTER TABLE nl_query_log DROP COLUMN IF EXISTS answer_type
    `);
  }
}
