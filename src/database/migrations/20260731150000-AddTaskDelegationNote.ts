import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskDelegationNote20260731150000 implements MigrationInterface {
  name = 'AddTaskDelegationNote20260731150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD COLUMN delegation_note TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
        DROP COLUMN IF EXISTS delegation_note
    `);
  }
}
