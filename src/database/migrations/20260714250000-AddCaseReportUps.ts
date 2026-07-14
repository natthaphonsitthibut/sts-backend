import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCaseReportUps20260714250000 implements MigrationInterface {
  name = 'AddCaseReportUps20260714250000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO case_workflow_statuses (
        code, label_th, badge_variant, summary_tone, sort_order, is_active
      ) VALUES ('REPORTED_UP', 'รายงานขึ้นส่วนกลางแล้ว', 'destructive', 'danger', 40, TRUE)
      ON CONFLICT (code) DO UPDATE SET
        label_th = EXCLUDED.label_th,
        badge_variant = EXCLUDED.badge_variant,
        summary_tone = EXCLUDED.summary_tone,
        sort_order = EXCLUDED.sort_order,
        is_active = TRUE
    `);

    await queryRunner.query(`
      CREATE TABLE case_report_ups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id INTEGER NOT NULL,
        school_id INTEGER NOT NULL,
        reported_by INTEGER,
        reported_by_label VARCHAR(255),
        report_reason VARCHAR(500),
        report_summary VARCHAR(2000),
        school_name_snapshot VARCHAR(255),
        province_snapshot VARCHAR(255),
        district_snapshot VARCHAR(255),
        sub_district_snapshot VARCHAR(255),
        reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_case_report_ups_case UNIQUE (case_id),
        CONSTRAINT fk_case_report_ups_case
          FOREIGN KEY (case_id) REFERENCES cases(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_case_report_ups_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_case_report_ups_reported_by
          FOREIGN KEY (reported_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_case_report_ups_reason
          CHECK (report_reason IS NULL OR length(trim(report_reason)) > 0),
        CONSTRAINT chk_case_report_ups_summary
          CHECK (report_summary IS NULL OR length(trim(report_summary)) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_report_ups_case_time
        ON case_report_ups (case_id, reported_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_report_ups_school_time
        ON case_report_ups (school_id, reported_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_report_ups_province_time
        ON case_report_ups (province_snapshot, reported_at DESC)
    `);

    await queryRunner.query(`
      CREATE TEMP TABLE p6_legacy_report_up_case_ids (
        case_id INTEGER PRIMARY KEY
      ) ON COMMIT DROP;

      INSERT INTO p6_legacy_report_up_case_ids (case_id)
      SELECT DISTINCT legacy.case_id
      FROM (
        SELECT id AS case_id
        FROM cases
        WHERE status = 'AWAITING_HELP'

        UNION

        SELECT review.case_id
        FROM case_reviews review
        WHERE UPPER(review.review_action) = 'FORWARD'

        UNION

        SELECT referral.case_id
        FROM case_referrals referral

        UNION

        SELECT audit.target_id::integer AS case_id
        FROM audit_log audit
        WHERE audit.action = 'CASE_FORWARD'
          AND audit.target_type = 'case'
          AND audit.target_id ~ '^[0-9]+$'
      ) legacy
      JOIN cases existing_case ON existing_case.id = legacy.case_id;
    `);

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
      SELECT
        legacy.case_id,
        case_record.school_id,
        latest_event.actor_user_id,
        latest_event.actor_label,
        NULL,
        NULL,
        school.name,
        school.province,
        school.district,
        school.sub_district,
        COALESCE(latest_event.occurred_at, case_record.updated_at, case_record.created_at, now())
      FROM p6_legacy_report_up_case_ids legacy
      JOIN cases case_record ON case_record.id = legacy.case_id
      LEFT JOIN schools school ON school.id = case_record.school_id
      LEFT JOIN LATERAL (
        SELECT event.occurred_at, event.actor_user_id, event.actor_label
        FROM (
          SELECT
            referral.referred_at AS occurred_at,
            referral.referred_by AS actor_user_id,
            referral.referred_by_label AS actor_label
          FROM case_referrals referral
          WHERE referral.case_id = legacy.case_id

          UNION ALL

          SELECT
            review.reviewed_at AS occurred_at,
            NULL::integer AS actor_user_id,
            review.reviewed_by AS actor_label
          FROM case_reviews review
          WHERE review.case_id = legacy.case_id
            AND UPPER(review.review_action) = 'FORWARD'

          UNION ALL

          SELECT
            audit.created_at AS occurred_at,
            audit.actor_user_id,
            audit.actor_label
          FROM audit_log audit
          WHERE audit.action = 'CASE_FORWARD'
            AND audit.target_type = 'case'
            AND audit.target_id = legacy.case_id::text
        ) event
        ORDER BY event.occurred_at DESC NULLS LAST
        LIMIT 1
      ) latest_event ON TRUE
      ON CONFLICT (case_id) DO NOTHING
    `);

    await queryRunner.query(`
      DO $case_report_up_reconcile$
      DECLARE
        expected_count INTEGER;
        actual_count INTEGER;
      BEGIN
        SELECT COUNT(*) INTO expected_count FROM p6_legacy_report_up_case_ids;
        SELECT COUNT(*) INTO actual_count
        FROM case_report_ups report_up
        JOIN p6_legacy_report_up_case_ids legacy ON legacy.case_id = report_up.case_id;

        IF actual_count <> expected_count THEN
          RAISE EXCEPTION
            'case report-up backfill mismatch: expected %, found %',
            expected_count,
            actual_count;
        END IF;
      END
      $case_report_up_reconcile$;
    `);

    await queryRunner.query(`
      UPDATE cases
      SET status = 'REPORTED_UP'
      WHERE status = 'AWAITING_HELP'
    `);
    await queryRunner.query(`
      DO $case_report_up_status_reconcile$
      BEGIN
        IF EXISTS (SELECT 1 FROM cases WHERE status = 'AWAITING_HELP') THEN
          RAISE EXCEPTION 'case report-up status reconciliation failed: AWAITING_HELP remains';
        END IF;
      END
      $case_report_up_status_reconcile$;
    `);
    await queryRunner.query(`DROP TABLE p6_legacy_report_up_case_ids`);

    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE(default_permissions, '[]'::jsonb)
        || '["assign-follow-up-cases"]'::jsonb
      WHERE name IN ('ADMIN', 'ADMIN_SCHOOL', 'DIRECTOR')
        AND NOT (COALESCE(default_permissions, '[]'::jsonb) ? 'assign-follow-up-cases')
    `);
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE(default_permissions, '[]'::jsonb)
        || '["report-up-cases"]'::jsonb
      WHERE name IN ('ADMIN', 'ADMIN_SCHOOL', 'DIRECTOR')
        AND NOT (COALESCE(default_permissions, '[]'::jsonb) ? 'report-up-cases')
    `);
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE(default_permissions, '[]'::jsonb)
        || '["executive-report"]'::jsonb
      WHERE name IN (
        'ADMIN', 'ADMIN_PROVINCE', 'ADMIN_DISTRICT', 'ADMIN_SUBDISTRICT', 'EXECUTIVE'
      )
        AND NOT (COALESCE(default_permissions, '[]'::jsonb) ? 'executive-report')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE cases
      SET status = 'AWAITING_HELP'
      WHERE status = 'REPORTED_UP'
    `);
    await queryRunner.query(`DROP TABLE case_report_ups`);
    await queryRunner.query(`DELETE FROM case_workflow_statuses WHERE code = 'REPORTED_UP'`);
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE((
        SELECT jsonb_agg(permission)
        FROM jsonb_array_elements_text(
          COALESCE(default_permissions, '[]'::jsonb)
        ) AS permissions(permission)
        WHERE permission NOT IN (
          'assign-follow-up-cases', 'report-up-cases', 'executive-report'
        )
      ), '[]'::jsonb)
    `);
  }
}
