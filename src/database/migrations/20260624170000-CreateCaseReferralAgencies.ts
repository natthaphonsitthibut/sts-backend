import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const AGENCY_TYPES = "'HOSPITAL', 'POLICE', 'SOCIAL_WELFARE', 'NGO', 'EDUCATION', 'OTHER'";
const REFERRAL_STATUSES = "'SENT', 'ACKNOWLEDGED', 'ACCEPTED', 'DECLINED', 'RETURNED'";

/**
 * EXPAND — table-driven external agency referrals for case FORWARD actions.
 *
 * `external_agencies` is the mock/demo catalog. `case_referrals` is immutable
 * referral history for each case. The referral row stores agency snapshots so
 * history remains readable even if the mock catalog entry is later edited or
 * disabled.
 */
export class CreateCaseReferralAgencies20260624170000 implements MigrationInterface {
  name = 'CreateCaseReferralAgencies20260624170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS external_agencies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        agency_type TEXT NOT NULL,
        province TEXT,
        district TEXT,
        sub_district TEXT,
        phone TEXT,
        contact_person TEXT,
        address TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_external_agencies_type
          CHECK (agency_type IN (${AGENCY_TYPES}))
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('external_agencies'));
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_external_agencies_scope
        ON external_agencies (province, district, sub_district)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_external_agencies_type_active
        ON external_agencies (agency_type, is_active)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS case_referrals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        agency_id INTEGER REFERENCES external_agencies(id) ON DELETE SET NULL,
        agency_name_snapshot TEXT NOT NULL,
        agency_type_snapshot TEXT NOT NULL,
        referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        referred_by_label TEXT,
        referred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        referral_note TEXT,
        status TEXT NOT NULL DEFAULT 'SENT',
        outcome TEXT,
        responded_at TIMESTAMPTZ,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_case_referrals_status
          CHECK (status IN (${REFERRAL_STATUSES})),
        CONSTRAINT chk_case_referrals_agency_type
          CHECK (agency_type_snapshot IN (${AGENCY_TYPES}))
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('case_referrals'));
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_case_referrals_case
        ON case_referrals (case_id, referred_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_case_referrals_agency
        ON case_referrals (agency_id)
    `);

    await queryRunner.query(`
      INSERT INTO external_agencies
        (name, agency_type, province, district, sub_district, phone, contact_person, address)
      SELECT *
      FROM (
        VALUES
          ('โรงพยาบาลส่งเสริมสุขภาพตำบลดุสิต', 'HOSPITAL', 'กรุงเทพมหานคร', 'ดุสิต', 'ดุสิต', '02-000-0001', 'เจ้าหน้าที่รับส่งต่อ', 'ดุสิต กรุงเทพมหานคร'),
          ('สถานีตำรวจนครบาลดุสิต', 'POLICE', 'กรุงเทพมหานคร', 'ดุสิต', 'ดุสิต', '02-000-0002', 'งานป้องกันและปราบปราม', 'ดุสิต กรุงเทพมหานคร'),
          ('สำนักงานพัฒนาสังคมและความมั่นคงของมนุษย์จังหวัดกรุงเทพมหานคร', 'SOCIAL_WELFARE', 'กรุงเทพมหานคร', NULL, NULL, '02-000-0003', 'ศูนย์ประสานงานเด็กและครอบครัว', 'กรุงเทพมหานคร')
      ) AS seed(name, agency_type, province, district, sub_district, phone, contact_person, address)
      WHERE NOT EXISTS (
        SELECT 1 FROM external_agencies existing
        WHERE existing.name = seed.name
          AND existing.agency_type = seed.agency_type
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_case_referrals_agency`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_case_referrals_case`);
    await queryRunner.query(`DROP TABLE IF EXISTS case_referrals`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_agencies_type_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_agencies_scope`);
    await queryRunner.query(`DROP TABLE IF EXISTS external_agencies`);
  }
}
