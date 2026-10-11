import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const SECURED_TABLES = [
  'case_referral_link_statuses',
  'identity_providers',
  'case_referral_links',
] as const;

/**
 * Lets the agency a case was referred to report its result itself, through a
 * link like the teacher's home-visit link (owner, 2026-10-08 — see
 * tasks/task-agency-referral-report-link.md).
 *
 * The agency has no account. The school issues a link for one referral plus a
 * short access code it passes on separately; whoever opens the link enters the
 * code, proves who they are with AraID (ThaID in production), and files the
 * report. `case_referral_results` then records which link the report came
 * through and who sent it — the provider, its subject id and the name at the
 * time, never the citizen id.
 *
 * Tokens are stored as a hash for lookup plus AES-GCM ciphertext so the school
 * can share the same link again, exactly as `task_links` does. The access code
 * is only ever stored hashed and is shown once, when the link is issued.
 *
 * A referral now runs like a follow-up round (owner, 2026-10-08): reviewing a
 * case as ส่งต่อหน่วยงาน parks it in the new รอส่งต่อ — the referral's รอมอบหมาย —
 * and sending the referral from the case page (agency, window, reason) issues
 * the link and moves it to รอผลการส่งต่อ. Cancelling a sent referral records
 * why, who and when on its link, as `task_links` does for a withdrawn round.
 */
