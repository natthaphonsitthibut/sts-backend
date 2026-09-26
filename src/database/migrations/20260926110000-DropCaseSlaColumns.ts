import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop the case SLA columns left behind by the retired SLA reminder.
 *
 * `RetireCaseSlaSetting20260831100000` removed the setting and kept the columns
 * so existing due dates would not be lost. Nothing writes them any more, the
 * only reader was the case export, and the values (155 cases on production,
 * all before 2026-08-19) were archived to `data/backups/cases-sla-columns-*`
 * before this ran. The two partial indexes go with the columns.
 */
export class DropCaseSlaColumns20260926110000 implements MigrationInterface {
  name = 'DropCaseSlaColumns20260926110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cases_sla_breach_due`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cases_sla_warning_due`);
    await queryRunner.query(`
      ALTER TABLE cases
        DROP COLUMN IF EXISTS sla_due_at,
        DROP COLUMN IF EXISTS sla_warning_notified_at,
        DROP COLUMN IF EXISTS sla_breached_notified_at
    `);
  }

  // Restores the structure only; the values live in the archive.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE cases
        ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS sla_warning_notified_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS sla_breached_notified_at TIMESTAMPTZ
    `);
  }
}
