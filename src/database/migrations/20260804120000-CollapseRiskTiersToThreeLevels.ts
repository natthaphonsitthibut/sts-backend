import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Risk becomes three levels — เสี่ยง / เฝ้าระวัง / ปกติ — driven by two rules
 * (owner decision 2026-08-04):
 *
 * 1. เสี่ยง = ขาดเรียนสะสมถึงเกณฑ์ (default 3 วัน, ไม่ต้องติดต่อกัน). A day counts
 *    as ขาด only when every measured record that day is unattended, the same
 *    verdict ประวัติการเข้าเรียน shows (ลา is not measured; มา/สาย both attend).
 * 2. เฝ้าระวัง = มีความคิดเห็นจากครู (classroom note or recorded observation).
 *
 * LOW/MEDIUM disappear, and with them the settings that fed the old ladder plus
 * the subject-risk rules that opened cases on their own. Existing profile rows
 * are neutralised here and recomputed by the risk-profile recalculation that
 * runs after deploy, so no row is left claiming a tier that no longer exists.
 *
 * `cases.risk_tier` keeps its old CHECK: historical cases opened at LOW/MEDIUM
 * stay truthful about why they were opened, and only 'HIGH' is written from now
 * on. Open cases created by the retired rules are left alone — closing someone
 * else's active case is not this migration's call.
 */
const RETIRED_SETTING_KEYS = [
  'CASE_RISK_LOW_ABSENCE_DAYS',
  'CASE_RISK_MEDIUM_ABSENCE_DAYS',
  'CASE_RISK_HIGH_ATTENDANCE_PERCENT',
  'CASE_RISK_TERM_ABSENCE_DAYS',
  'CASE_SLA_MEDIUM_DAYS',
  'CASE_SLA_LOW_DAYS',
  'SUBJECT_RISK_MIXED_ABSENCE_WINDOW_DAYS',
  'SUBJECT_RISK_MIXED_ABSENCE_DAYS',
  'SUBJECT_RISK_AVOIDANCE_WINDOW_DAYS',
  'SUBJECT_RISK_AVOIDANCE_CONSECUTIVE_PERIODS',
  'SUBJECT_RISK_AVOIDANCE_ABSENT_PERCENT',
  'SUBJECT_RISK_LATE_WINDOW_DAYS',
  'SUBJECT_RISK_LATE_WATCH_COUNT',
  'TEACHER_ACCESS_DEFAULT_EXPIRY_POLICY',
  'TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY',
];
const CHANGED_SETTING_KEYS = [
  'CASE_RISK_HIGH_ABSENCE_DAYS',
  'CASE_SLA_HIGH_DAYS',
  ...RETIRED_SETTING_KEYS,
];

export class CollapseRiskTiersToThreeLevels20260804120000 implements MigrationInterface {
  name = 'CollapseRiskTiersToThreeLevels20260804120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Preserve the exact operator-tuned values and the exact profile values
    // this migration transforms. These bounded rollback tables deliberately
    // have no FKs: a student may be legitimately deleted while the new version
    // is live, and that must not make an application rollback impossible.
    await queryRunner.query(`
      CREATE TABLE migration_20260804_risk_setting_backup (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        description TEXT NULL,
        updated_at TIMESTAMP NULL
      )
    `);
    await queryRunner.query(
      `
        INSERT INTO migration_20260804_risk_setting_backup (
          setting_key, setting_value, description, updated_at
        )
        SELECT setting_key, setting_value, description, updated_at
        FROM system_settings
        WHERE setting_key = ANY($1::text[])
      `,
      [CHANGED_SETTING_KEYS],
    );
    await queryRunner.query(`
      CREATE TABLE migration_20260804_risk_profile_backup (
        student_uuid UUID PRIMARY KEY,
        risk_tier VARCHAR(16) NOT NULL,
        risk_severity SMALLINT NOT NULL,
        risk_score NUMERIC(10,4) NOT NULL,
        source_updated_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      INSERT INTO migration_20260804_risk_profile_backup (
        student_uuid, risk_tier, risk_severity, risk_score, source_updated_at, updated_at
      )
      SELECT student_uuid, risk_tier, risk_severity, risk_score, source_updated_at, updated_at
      FROM student_risk_profiles
      WHERE risk_tier IN ('LOW', 'MEDIUM') OR risk_severity > 2;
    `);

