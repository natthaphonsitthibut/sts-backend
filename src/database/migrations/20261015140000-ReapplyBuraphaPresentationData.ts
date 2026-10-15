import type { MigrationInterface, QueryRunner } from 'typeorm';
import { RESET_SQL } from './20261015130000-ResetBuraphaPresentationData';

/**
 * Runs the Burapha presentation reset again (owner, 2026-10-15). The first run
 * rolled back on production because it tried to back-date an append-only
 * audit row; the reset no longer touches audit history, and it now records
 * every check-in round under the classroom's homeroom teacher and moves
 * assignments held by a test account to the student's homeroom teacher.
 * Same guards as the first migration: skipped without the school, rolled back
 * and logged on failure, irreversible.
 */
export class ReapplyBuraphaPresentationData20261015140000 implements MigrationInterface {
  name = 'ReapplyBuraphaPresentationData20261015140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const ready = (await queryRunner.query(`
      SELECT 1
      FROM school_terms term
      JOIN users director ON director.username = 'burapha.director'
      JOIN users admin ON admin.username = 'burapha.admin'
      WHERE term.school_id = 10010004 AND term.status = 'ACTIVE' AND term.deleted_at IS NULL
    `)) as unknown[];
    if (ready.length !== 1) return;
    await queryRunner.query('SAVEPOINT reapply_burapha_presentation');
    try {
      await queryRunner.query(RESET_SQL);
      await queryRunner.query('RELEASE SAVEPOINT reapply_burapha_presentation');
    } catch (error) {
      await queryRunner.query('ROLLBACK TO SAVEPOINT reapply_burapha_presentation');
      console.error(
        `ReapplyBuraphaPresentationData skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async down(): Promise<void> {
    // Data reset; the previous case and attendance state is not kept.
  }
}
