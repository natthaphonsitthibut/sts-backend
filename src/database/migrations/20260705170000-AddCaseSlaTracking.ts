import type { MigrationInterface, QueryRunner } from 'typeorm';

const NOTIFICATION_TYPES = [
  {
    code: 'CASE_SLA_WARNING',
    label: 'เคสใกล้เกินกำหนดดำเนินการ',
    permission: 'review-cases',
    sortOrder: 130,
  },
  {
    code: 'CASE_SLA_BREACHED',
    label: 'เคสเกินกำหนดดำเนินการ',
    permission: 'review-cases',
    sortOrder: 140,
  },
];

const SYSTEM_SETTINGS = [
  {
    key: 'CASE_RISK_HIGH_ABSENCE_DAYS',
    value: '7',
    description: 'จำนวนวันขาดเรียนติดต่อกันที่จัดเป็นเคสความเสี่ยงสูง',
  },
  {
    key: 'CASE_RISK_MEDIUM_ABSENCE_DAYS',
    value: '5',
    description: 'จำนวนวันขาดเรียนติดต่อกันที่จัดเป็นเคสความเสี่ยงปานกลาง',
  },
  {
    key: 'CASE_SLA_HIGH_DAYS',
    value: '3',
    description: 'จำนวนวันสำหรับดำเนินการครั้งแรกของเคสความเสี่ยงสูง',
  },
  {
    key: 'CASE_SLA_MEDIUM_DAYS',
    value: '7',
    description: 'จำนวนวันสำหรับดำเนินการครั้งแรกของเคสความเสี่ยงปานกลาง',
  },
  {
    key: 'CASE_SLA_LOW_DAYS',
    value: '14',
    description: 'จำนวนวันสำหรับดำเนินการครั้งแรกของเคสความเสี่ยงต่ำ',
  },
];

export class AddCaseSlaTracking20260705170000 implements MigrationInterface {
  name = 'AddCaseSlaTracking20260705170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE cases
        ADD COLUMN IF NOT EXISTS risk_tier VARCHAR(10),
        ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS sla_warning_notified_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS sla_breached_notified_at TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE cases
        DROP CONSTRAINT IF EXISTS chk_cases_risk_tier
    `);
    await queryRunner.query(`
      ALTER TABLE cases
        ADD CONSTRAINT chk_cases_risk_tier
        CHECK (risk_tier IS NULL OR risk_tier IN ('HIGH', 'MEDIUM', 'LOW'))
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cases_sla_warning_due
        ON cases (sla_warning_notified_at, sla_due_at)
        WHERE deleted_at IS NULL
          AND sla_due_at IS NOT NULL
          AND sla_warning_notified_at IS NULL
          AND status NOT IN ('RESOLVED', 'CANCELLED')
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cases_sla_breach_due
        ON cases (sla_breached_notified_at, sla_due_at)
        WHERE deleted_at IS NULL
          AND sla_due_at IS NOT NULL
          AND sla_breached_notified_at IS NULL
          AND status NOT IN ('RESOLVED', 'CANCELLED')
    `);
    await queryRunner.query(
      `
      INSERT INTO notification_types (code, label_th, required_permission, sort_order)
      VALUES ${NOTIFICATION_TYPES.map((_, index) => {
        const offset = index * 4;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
      }).join(', ')}
      ON CONFLICT (code) DO NOTHING
    `,
      NOTIFICATION_TYPES.flatMap((type) => [
        type.code,
        type.label,
        type.permission,
        type.sortOrder,
      ]),
    );
    await queryRunner.query(
      `
      INSERT INTO system_settings (setting_key, setting_value, description)
      VALUES ${SYSTEM_SETTINGS.map((_, index) => {
        const offset = index * 3;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
      }).join(', ')}
      ON CONFLICT (setting_key) DO NOTHING
    `,
      SYSTEM_SETTINGS.flatMap((setting) => [setting.key, setting.value, setting.description]),
    );
    await queryRunner.query(`
      UPDATE cases
      SET
        risk_tier = 'LOW',
        sla_due_at = created_at + INTERVAL '14 days'
      WHERE deleted_at IS NULL
        AND status NOT IN ('RESOLVED', 'CANCELLED')
        AND sla_due_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM notifications WHERE type_code = ANY($1::varchar[])`, [
      NOTIFICATION_TYPES.map((type) => type.code),
    ]);
    await queryRunner.query(`DELETE FROM notification_types WHERE code = ANY($1::varchar[])`, [
      NOTIFICATION_TYPES.map((type) => type.code),
    ]);
    await queryRunner.query(`DELETE FROM system_settings WHERE setting_key = ANY($1::text[])`, [
      SYSTEM_SETTINGS.map((setting) => setting.key),
    ]);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cases_sla_breach_due`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cases_sla_warning_due`);
    await queryRunner.query(`ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_cases_risk_tier`);
    await queryRunner.query(`
      ALTER TABLE cases
        DROP COLUMN IF EXISTS sla_breached_notified_at,
        DROP COLUMN IF EXISTS sla_warning_notified_at,
        DROP COLUMN IF EXISTS sla_due_at,
        DROP COLUMN IF EXISTS risk_tier
    `);
  }
}