export class AddReferralReportLinks20261009100000 implements MigrationInterface {
  name = 'AddReferralReportLinks20261009100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $prerequisites$
      BEGIN
        IF to_regclass('public.case_referrals') IS NULL
           OR to_regclass('public.case_referral_results') IS NULL THEN
          RAISE EXCEPTION 'referral outcome tracking prerequisites are missing';
        END IF;
      END
      $prerequisites$
    `);

    await queryRunner.query(`
      INSERT INTO case_workflow_statuses (code, label_th, badge_variant, sort_order)
      VALUES ('AWAITING_REFERRAL', 'รอส่งต่อ', 'secondary', 22)
      ON CONFLICT (code) DO UPDATE SET
        label_th = EXCLUDED.label_th,
        badge_variant = EXCLUDED.badge_variant,
        sort_order = EXCLUDED.sort_order,
        is_active = TRUE,
        deleted_at = NULL
    `);
    await queryRunner.query(`
      UPDATE case_review_actions
      SET target_case_status_code = 'AWAITING_REFERRAL', completion_outcome_code = NULL
      WHERE code = 'REFER_AGENCY'
    `);
    // A student waiting to be referred still has an open case.
    await queryRunner.query(`DROP INDEX IF EXISTS uq_cases_active_student_uuid`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_cases_active_student_uuid
        ON cases(student_uuid)
        WHERE student_uuid IS NOT NULL
          AND deleted_at IS NULL
          AND status IN (
            'OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND',
            'AWAITING_REFERRAL', 'AWAITING_REFERRAL_OUTCOME'
          )
    `);

    // One ส่งต่อหน่วยงาน decision can take more than one send — after a
    // cancelled or expired round — the way one ติดตามต่อ takes more than one
    // assignment, so a review no longer limits its case to one referral.
    await queryRunner.query(`
      ALTER TABLE case_referrals DROP CONSTRAINT IF EXISTS case_referrals_case_review_id_key
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_referrals_review ON case_referrals (case_review_id)
    `);

    await queryRunner.query(`
      CREATE TABLE case_referral_link_statuses (
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
        CONSTRAINT chk_case_referral_link_statuses_code CHECK (
          code = UPPER(BTRIM(code)) AND CHAR_LENGTH(code) BETWEEN 1 AND 20
        ),
        CONSTRAINT chk_case_referral_link_statuses_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_case_referral_link_statuses_badge_variant CHECK (
          badge_variant IN ('default', 'secondary', 'destructive', 'success', 'warning')
        ),
        CONSTRAINT chk_case_referral_link_statuses_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('case_referral_link_statuses'));
    await queryRunner.query(`
      INSERT INTO case_referral_link_statuses (code, label_th, badge_variant, sort_order) VALUES
        ('ACTIVE', 'ใช้งานได้', 'success', 10),
        ('LOCKED', 'ถูกล็อก', 'destructive', 20),
        ('USED', 'รายงานแล้ว', 'secondary', 30),
        ('REVOKED', 'ยกเลิกแล้ว', 'warning', 40),
        ('EXPIRED', 'หมดอายุ', 'warning', 50)
    `);

    await queryRunner.query(`
      CREATE TABLE identity_providers (
        code VARCHAR(20) PRIMARY KEY,
        label_th VARCHAR(100) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_identity_providers_code CHECK (
          code = UPPER(BTRIM(code)) AND CHAR_LENGTH(code) BETWEEN 1 AND 20
        ),
        CONSTRAINT chk_identity_providers_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_identity_providers_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('identity_providers'));
    await queryRunner.query(`
      INSERT INTO identity_providers (code, label_th, sort_order) VALUES
        ('ARAID', 'AraID', 10),
        ('THAID', 'ThaID', 20)
    `);

    await queryRunner.query(`
      CREATE TABLE case_referral_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_referral_id UUID NOT NULL,
        token_hash VARCHAR(128) NOT NULL,
        token_encrypted TEXT NOT NULL,
        access_code_hash VARCHAR(128) NOT NULL,
        failed_code_attempts SMALLINT NOT NULL DEFAULT 0,
        status_code VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        starts_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by_user_id INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        cancelled_at TIMESTAMPTZ,
        cancelled_by_user_id INTEGER,
        cancel_reason VARCHAR(500),
        CONSTRAINT uq_case_referral_links_token_hash UNIQUE (token_hash),
        CONSTRAINT fk_case_referral_links_referral FOREIGN KEY (case_referral_id)
          REFERENCES case_referrals(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        CONSTRAINT fk_case_referral_links_status FOREIGN KEY (status_code)
          REFERENCES case_referral_link_statuses(code) ON UPDATE CASCADE ON DELETE RESTRICT,
        CONSTRAINT fk_case_referral_links_creator FOREIGN KEY (created_by_user_id)
          REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
        CONSTRAINT fk_case_referral_links_canceller FOREIGN KEY (cancelled_by_user_id)
          REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
        CONSTRAINT chk_case_referral_links_cancel_reason CHECK (
          cancel_reason IS NULL OR length(btrim(cancel_reason)) BETWEEN 1 AND 500
        ),
        CONSTRAINT chk_case_referral_links_failed_attempts CHECK (failed_code_attempts >= 0),
        CONSTRAINT chk_case_referral_links_window CHECK (expires_at > starts_at)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('case_referral_links'));
    // One link a referral can be reached through at a time; issuing a new one
    // retires the old one in the same transaction.
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_case_referral_links_active
      ON case_referral_links (case_referral_id)
      WHERE status_code = 'ACTIVE'
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_referral_links_referral
      ON case_referral_links (case_referral_id, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_referral_links_creator
      ON case_referral_links (created_by_user_id)
      WHERE created_by_user_id IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE case_referral_results
        ADD COLUMN case_referral_link_id UUID,
        ADD COLUMN action_date DATE,
        ADD COLUMN reporter_identity_provider_code VARCHAR(20),
        ADD COLUMN reporter_provider_subject VARCHAR(100),
        ADD COLUMN reporter_name VARCHAR(255),
        ADD CONSTRAINT fk_case_referral_results_link FOREIGN KEY (case_referral_link_id)
          REFERENCES case_referral_links(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD CONSTRAINT fk_case_referral_results_identity_provider
          FOREIGN KEY (reporter_identity_provider_code)
          REFERENCES identity_providers(code) ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD CONSTRAINT chk_case_referral_results_reporter CHECK (
          case_referral_link_id IS NULL
          OR (
            reporter_identity_provider_code IS NOT NULL
            AND length(btrim(reporter_provider_subject)) > 0
            AND length(btrim(reporter_name)) > 0
          )
        )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_referral_results_link
      ON case_referral_results (case_referral_link_id)
      WHERE case_referral_link_id IS NOT NULL
    `);

    for (const table of SECURED_TABLES) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        DO $secure$
        DECLARE role_name TEXT;
        BEGIN
          FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
              EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE ${table} FROM %I', role_name);
            END IF;
          END LOOP;
        END
        $secure$
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $rollback_guard$
      BEGIN
        IF EXISTS (SELECT 1 FROM case_referral_results WHERE case_referral_link_id IS NOT NULL) THEN
          RAISE EXCEPTION 'refusing rollback: agencies have reported through referral links';
        END IF;
        IF EXISTS (
          SELECT 1 FROM case_referrals GROUP BY case_review_id HAVING COUNT(*) > 1
        ) THEN
          RAISE EXCEPTION 'refusing rollback: a review holds more than one referral';
        END IF;
        IF EXISTS (SELECT 1 FROM cases WHERE status = 'AWAITING_REFERRAL') THEN
          RAISE EXCEPTION 'refusing rollback: cases are waiting to be referred';
        END IF;
      END
      $rollback_guard$
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_case_referral_results_link`);
    await queryRunner.query(`
      ALTER TABLE case_referral_results
        DROP CONSTRAINT IF EXISTS chk_case_referral_results_reporter,
        DROP CONSTRAINT IF EXISTS fk_case_referral_results_identity_provider,
        DROP CONSTRAINT IF EXISTS fk_case_referral_results_link,
        DROP COLUMN IF EXISTS reporter_name,
        DROP COLUMN IF EXISTS reporter_provider_subject,
        DROP COLUMN IF EXISTS reporter_identity_provider_code,
        DROP COLUMN IF EXISTS action_date,
        DROP COLUMN IF EXISTS case_referral_link_id
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS case_referral_links`);
    await queryRunner.query(`DROP TABLE IF EXISTS identity_providers`);
    await queryRunner.query(`DROP TABLE IF EXISTS case_referral_link_statuses`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_cases_active_student_uuid`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_cases_active_student_uuid
        ON cases(student_uuid)
        WHERE student_uuid IS NOT NULL
          AND deleted_at IS NULL
          AND status IN (
            'OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND',
            'AWAITING_REFERRAL_OUTCOME'
          )
    `);
    await queryRunner.query(`
      UPDATE case_review_actions
      SET target_case_status_code = 'AWAITING_REFERRAL_OUTCOME', completion_outcome_code = NULL
      WHERE code = 'REFER_AGENCY'
    `);
    await queryRunner.query(`DELETE FROM case_workflow_statuses WHERE code = 'AWAITING_REFERRAL'`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_case_referrals_review`);
    await queryRunner.query(`
      ALTER TABLE case_referrals
        ADD CONSTRAINT case_referrals_case_review_id_key UNIQUE (case_review_id)
    `);
  }
}
