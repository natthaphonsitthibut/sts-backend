import type { MigrationInterface, QueryRunner } from 'typeorm';
import { runBuraphaReset } from '../burapha-presentation-reset';

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
    await runBuraphaReset(queryRunner, 'ReapplyBuraphaPresentationData');
  }

  public async down(): Promise<void> {
    // Data reset; the previous case and attendance state is not kept.
  }
}
