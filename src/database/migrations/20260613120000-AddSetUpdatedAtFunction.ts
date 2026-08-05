import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Installs the shared `set_updated_at()` trigger function used by the
 * audit-columns standard (Phase 1). Additive and idempotent — no table is
 * altered here; new audited tables attach it via a BEFORE UPDATE trigger.
 */
export class AddSetUpdatedAtFunction20260613120000 implements MigrationInterface {
  name = 'AddSetUpdatedAtFunction20260613120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS trigger AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Safe to drop only while no trigger depends on it (true in Phase 1).
    await queryRunner.query(`DROP FUNCTION IF EXISTS set_updated_at();`);
  }
}
