import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStructuredUserAddressParts20260701173000 implements MigrationInterface {
  name = 'AddStructuredUserAddressParts20260701173000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS address_village_no TEXT,
        ADD COLUMN IF NOT EXISTS address_street TEXT,
        ADD COLUMN IF NOT EXISTS address_soi TEXT,
        ADD COLUMN IF NOT EXISTS address_trok TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS address_trok,
        DROP COLUMN IF EXISTS address_soi,
        DROP COLUMN IF EXISTS address_street,
        DROP COLUMN IF EXISTS address_village_no
    `);
  }
}
