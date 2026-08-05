import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add standard soft-delete audit columns to the remaining tables that need
 * tombstone metadata. These match AUDIT_COLUMNS_SQL exactly for deleted_at /
 * deleted_by: nullable TIMESTAMPTZ plus nullable FK users(id) ON DELETE SET NULL.
 *
 * Additive, idempotent, and reversible. Query/service behavior is handled
 * separately; this migration only creates the columns.
 */
export class AddSoftDeleteColumns20260620123000 implements MigrationInterface {
  name = 'AddSoftDeleteColumns20260620123000';

  private static readonly TABLES = [
    'cases',
    'student_term',
    'student_dropouts',
    'task_links',
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of AddSoftDeleteColumns20260620123000.TABLES) {
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of AddSoftDeleteColumns20260620123000.TABLES) {
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by`,
      );
    }
  }
}
