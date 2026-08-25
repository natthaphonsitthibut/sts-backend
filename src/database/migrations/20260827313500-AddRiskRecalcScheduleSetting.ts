import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The daily safety-net recalculation used to run at a time hardcoded in the
 * service, so moving it needed a deploy. When the system does its heavy work is
 * operational policy, not an internal tuning constant, so it joins the other
 * operator-tunable values in `system_settings` and is edited from the settings
 * page like the absence-monitor schedule next to it.
 */
const SETTING = {
  key: 'RISK_RECALC_SCHEDULE_TIME',
  value: '05:10',
  description:
    'เวลาคำนวณระดับความเสี่ยงของนักเรียนใหม่ทั้งระบบประจำวัน (HH:MM) — เป็นตาข่ายกันพลาดสำหรับกรณีที่การคำนวณรายเหตุการณ์หลุดไป ควรตั้งก่อนเวลาเริ่มเรียน',
};

export class AddRiskRecalcScheduleSetting20260827313500 implements MigrationInterface {
  name = 'AddRiskRecalcScheduleSetting20260827313500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        INSERT INTO system_settings (setting_key, setting_value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (setting_key) DO NOTHING
      `,
      [SETTING.key, SETTING.value, SETTING.description],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM system_settings WHERE setting_key = $1`, [SETTING.key]);
  }
}
