import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoginLinkFirstUsedAt20260629161000 implements MigrationInterface {
  name = 'AddLoginLinkFirstUsedAt20260629161000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD COLUMN IF NOT EXISTS first_used_at TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS first_used_at`);
  }
}
