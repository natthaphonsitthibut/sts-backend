import type { MigrationInterface, QueryRunner } from 'typeorm';

const MANAGE_SCHOOLS_PERMISSION = 'manage-schools';
const MANAGE_SCHOOLS_DEFAULT_ROLES = ['ADMIN', 'DIRECTOR'] as const;

export class HardenSchoolMasterData20260714180000 implements MigrationInterface {
  name = 'HardenSchoolMasterData20260714180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE schools
        ADD COLUMN IF NOT EXISTS school_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE';

      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_schools_status'
            AND conrelid = 'schools'::regclass
        ) THEN
          ALTER TABLE schools
            ADD CONSTRAINT chk_schools_status
            CHECK (school_status IN ('ACTIVE', 'INACTIVE'));
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_schools_status_geo
        ON schools (school_status, province, district, sub_district, id);
    `);

    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = ANY($2::text[])
          AND NOT (default_permissions ? $3)
      `,
      [
        JSON.stringify([MANAGE_SCHOOLS_PERMISSION]),
        MANAGE_SCHOOLS_DEFAULT_ROLES,
        MANAGE_SCHOOLS_PERMISSION,
      ],
    );

    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE role = ANY($2::text[])
          AND jsonb_typeof(permissions) = 'array'
          AND permissions ? 'settings'
          AND NOT (permissions ? $3)
      `,
      [
        JSON.stringify([MANAGE_SCHOOLS_PERMISSION]),
        MANAGE_SCHOOLS_DEFAULT_ROLES,
        MANAGE_SCHOOLS_PERMISSION,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions - $1
        WHERE role = ANY($2::text[])
          AND jsonb_typeof(permissions) = 'array'
      `,
      [MANAGE_SCHOOLS_PERMISSION, MANAGE_SCHOOLS_DEFAULT_ROLES],
    );

    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions - $1
        WHERE name = ANY($2::text[])
      `,
      [MANAGE_SCHOOLS_PERMISSION, MANAGE_SCHOOLS_DEFAULT_ROLES],
    );

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_schools_status_geo;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS chk_schools_status;
      ALTER TABLE schools DROP COLUMN IF EXISTS school_status;
    `);
  }
}
