import type { MigrationInterface, QueryRunner } from 'typeorm';
import { runBuraphaConsecutiveAbsences } from '../burapha-presentation-reset';

/**
 * Presentation data for the ขาดติดต่อกัน rule (owner, 2026-10-15): every
 * current Burapha student is absent on 14 and 15 Oct and nowhere else after
 * their latest closed case, so one more absent day opens a case. Data only;
 * skipped without the school, rolled back and logged on failure, irreversible.
 */
export class SetBuraphaConsecutiveAbsences20261015160000 implements MigrationInterface {
  name = 'SetBuraphaConsecutiveAbsences20261015160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runBuraphaConsecutiveAbsences(queryRunner, 'SetBuraphaConsecutiveAbsences');
  }

  public async down(): Promise<void> {
    // Data reset; the previous absence pattern is not kept.
  }
}
