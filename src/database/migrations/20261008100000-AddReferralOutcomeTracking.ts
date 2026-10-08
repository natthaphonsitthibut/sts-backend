import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Referring a case no longer closes it (owner, 2026-10-08 — UAT finding: a
 * referred student stayed "referred" forever with no way back). `REFER_AGENCY`
 * now parks the case in รอผลการส่งต่อ; someone inside the school records what
 * the agency reported, once per referral — สำเร็จ → referral `COMPLETED`,
 * ยังไม่สำเร็จ → referral `NOT_SUCCEEDED` — and either way the case goes back
 * to `PENDING_REVIEW` for the reviewer to close it or act again.
 *
 * The outcome code lives on `case_referrals.status_code` (already FK'd to its
 * catalog); `case_referral_results` holds the note, who recorded it and when.
 * Cases referred before this migration stay resolved — nothing is reopened.
 */
export class AddReferralOutcomeTracking20261008100000 implements MigrationInterface {
  name = 'AddReferralOutcomeTracking20261008100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $prerequisites$
      BEGIN
        IF to_regclass('public.case_referrals') IS NULL
           OR to_regclass('public.case_referral_statuses') IS NULL
           OR to_regclass('public.case_review_actions') IS NULL THEN
          RAISE EXCEPTION 'case referral prerequisites are missing';
        END IF;
      END
      $prerequisites$
    `);

    await queryRunner.query(`
      INSERT INTO case_workflow_statuses (code, label_th, badge_variant, sort_order)
      VALUES ('AWAITING_REFERRAL_OUTCOME', 'รอผลการส่งต่อ', 'warning', 25)
      ON CONFLICT (code) DO UPDATE SET
        label_th = EXCLUDED.label_th,
        badge_variant = EXCLUDED.badge_variant,
        sort_order = EXCLUDED.sort_order,
        is_active = TRUE,
        deleted_at = NULL
    `);
    await queryRunner.query(`
      INSERT INTO case_referral_statuses (code, label_th, badge_variant, sort_order)
      VALUES ('NOT_SUCCEEDED', 'ยังไม่สำเร็จ', 'destructive', 35)
      ON CONFLICT (code) DO UPDATE SET
        label_th = EXCLUDED.label_th,
        badge_variant = EXCLUDED.badge_variant,
        sort_order = EXCLUDED.sort_order,
        is_active = TRUE,
        deleted_at = NULL
    `);

    await queryRunner.query(`
      UPDATE case_review_actions
      SET target_case_status_code = 'AWAITING_REFERRAL_OUTCOME',
          completion_outcome_code = NULL
      WHERE code = 'REFER_AGENCY'
    `);

    // A student waiting on an agency still has an open case; a second one must
    // not be opened beside it.
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
      CREATE TABLE case_referral_results (
        case_referral_id UUID PRIMARY KEY,
        result_note VARCHAR(2000) NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        recorded_by_user_id INTEGER,
        CONSTRAINT fk_case_referral_results_referral FOREIGN KEY (case_referral_id)
          REFERENCES case_referrals(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        CONSTRAINT fk_case_referral_results_recorder FOREIGN KEY (recorded_by_user_id)
          REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
        CONSTRAINT chk_case_referral_results_note CHECK (
          length(btrim(result_note)) BETWEEN 1 AND 2000
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_referral_results_recorder
      ON case_referral_results (recorded_by_user_id)
      WHERE recorded_by_user_id IS NOT NULL
    `);
    await queryRunner.query(`ALTER TABLE case_referral_results ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      DO $secure_case_referral_results$
      DECLARE role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON TABLE case_referral_results FROM %I',
              role_name
            );
          END IF;
        END LOOP;
      END
      $secure_case_referral_results$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $rollback_guard$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM cases WHERE status = 'AWAITING_REFERRAL_OUTCOME'
        ) THEN
          RAISE EXCEPTION 'refusing rollback: cases are waiting on a referral outcome';
        END IF;
        IF EXISTS (SELECT 1 FROM case_referral_results) THEN
          RAISE EXCEPTION 'refusing rollback: referral outcomes have been recorded';
        END IF;
        IF EXISTS (SELECT 1 FROM case_referrals WHERE status_code = 'NOT_SUCCEEDED') THEN
          RAISE EXCEPTION 'refusing rollback: referrals hold the NOT_SUCCEEDED status';
        END IF;
      END
      $rollback_guard$
    `);
    await queryRunner.query(`DROP TABLE case_referral_results`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_cases_active_student_uuid`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_cases_active_student_uuid
        ON cases(student_uuid)
        WHERE student_uuid IS NOT NULL
          AND deleted_at IS NULL
          AND status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
    `);
    await queryRunner.query(`
      UPDATE case_review_actions
      SET target_case_status_code = 'RESOLVED',
          completion_outcome_code = 'REFERRED_AGENCY'
      WHERE code = 'REFER_AGENCY'
    `);
    await queryRunner.query(`DELETE FROM case_referral_statuses WHERE code = 'NOT_SUCCEEDED'`);
    await queryRunner.query(
      `DELETE FROM case_workflow_statuses WHERE code = 'AWAITING_REFERRAL_OUTCOME'`,
    );
  }
}
