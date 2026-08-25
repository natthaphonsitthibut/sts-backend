import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * Gives the referral workflow the same status table every other workflow in the
 * app already has, so the Thai label and badge live in one row instead of a
 * CHECK list in the database plus a second copy in the dashboard component.
 */
export class AddCaseReferralStatuses20260827312900 implements MigrationInterface {
  name = 'AddCaseReferralStatuses20260827312900';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $prerequisites$
      BEGIN
        IF to_regclass('public.case_referrals') IS NULL THEN
          RAISE EXCEPTION 'case_referrals prerequisite is missing';
        END IF;
        IF EXISTS (
          SELECT 1 FROM case_referrals
          WHERE status_code NOT IN ('REFERRED', 'ACCEPTED', 'COMPLETED', 'DECLINED', 'CANCELLED')
        ) THEN
          RAISE EXCEPTION 'case_referrals hold a status outside the seeded catalog';
        END IF;
      END
      $prerequisites$
    `);
    await queryRunner.query(`
      CREATE TABLE case_referral_statuses (
        code VARCHAR(20) PRIMARY KEY,
        label_th VARCHAR(100) NOT NULL,
        badge_variant VARCHAR(16) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_case_referral_statuses_code CHECK (
          code = UPPER(BTRIM(code)) AND CHAR_LENGTH(code) BETWEEN 1 AND 20
        ),
        CONSTRAINT chk_case_referral_statuses_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_case_referral_statuses_badge_variant CHECK (
          badge_variant IN ('default', 'secondary', 'destructive', 'success', 'warning')
        ),
        CONSTRAINT chk_case_referral_statuses_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('case_referral_statuses'));
    await queryRunner.query(`
      INSERT INTO case_referral_statuses (code, label_th, badge_variant, sort_order) VALUES
        ('REFERRED', 'ส่งต่อแล้ว', 'secondary', 10),
        ('ACCEPTED', 'หน่วยงานรับแล้ว', 'default', 20),
        ('COMPLETED', 'เสร็จสิ้น', 'success', 30),
        ('DECLINED', 'หน่วยงานปฏิเสธ', 'destructive', 40),
        ('CANCELLED', 'ยกเลิก', 'warning', 50)
    `);
    await queryRunner.query(`
      ALTER TABLE case_referrals
        DROP CONSTRAINT IF EXISTS chk_case_referrals_status,
        ADD CONSTRAINT fk_case_referrals_status FOREIGN KEY (status_code)
          REFERENCES case_referral_statuses(code) ON UPDATE CASCADE ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE case_referral_statuses ENABLE ROW LEVEL SECURITY
    `);
    await queryRunner.query(`
      DO $secure_case_referral_statuses$
      DECLARE role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON TABLE case_referral_statuses FROM %I',
              role_name
            );
          END IF;
        END LOOP;
      END
      $secure_case_referral_statuses$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $rollback_guard$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM case_referrals
          WHERE status_code NOT IN ('REFERRED', 'ACCEPTED', 'COMPLETED', 'DECLINED', 'CANCELLED')
        ) THEN
          RAISE EXCEPTION 'refusing rollback: referrals use a status the CHECK list cannot hold';
        END IF;
      END
      $rollback_guard$
    `);
    await queryRunner.query(`
      ALTER TABLE case_referrals
        DROP CONSTRAINT IF EXISTS fk_case_referrals_status,
        ADD CONSTRAINT chk_case_referrals_status CHECK (
          status_code IN ('REFERRED', 'ACCEPTED', 'COMPLETED', 'DECLINED', 'CANCELLED')
        )
    `);
    await queryRunner.query(`DROP TABLE case_referral_statuses`);
  }
}