    // The single surviving threshold changes meaning (streak → cumulative), so
    // it is reset to the agreed default instead of keeping a streak-era number.
    await queryRunner.query(
      `
        INSERT INTO system_settings (setting_key, setting_value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (setting_key) DO UPDATE
          SET setting_value = EXCLUDED.setting_value,
              description = EXCLUDED.description
      `,
      [
        'CASE_RISK_HIGH_ABSENCE_DAYS',
        '3',
        'จำนวนวันขาดเรียนสะสม (ไม่ต้องติดต่อกัน) ที่ทำให้นักเรียนเป็นความเสี่ยงและเปิดเคสอัตโนมัติ — นับเป็นวันขาดเมื่อไม่เข้าเรียนทุกคาบที่บันทึกในวันนั้น',
      ],
    );
    await queryRunner.query(
      `
        UPDATE system_settings
        SET description = $2
        WHERE setting_key = $1
      `,
      [
        'CASE_SLA_HIGH_DAYS',
        'เคสที่เปิดอัตโนมัติต้องมีการดำเนินการครั้งแรกภายในกี่วันปฏิทินนับจากวันเปิดเคส (ระบบแจ้งเตือนเมื่อใช้เวลาไปแล้ว 80%)',
      ],
    );
    await queryRunner.query(`DELETE FROM system_settings WHERE setting_key = ANY($1::text[])`, [
      RETIRED_SETTING_KEYS,
    ]);

    // Backfill: LOW/MEDIUM rows are demoted to NORMAL and their severity/score
    // zeroed, then `source_updated_at` is cleared so the recalculation cannot
    // skip them via its "nothing moved" guard.
    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
        DROP CONSTRAINT IF EXISTS chk_student_risk_profiles_tier;
      UPDATE student_risk_profiles
      SET risk_tier = 'NORMAL',
          risk_severity = 0,
          risk_score = 0,
          source_updated_at = NULL,
          updated_at = now()
      WHERE risk_tier IN ('LOW', 'MEDIUM');
      ALTER TABLE student_risk_profiles
        ADD CONSTRAINT chk_student_risk_profiles_tier
        CHECK (risk_tier IN ('HIGH', 'WATCH', 'NORMAL'));
    `);

    // Severity now tops out at 2 (HIGH); keep the CHECK honest about the range.
    await queryRunner.query(`
      UPDATE student_risk_profiles SET risk_severity = 2 WHERE risk_severity > 2;
      ALTER TABLE student_risk_profiles
        DROP CONSTRAINT IF EXISTS chk_student_risk_profiles_severity;
      ALTER TABLE student_risk_profiles
        ADD CONSTRAINT chk_student_risk_profiles_severity
        CHECK (risk_severity BETWEEN 0 AND 2);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
        DROP CONSTRAINT IF EXISTS chk_student_risk_profiles_severity;
      ALTER TABLE student_risk_profiles
        ADD CONSTRAINT chk_student_risk_profiles_severity
        CHECK (risk_severity BETWEEN 0 AND 4);
      ALTER TABLE student_risk_profiles
        DROP CONSTRAINT IF EXISTS chk_student_risk_profiles_tier;
      ALTER TABLE student_risk_profiles
        ADD CONSTRAINT chk_student_risk_profiles_tier
        CHECK (risk_tier IN ('HIGH', 'MEDIUM', 'LOW', 'WATCH', 'NORMAL'));
    `);

    await queryRunner.query(`DELETE FROM system_settings WHERE setting_key = ANY($1::text[])`, [
      CHANGED_SETTING_KEYS,
    ]);
    await queryRunner.query(`
      INSERT INTO system_settings (setting_key, setting_value, description, updated_at)
      SELECT setting_key, setting_value, description, updated_at
      FROM migration_20260804_risk_setting_backup;

      UPDATE student_risk_profiles profile
      SET risk_tier = backup.risk_tier,
          risk_severity = backup.risk_severity,
          risk_score = backup.risk_score,
          source_updated_at = backup.source_updated_at,
          updated_at = backup.updated_at
      FROM migration_20260804_risk_profile_backup backup
      WHERE profile.student_uuid = backup.student_uuid;

      DROP TABLE migration_20260804_risk_profile_backup;
      DROP TABLE migration_20260804_risk_setting_backup;
    `);
  }
}
