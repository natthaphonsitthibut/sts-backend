import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTemporaryPasswordExpiryToUsers20260628120000 implements MigrationInterface {
  name = 'AddTemporaryPasswordExpiryToUsers20260628120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS temporary_password_issued_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS temporary_password_expires_at TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS temporary_password_expires_at,
      DROP COLUMN IF EXISTS temporary_password_issued_at
    `);
  }
}
