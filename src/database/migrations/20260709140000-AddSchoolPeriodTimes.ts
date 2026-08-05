import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * Per-school, per-day period bell schedule — replaces the frontend-hardcoded
 * `PERIOD_TIME_LABELS` constant (see tasks/task-ui-data-feedback-round.md §C
 * follow-up). Keyed by (school_id, day_of_week, period) because bell
 * schedules genuinely differ by school and can differ by day (e.g. a longer
 * Monday flag-ceremony period, early Friday dismissal). `source` mirrors the
 * `school_calendar_days` generate-then-override pattern already in this repo.
 */
export class AddSchoolPeriodTimes20260709140000 implements MigrationInterface {
  name = 'AddSchoolPeriodTimes20260709140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS school_period_times (
        id BIGSERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL
          CONSTRAINT fk_school_period_times_school
          REFERENCES schools(id) ON DELETE RESTRICT,
        day_of_week SMALLINT NOT NULL,
        period SMALLINT NOT NULL,
        starts_at TIME NOT NULL,
        ends_at TIME NOT NULL,
        source VARCHAR(16) NOT NULL DEFAULT 'GENERATED',
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_school_period_times_day_of_week CHECK (day_of_week BETWEEN 1 AND 7),
        CONSTRAINT chk_school_period_times_period CHECK (period BETWEEN 1 AND 20),
        CONSTRAINT chk_school_period_times_time_range CHECK (starts_at < ends_at),
        CONSTRAINT chk_school_period_times_source
          CHECK (source IN ('GENERATED', 'MANUAL', 'BACKFILL'))
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('school_period_times'));
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_school_period_times_slot
        ON school_period_times (school_id, day_of_week, period)
        WHERE deleted_at IS NULL
    `);

    // Backfill every existing school with the current hardcoded schedule
    // (08:30-09:20 ... 15:30-16:20, 8 periods, Mon-Fri) so deployment day
    // renders identically to today — zero regression window. Admins can
    // regenerate/override per-school afterward.
    const periods = [
      ['08:30', '09:20'],
      ['09:20', '10:10'],
      ['10:10', '11:00'],
      ['11:00', '11:50'],
      ['13:00', '13:50'],
      ['13:50', '14:40'],
      ['14:40', '15:30'],
      ['15:30', '16:20'],
    ];
    const schools = (await queryRunner.query(`SELECT id FROM schools`)) as Array<{
      id: number;
    }>;

    for (const school of schools) {
      for (let day = 1; day <= 5; day += 1) {
        for (let i = 0; i < periods.length; i += 1) {
          const [startsAt, endsAt] = periods[i];
          await queryRunner.query(
            `
              INSERT INTO school_period_times (school_id, day_of_week, period, starts_at, ends_at, source)
              VALUES ($1, $2, $3, $4, $5, 'BACKFILL')
              ON CONFLICT (school_id, day_of_week, period) WHERE deleted_at IS NULL DO NOTHING
            `,
            [school.id, day, i + 1, startsAt, endsAt],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_school_period_times_slot`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_school_period_times_set_updated_at ON school_period_times`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS school_period_times`);
  }
}
