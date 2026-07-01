import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EXPAND — self-editable user profile contact fields.
 *
 * All columns are nullable TEXT profile values owned by the users row itself.
 * Coordinates are nullable DOUBLE PRECISION values and must be present as a
 * valid pair. They do not reference master-data tables, so no FK is required.
 * Existing rows remain valid and can be backfilled by users through /users/me.
 */
export class AddUserProfileContactFields20260701150000 implements MigrationInterface {
  name = 'AddUserProfileContactFields20260701150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS line_id TEXT,
        ADD COLUMN IF NOT EXISTS address_line TEXT,
        ADD COLUMN IF NOT EXISTS address_sub_district TEXT,
        ADD COLUMN IF NOT EXISTS address_district TEXT,
        ADD COLUMN IF NOT EXISTS address_province TEXT,
        ADD COLUMN IF NOT EXISTS address_postal_code TEXT,
        ADD COLUMN IF NOT EXISTS address_latitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS address_longitude DOUBLE PRECISION
    `);

    await queryRunner.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_address_postal_code
    `);
    await queryRunner.query(`
      ALTER TABLE users
        ADD CONSTRAINT chk_users_address_postal_code
        CHECK (address_postal_code IS NULL OR address_postal_code ~ '^[0-9]{5}$') NOT VALID
    `);
    await queryRunner.query(`
      ALTER TABLE users VALIDATE CONSTRAINT chk_users_address_postal_code
    `);
    await queryRunner.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_address_coordinates
    `);
    await queryRunner.query(`
      ALTER TABLE users
        ADD CONSTRAINT chk_users_address_coordinates
        CHECK (
          (address_latitude IS NULL AND address_longitude IS NULL)
          OR (
            address_latitude BETWEEN -90 AND 90
            AND address_longitude BETWEEN -180 AND 180
          )
        ) NOT VALID
    `);
    await queryRunner.query(`
      ALTER TABLE users VALIDATE CONSTRAINT chk_users_address_coordinates
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_address_coordinates
    `);
    await queryRunner.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_address_postal_code
    `);
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS address_longitude,
        DROP COLUMN IF EXISTS address_latitude,
        DROP COLUMN IF EXISTS address_postal_code,
        DROP COLUMN IF EXISTS address_province,
        DROP COLUMN IF EXISTS address_district,
        DROP COLUMN IF EXISTS address_sub_district,
        DROP COLUMN IF EXISTS address_line,
        DROP COLUMN IF EXISTS line_id
    `);
  }
}
