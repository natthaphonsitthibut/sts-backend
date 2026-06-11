import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMustChangePasswordToUsers20260610090000 implements MigrationInterface {
  name = 'AddMustChangePasswordToUsers20260610090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS must_change_password
    `);
  }
}
