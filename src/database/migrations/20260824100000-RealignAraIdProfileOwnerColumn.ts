import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repairs schema drift on `araid_profiles`.
 *
 * 20260811120000 created the column as `created_by_user_id`, and the entity,
 * the bootstrap catalog and every query still call it that. The development
 * databases carry `managed_by_user_id` instead — renamed outside a migration,
 * so a database built from migrations and a database that has been running
 * disagree. Nothing in the codebase refers to the newer name, which is how the
 * drift stayed invisible: the AraID tables are empty, so no read ever ran.
 *
 * The first read does fail — `column AraIdProfileEntity.created_by_user_id does
 * not exist` — which is what the staff AraID login hits the moment a profile
 * exists. This renames the drifted column (and its foreign key) back to the
 * name the code has always used, and does nothing where no drift exists.
 *
 * `down()` is intentionally empty: the column name this restores is the one the
 * schema was created with, so there is nothing to go back to.
 */
export class RealignAraIdProfileOwnerColumn20260824100000 implements MigrationInterface {
  name = 'RealignAraIdProfileOwnerColumn20260824100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'araid_profiles' AND column_name = 'managed_by_user_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'araid_profiles' AND column_name = 'created_by_user_id'
        ) THEN
          ALTER TABLE araid_profiles RENAME COLUMN managed_by_user_id TO created_by_user_id;
        END IF;
      END $$
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_araid_profiles_managed_by')
          AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_araid_profiles_created_by')
        THEN
          ALTER TABLE araid_profiles
            RENAME CONSTRAINT fk_araid_profiles_managed_by TO fk_araid_profiles_created_by;
        END IF;
      END $$
    `);
  }

  public async down(): Promise<void> {
    // No-op: see the class comment.
  }
}
