import type { MigrationInterface, QueryRunner } from 'typeorm';
import { runBuraphaReset } from '../burapha-presentation-reset';

/**
 * Third run of the Burapha presentation reset (owner, 2026-10-15). The second
 * run rolled back on production because a day with a check-in round that was
 * started and never submitted got a second round for the same subject; the
 * reset now leaves any day that already has a round as it is.
 */
export class RetryBuraphaPresentationData20261015150000 implements MigrationInterface {
  name = 'RetryBuraphaPresentationData20261015150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runBuraphaReset(queryRunner, 'RetryBuraphaPresentationData');
  }

  public async down(): Promise<void> {
    // Data reset; the previous case and attendance state is not kept.
  }
}
