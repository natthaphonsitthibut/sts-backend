import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const LEGACY_REFERRAL_AUDIT_ACTIONS = ['CASE_FORWARD', 'CASE_REFERRAL_OUTCOME_UPDATE'] as const;

export class RemoveLegacyReferralFeature20260714260000 implements MigrationInterface {
  name = 'RemoveLegacyReferralFeature20260714260000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $replacement_gate$
      BEGIN
        IF to_regclass('public.case_report_ups') IS NULL THEN
          RAISE EXCEPTION 'case_report_ups must exist before removing the legacy referral domain';
        END IF;
      END
      $replacement_gate$
    `);

    // The expand migration covers AWAITING_HELP/FORWARD/referral/audit signals.
    // A legacy close outcome is a fifth signal and must also become report-up
    // continuity before its referral-specific review row is purged.
    await queryRunner.query(`
      INSERT INTO case_report_ups (
        case_id,
        school_id,
        reported_by,
        reported_by_label,
        report_reason,
        report_summary,
        school_name_snapshot,
        province_snapshot,
        district_snapshot,
        sub_district_snapshot,
        reported_at
      )
      SELECT DISTINCT ON (review.case_id)
        review.case_id,
        case_record.school_id,
        NULL,
        review.reviewed_by,
        NULL,
        NULL,
        school.name,
        school.province,
        school.district,
        school.sub_district,
        COALESCE(review.reviewed_at, case_record.updated_at, case_record.created_at, now())
      FROM case_reviews review
      JOIN cases case_record ON case_record.id = review.case_id
      LEFT JOIN schools school ON school.id = case_record.school_id
      WHERE review.resolution_outcome = 'REFERRED_EXTERNAL'
      ORDER BY review.case_id, review.reviewed_at DESC NULLS LAST
      ON CONFLICT (case_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE cases case_record
      SET status = 'REPORTED_UP'
      WHERE EXISTS (
        SELECT 1
        FROM case_reviews review
        WHERE review.case_id = case_record.id
          AND review.resolution_outcome = 'REFERRED_EXTERNAL'
      )
    `);

    await queryRunner.query(`
      DO $referral_reconcile$
      BEGIN
        IF EXISTS (SELECT 1 FROM cases WHERE status = 'AWAITING_HELP') THEN
          RAISE EXCEPTION 'legacy case status reconciliation failed: AWAITING_HELP remains';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM (
            SELECT review.case_id
            FROM case_reviews review
            WHERE UPPER(review.review_action) = 'FORWARD'
               OR review.resolution_outcome = 'REFERRED_EXTERNAL'
            UNION
            SELECT referral.case_id FROM case_referrals referral
            UNION
            SELECT audit.target_id::integer
            FROM audit_log audit
            WHERE audit.action = 'CASE_FORWARD'
              AND audit.target_type = 'case'
              AND audit.target_id ~ '^[0-9]+$'
          ) legacy
          JOIN cases existing_case ON existing_case.id = legacy.case_id
          LEFT JOIN case_report_ups report_up ON report_up.case_id = legacy.case_id
          WHERE report_up.case_id IS NULL
        ) THEN
          RAISE EXCEPTION 'legacy referral reconciliation failed: report-up continuity is missing';
        END IF;
      END
      $referral_reconcile$
    `);

    await queryRunner.query(`
      DELETE FROM case_reviews
      WHERE UPPER(review_action) = 'FORWARD'
         OR resolution_outcome = 'REFERRED_EXTERNAL'
    `);
    await queryRunner.query(`
      ALTER TABLE case_reviews
        DROP CONSTRAINT IF EXISTS chk_case_reviews_resolution_outcome;
      ALTER TABLE case_reviews
        ADD CONSTRAINT chk_case_reviews_resolution_outcome
        CHECK (
          resolution_outcome IS NULL
          OR resolution_outcome IN (
            'RETURNED_TO_SCHOOL', 'TRANSFERRED_SCHOOL', 'ILLNESS',
            'WORKING', 'UNREACHABLE', 'OTHER'
          )
        )
    `);

    // Old case artifacts may contain removed status/domain vocabulary. Mark
    // them expired while retaining the storage key so the normal cleanup job
    // can retry physical object deletion through the configured adapter.
    await queryRunner.query(`
      WITH expired AS (
        UPDATE data_export_job
        SET status = 'EXPIRED',
            expires_at = COALESCE(expires_at, now()),
            updated_at = now()
        WHERE dataset_code IN ('case_summary', 'case_operational')
          AND status = 'COMPLETED'
          AND artifact_storage_key IS NOT NULL
        RETURNING id
      )
      INSERT INTO data_export_job_event (job_id, actor_user_id, event_code, metadata)
      SELECT id, NULL, 'EXPIRED', '{"reason":"legacy_case_domain_removed"}'::jsonb
      FROM expired
    `);

    // Referral-domain audit rows are intentionally purged per the owner
    // decision. The append-only trigger is restored in the same transaction.
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log`);
    await queryRunner.query(
      `
      DELETE FROM audit_log
      WHERE action = ANY($1::text[])
         OR target_type IN ('case_referral', 'external_agency', 'related_agency', 'related_agencies')
         OR metadata->>'table' IN ('case_referrals', 'external_agencies', 'related_agencies')
    `,
      [LEGACY_REFERRAL_AUDIT_ACTIONS],
    );
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_log_immutable
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation()
    `);

    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE((
        SELECT jsonb_agg(permission ORDER BY ordinal)
        FROM jsonb_array_elements_text(COALESCE(default_permissions, '[]'::jsonb))
          WITH ORDINALITY AS permissions(permission, ordinal)
        WHERE permission <> 'forward-case'
      ), '[]'::jsonb)
      WHERE COALESCE(default_permissions, '[]'::jsonb) ? 'forward-case'
    `);
    await queryRunner.query(`
      UPDATE users
      SET permissions = COALESCE((
        SELECT jsonb_agg(permission ORDER BY ordinal)
        FROM jsonb_array_elements_text(COALESCE(permissions, '[]'::jsonb))
          WITH ORDINALITY AS user_permissions(permission, ordinal)
        WHERE permission <> 'forward-case'
      ), '[]'::jsonb)
      WHERE COALESCE(permissions, '[]'::jsonb) ? 'forward-case'
    `);

    await queryRunner.query(`
      DELETE FROM case_workflow_statuses WHERE code = 'AWAITING_HELP'
    `);
    await queryRunner.query(`DROP TABLE case_referrals`);
    await queryRunner.query(`DROP TABLE external_agencies`);
    await queryRunner.query(`DROP TABLE case_referral_statuses`);
    await queryRunner.query(`DROP TABLE related_agencies`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE related_agencies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        ${AUDIT_COLUMNS_SQL}
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('related_agencies'));

    await queryRunner.query(`
      CREATE TABLE external_agencies (
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
          CHECK (agency_type IN ('HOSPITAL','POLICE','SOCIAL_WELFARE','NGO','EDUCATION','OTHER'))
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('external_agencies'));
    await queryRunner.query(`
      CREATE INDEX idx_external_agencies_scope
        ON external_agencies (province, district, sub_district);
      CREATE INDEX idx_external_agencies_type_active
        ON external_agencies (agency_type, is_active)
    `);

    await queryRunner.query(`
      CREATE TABLE case_referral_statuses (
        code VARCHAR(16) PRIMARY KEY,
        label_th VARCHAR(100) NOT NULL,
        badge_variant VARCHAR(16) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_case_referral_statuses_label CHECK (length(trim(label_th)) > 0),
        CONSTRAINT chk_case_referral_statuses_badge
          CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('case_referral_statuses'));
    await queryRunner.query(`
      INSERT INTO case_referral_statuses (code, label_th, badge_variant, sort_order) VALUES
        ('SENT', 'ส่งต่อแล้ว', 'default', 10),
        ('ACKNOWLEDGED', 'รับทราบแล้ว', 'secondary', 20),
        ('ACCEPTED', 'รับดำเนินการ', 'success', 30),
        ('DECLINED', 'ปฏิเสธรับเรื่อง', 'destructive', 40),
        ('RETURNED', 'ส่งกลับ', 'warning', 50)
    `);

    await queryRunner.query(`
      CREATE TABLE case_referrals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE ON UPDATE CASCADE,
        agency_id INTEGER REFERENCES external_agencies(id) ON DELETE SET NULL ON UPDATE CASCADE,
        agency_name_snapshot TEXT NOT NULL,
        agency_type_snapshot TEXT NOT NULL,
        referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        referred_by_label TEXT,
        referred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        referral_note TEXT,
        status VARCHAR(16) NOT NULL DEFAULT 'SENT'
          REFERENCES case_referral_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        outcome TEXT,
        responded_at TIMESTAMPTZ,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_case_referrals_agency_type
          CHECK (agency_type_snapshot IN ('HOSPITAL','POLICE','SOCIAL_WELFARE','NGO','EDUCATION','OTHER'))
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('case_referrals'));
    await queryRunner.query(`
      CREATE INDEX idx_case_referrals_case ON case_referrals (case_id, referred_at DESC);
      CREATE INDEX idx_case_referrals_agency ON case_referrals (agency_id)
    `);

    await queryRunner.query(`
      INSERT INTO case_workflow_statuses (
        code, label_th, badge_variant, summary_tone, sort_order, is_active
      ) VALUES ('AWAITING_HELP', 'รอช่วยเหลือ', 'destructive', 'danger', 40, TRUE)
      ON CONFLICT (code) DO NOTHING
    `);
    await queryRunner.query(`
      ALTER TABLE case_reviews
        DROP CONSTRAINT IF EXISTS chk_case_reviews_resolution_outcome;
      ALTER TABLE case_reviews
        ADD CONSTRAINT chk_case_reviews_resolution_outcome
        CHECK (
          resolution_outcome IS NULL
          OR resolution_outcome IN (
            'RETURNED_TO_SCHOOL', 'TRANSFERRED_SCHOOL', 'ILLNESS',
            'WORKING', 'UNREACHABLE', 'REFERRED_EXTERNAL', 'OTHER'
          )
        )
    `);

    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE(default_permissions, '[]'::jsonb)
        || '["forward-case"]'::jsonb
      WHERE name IN ('ADMIN', 'ADMIN_SCHOOL', 'DIRECTOR')
        AND NOT (COALESCE(default_permissions, '[]'::jsonb) ? 'forward-case')
    `);
  }
}
