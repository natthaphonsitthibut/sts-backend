import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ConstrainNlQueryAnswerType20260922130000 implements MigrationInterface {
  name = 'ConstrainNlQueryAnswerType20260922130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE nl_query_log
      ADD CONSTRAINT chk_nl_query_log_answer_type
      CHECK (answer_type IS NULL OR answer_type IN ('result', 'clarification', 'refusal'))
      NOT VALID
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE nl_query_log
      DROP CONSTRAINT IF EXISTS chk_nl_query_log_answer_type
    `);
  }
}
