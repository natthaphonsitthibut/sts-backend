import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_RETROFIT_SQL, AUDIT_RETROFIT_TABLES } from '../bootstrap-sql';

/**
 * Phase 2a — retrofit the standard audit columns onto existing CRUD tables.
 * Additive and reversible: adds created_at/updated_at (timestamptz) +
 * created_by/updated_by (FK users) + the updated_at trigger, normalizes legacy
 * `timestamp` columns to `timestamptz`, and backfills. Also renames the legacy
 * `task_links.created_by_user_id` to the standard `created_by`.
 * Soft-delete (deleted_at/by) is intentionally deferred to Phase 2b.
 */
export class AddAuditColumnsPhase2a20260613130000 implements MigrationInterface {
  name = 'AddAuditColumnsPhase2a20260613130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Standardize the legacy actor column name first so the retrofit below
    // sees `created_by` and skips re-adding it. Guarded for idempotency.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'task_links' AND column_name = 'created_by_user_id'
        ) THEN
          ALTER TABLE task_links RENAME COLUMN created_by_user_id TO created_by;
        END IF;
      END $$;
    `);

    await queryRunner.query(AUDIT_RETROFIT_SQL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of AUDIT_RETROFIT_TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS trg_${table}_set_updated_at ON ${table}`);
      if (table === 'task_links') {
        // created_by here came from a RENAME, not an add — keep the data, just
        // drop the generically-added updated_by.
        await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS updated_by`);
      } else {
        await queryRunner.query(
          `ALTER TABLE ${table} DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS updated_by`,
        );
      }
    }
    // Revert the task_links column rename.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'task_links' AND column_name = 'created_by'
        ) THEN
          ALTER TABLE task_links RENAME COLUMN created_by TO created_by_user_id;
        END IF;
      END $$;
    `);
    // created_at/updated_at columns are intentionally left in place — dropping
    // them would lose timestamps; removing the trigger reverts the behavior.
  }
}
