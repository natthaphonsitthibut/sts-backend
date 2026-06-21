import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extend soft-delete to the rest of the task tree so the admin "delete task"
 * action can tombstone instead of hard-deleting. `task_links` already got
 * deleted_at/deleted_by in 20260620123000; this adds the same columns to
 * `tasks` and `task_submissions` (home-visit reports) so a deleted task's
 * delegation chain and report history survive for audit and recovery.
 *
 * Shape matches AUDIT_COLUMNS_SQL: nullable TIMESTAMPTZ + nullable FK
 * users(id) ON DELETE SET NULL. Additive, idempotent, reversible.
 */
export class AddTaskTreeSoftDelete20260621122000 implements MigrationInterface {
  name = 'AddTaskTreeSoftDelete20260621122000';

  private static readonly TABLES = ['tasks', 'task_submissions'] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of AddTaskTreeSoftDelete20260621122000.TABLES) {
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of AddTaskTreeSoftDelete20260621122000.TABLES) {
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by`,
      );
    }
  }
}
