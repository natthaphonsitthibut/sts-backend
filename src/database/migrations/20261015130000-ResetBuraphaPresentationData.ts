import type { MigrationInterface, QueryRunner } from 'typeorm';
import { runBuraphaReset } from '../burapha-presentation-reset';

/**
 * Presentation data for โรงเรียนบูรพา (owner, 2026-10-15) — data only, no
 * schema. Every open case is closed through the normal workflow (teacher
 * report, director close) or, for auto-opened cases nobody worked on,
 * cancelled the way the absence monitor does when attendance is corrected;
 * open watches are closed by the director; attendance is filled for every
 * school day 2026-08-11..2026-10-15 from each classroom's own weekly timetable
 * and every current student is absent exactly two full days after their
 * latest closed case, so one more absence opens a case. The term is extended
 * to 2026-10-31 so check-ins after 10 Oct are accepted.
 *
 * Safe to run again (it only touches what is still open or missing) and
 * skipped on databases without the school, director, or active term. A
 * failure rolls the reset back and is logged instead of failing the deploy.
 * Irreversible: down() does nothing.
 */
export class ResetBuraphaPresentationData20261015130000 implements MigrationInterface {
  name = 'ResetBuraphaPresentationData20261015130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runBuraphaReset(queryRunner, 'ResetBuraphaPresentationData');
  }

  public async down(): Promise<void> {
    // Data reset; the previous case and attendance state is not kept.
  }
}
