import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The case SLA reminder was removed with the legacy task flows: the service and
 * cron that claimed cases at 80% elapsed and on breach are gone, and so are the
 * notifications they sent. What stayed behind was `CASE_SLA_HIGH_DAYS` on the
 * settings page, still promising an alert nobody sends, and a `sla_due_at`
 * written on every auto-opened case that nothing reads. A setting that claims a
 * behaviour the system no longer has is worse than no setting, so the key goes.
 *
 * The `sla_due_at` column and its indexes stay for now — dropping them discards
 * the due dates of existing cases, which is not reversible by a `down()`.
 */
const SETTING = {
  key: 'CASE_SLA_HIGH_DAYS',
  value: '3',
  description: 'จำนวนวันสำหรับดำเนินการครั้งแรกของเคสความเสี่ยงสูง',
};

export class RetireCaseSlaSetting20260831100000 implements MigrationInterface {
  name = 'RetireCaseSlaSetting20260831100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM system_settings WHERE setting_key = $1`, [SETTING.key]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        INSERT INTO system_settings (setting_key, setting_value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (setting_key) DO NOTHING
      `,
      [SETTING.key, SETTING.value, SETTING.description],
    );
  }
}
