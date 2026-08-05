import type { MigrationInterface, QueryRunner } from 'typeorm';

const OLD_KEY = 'ABSENT_THRESHOLD_DAYS';
const NEW_KEY = 'CASE_RISK_LOW_ABSENCE_DAYS';

const OLD_DESCRIPTION = 'จำนวนวันขาดเรียนติดต่อกันก่อนที่จะแจ้งเตือนหรือเปิดเคสอัตโนมัติ';
const NEW_DESCRIPTION =
  'จำนวนวันขาดเรียนติดต่อกันที่ระบบเปิดเคสอัตโนมัติ โดยเริ่มที่ระดับความเสี่ยงต่ำ (ขั้นแรกของบันไดความเสี่ยงต่ำ → ปานกลาง → สูง)';

/**
 * The case-open threshold IS the low tier of the risk ladder, so it moves into
 * the CASE_RISK_* family (value is preserved). Runtime descriptions come from
 * the settings catalog; the stored description is refreshed here only so the
 * table itself stays readable.
 */
export class RenameAbsentThresholdSetting20260706120000 implements MigrationInterface {
  name = 'RenameAbsentThresholdSetting20260706120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE system_settings
        SET setting_key = $1, description = $2
        WHERE setting_key = $3
          AND NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = $1)
      `,
      [NEW_KEY, NEW_DESCRIPTION, OLD_KEY],
    );
    // Fresh databases seeded after the SLA migration may lack the row entirely.
    await queryRunner.query(
      `
        INSERT INTO system_settings (setting_key, setting_value, description)
        SELECT $1, '3', $2
        WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = $1)
      `,
      [NEW_KEY, NEW_DESCRIPTION],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE system_settings
        SET setting_key = $1, description = $2
        WHERE setting_key = $3
          AND NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = $1)
      `,
      [OLD_KEY, OLD_DESCRIPTION, NEW_KEY],
    );
  }
}
