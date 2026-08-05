import type { MigrationInterface, QueryRunner } from 'typeorm';

const OUTCOMES = [
  ['RETURNED_TO_SCHOOL', 'กลับมาเรียนแล้ว', 10],
  ['TRANSFERRED_SCHOOL', 'ย้ายสถานศึกษา', 20],
  ['ILLNESS', 'เจ็บป่วย/รักษาตัว', 30],
  ['WORKING', 'ทำงานหรือมีภาระครอบครัว', 40],
  ['UNREACHABLE', 'ติดต่อไม่ได้', 50],
  ['OTHER', 'อื่น ๆ', 60],
] as const;

export class AlignCaseTrackingWorkflow20260720120000 implements MigrationInterface {
  name = 'AlignCaseTrackingWorkflow20260720120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE case_resolution_outcomes (
        code VARCHAR(40) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_case_resolution_outcomes_label CHECK (length(trim(label_th)) > 0),
        CONSTRAINT chk_case_resolution_outcomes_sort_order CHECK (sort_order >= 0)
      )
    `);
    for (const [code, label, sortOrder] of OUTCOMES) {
      await queryRunner.query(
        `INSERT INTO case_resolution_outcomes (code, label_th, sort_order) VALUES ($1, $2, $3)`,
        [code, label, sortOrder],
      );
    }
    await queryRunner.query(`
      CREATE TRIGGER trg_case_resolution_outcomes_set_updated_at
      BEFORE UPDATE ON case_resolution_outcomes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`
      CREATE TABLE case_review_actions (
        code VARCHAR(24) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        target_case_status_code VARCHAR(32) NOT NULL,
        requires_resolution_outcome BOOLEAN NOT NULL DEFAULT FALSE,
        required_permission_code VARCHAR(64) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_case_review_actions_target_status
          FOREIGN KEY (target_case_status_code) REFERENCES case_workflow_statuses(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_case_review_actions_label CHECK (length(trim(label_th)) > 0),
        CONSTRAINT chk_case_review_actions_permission CHECK (length(trim(required_permission_code)) > 0),
        CONSTRAINT chk_case_review_actions_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      INSERT INTO case_review_actions (
        code, label_th, target_case_status_code, requires_resolution_outcome,
        required_permission_code, sort_order
      ) VALUES
        ('CONTINUE', 'ติดตามต่อ', 'IN_PROGRESS', FALSE, 'review-cases', 10),
        ('CLOSE', 'ปิดเคส', 'RESOLVED', TRUE, 'close-case', 20)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_case_review_actions_set_updated_at
      BEFORE UPDATE ON case_review_actions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`
      CREATE TABLE case_follow_up_decisions (
        code VARCHAR(24) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        target_case_status_code VARCHAR(32) NOT NULL,
        requires_resolution_outcome BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_case_follow_up_decisions_target_status
          FOREIGN KEY (target_case_status_code) REFERENCES case_workflow_statuses(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_case_follow_up_decisions_label CHECK (length(trim(label_th)) > 0),
        CONSTRAINT chk_case_follow_up_decisions_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      INSERT INTO case_follow_up_decisions (
        code, label_th, target_case_status_code, requires_resolution_outcome, sort_order
      ) VALUES
        ('REQUEST_REVIEW', 'ส่งให้ตรวจผล', 'PENDING_REVIEW', FALSE, 10),
        ('CLOSE_CASE', 'ปิดเคส', 'RESOLVED', TRUE, 20)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_case_follow_up_decisions_set_updated_at
      BEFORE UPDATE ON case_follow_up_decisions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`
      CREATE TABLE case_tracking_role_permission_backup_20260720 (
        role_id INTEGER PRIMARY KEY REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE,
        default_permissions JSONB NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO case_tracking_role_permission_backup_20260720 (role_id, default_permissions)
      SELECT id, default_permissions
      FROM roles
      WHERE COALESCE(default_permissions, '[]'::jsonb) ? 'report-up-cases'
    `);
    await queryRunner.query(`
      CREATE TABLE case_tracking_user_permission_backup_20260720 (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
        permissions JSONB NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO case_tracking_user_permission_backup_20260720 (user_id, permissions)
      SELECT id, permissions
      FROM users
      WHERE COALESCE(permissions, '[]'::jsonb) ? 'report-up-cases'
    `);
    await queryRunner.query(`
      CREATE TABLE case_tracking_status_backup_20260720 (
        case_id INTEGER PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE ON UPDATE CASCADE,
        previous_status VARCHAR(32) NOT NULL
          CHECK (previous_status IN ('REPORTED_UP', 'AWAITING_HELP'))
      )
    `);
    await queryRunner.query(`
      INSERT INTO case_tracking_status_backup_20260720 (case_id, previous_status)
      SELECT id, status FROM cases WHERE status IN ('REPORTED_UP', 'AWAITING_HELP')
    `);
    await queryRunner.query(`
      CREATE TABLE case_tracking_report_up_backup_20260720 (
        id UUID PRIMARY KEY,
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
        reported_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT fk_case_tracking_report_backup_case
          FOREIGN KEY (case_id) REFERENCES cases(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_case_tracking_report_backup_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_case_tracking_report_backup_reporter
          FOREIGN KEY (reported_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      INSERT INTO case_tracking_report_up_backup_20260720 (
        id, case_id, school_id, reported_by, reported_by_label, report_reason,
        report_summary, school_name_snapshot, province_snapshot, district_snapshot,
        sub_district_snapshot, reported_at
      )
      SELECT
        id, case_id, school_id, reported_by, reported_by_label, report_reason,
        report_summary, school_name_snapshot, province_snapshot, district_snapshot,
        sub_district_snapshot, reported_at
      FROM case_report_ups
    `);

    await queryRunner.query(`ALTER TABLE case_reviews ADD COLUMN review_summary VARCHAR(2000)`);
    await queryRunner.query(`ALTER TABLE case_reviews ADD COLUMN source_actor_user_id INTEGER`);
    await queryRunner.query(`
      ALTER TABLE case_reviews ADD CONSTRAINT fk_case_reviews_source_actor
      FOREIGN KEY (source_actor_user_id) REFERENCES users(id)
      ON DELETE SET NULL ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      INSERT INTO case_reviews (
        id, case_id, review_action, review_note, review_summary, resolution_outcome,
        reviewed_by, reviewed_at, source_actor_user_id
      )
      SELECT
        report_up.id,
        report_up.case_id,
        'CONTINUE',
        report_up.report_reason,
        report_up.report_summary,
        NULL,
        report_up.reported_by_label,
        report_up.reported_at,
        report_up.reported_by
      FROM case_report_ups report_up
      ON CONFLICT (id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE case_reviews
      SET review_action = CASE
        WHEN UPPER(review_action) = 'ASSIST' THEN 'CONTINUE'
        ELSE UPPER(review_action)
      END
      WHERE UPPER(review_action) IN ('ASSIST', 'CONTINUE', 'CLOSE')
    `);

    await queryRunner.query(`
      DO $case_review_action_reconcile$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM case_reviews WHERE UPPER(review_action) NOT IN ('CONTINUE', 'CLOSE')
        ) THEN
          RAISE EXCEPTION 'case review action reconciliation failed';
        END IF;
      END
      $case_review_action_reconcile$
    `);
    await queryRunner.query(
      `ALTER TABLE case_reviews DROP CONSTRAINT IF EXISTS chk_case_reviews_resolution_outcome`,
    );
    await queryRunner.query(`
      UPDATE case_reviews
      SET resolution_outcome = 'OTHER'
      WHERE review_action = 'CLOSE' AND resolution_outcome IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE case_reviews ADD CONSTRAINT fk_case_reviews_action
      FOREIGN KEY (review_action) REFERENCES case_review_actions(code)
      ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE case_reviews ADD CONSTRAINT fk_case_reviews_resolution_outcome
      FOREIGN KEY (resolution_outcome) REFERENCES case_resolution_outcomes(code)
      ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE case_reviews ADD CONSTRAINT chk_case_reviews_action_outcome CHECK (
        (review_action = 'CONTINUE' AND resolution_outcome IS NULL)
        OR (review_action = 'CLOSE' AND resolution_outcome IS NOT NULL)
      )
    `);

    await queryRunner.query(`
      ALTER TABLE task_submissions
        ADD COLUMN case_follow_up_decision VARCHAR(24),
        ADD COLUMN case_resolution_outcome_code VARCHAR(40)
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions ADD CONSTRAINT fk_task_submissions_follow_up_decision
      FOREIGN KEY (case_follow_up_decision) REFERENCES case_follow_up_decisions(code)
      ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions ADD CONSTRAINT fk_task_submissions_resolution_outcome
      FOREIGN KEY (case_resolution_outcome_code) REFERENCES case_resolution_outcomes(code)
      ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions ADD CONSTRAINT chk_task_submission_case_decision CHECK (
        (case_follow_up_decision IS NULL AND case_resolution_outcome_code IS NULL)
        OR (case_follow_up_decision = 'REQUEST_REVIEW' AND case_resolution_outcome_code IS NULL)
        OR (case_follow_up_decision = 'CLOSE_CASE' AND case_resolution_outcome_code IS NOT NULL)
      )
    `);

    await queryRunner.query(`
      UPDATE cases
      SET status = 'PENDING_REVIEW'
      WHERE status IN ('REPORTED_UP', 'AWAITING_HELP')
    `);
    await queryRunner.query(`
      DO $case_tracking_status_reconcile$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM cases
          WHERE deleted_at IS NULL
            AND status NOT IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'RESOLVED')
        ) THEN
          RAISE EXCEPTION 'case tracking status reconciliation failed: unsupported status remains';
        END IF;
      END
      $case_tracking_status_reconcile$
    `);
    await queryRunner.query(`DELETE FROM case_workflow_statuses WHERE code = 'REPORTED_UP'`);
    await queryRunner.query(`
      UPDATE roles SET default_permissions = COALESCE((
        SELECT jsonb_agg(permission ORDER BY ordinal)
        FROM jsonb_array_elements_text(COALESCE(default_permissions, '[]'::jsonb))
          WITH ORDINALITY AS permission_rows(permission, ordinal)
        WHERE permission <> 'report-up-cases'
      ), '[]'::jsonb)
    `);
    await queryRunner.query(`
      UPDATE users SET permissions = COALESCE((
        SELECT jsonb_agg(permission ORDER BY ordinal)
        FROM jsonb_array_elements_text(COALESCE(permissions, '[]'::jsonb))
          WITH ORDINALITY AS permission_rows(permission, ordinal)
        WHERE permission <> 'report-up-cases'
      ), '[]'::jsonb)
    `);

    await queryRunner.query(`DROP TABLE case_report_ups`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO case_workflow_statuses (
        code, label_th, badge_variant, summary_tone, sort_order, is_active
      ) VALUES ('REPORTED_UP', 'รายงานขึ้นส่วนกลางแล้ว', 'destructive', 'danger', 45, TRUE)
    `);
    await queryRunner.query(`
      CREATE TABLE case_report_ups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id INTEGER NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE ON UPDATE CASCADE,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        reported_by_label VARCHAR(255),
        report_reason VARCHAR(500),
        report_summary VARCHAR(2000),
        school_name_snapshot VARCHAR(255),
        province_snapshot VARCHAR(255),
        district_snapshot VARCHAR(255),
        sub_district_snapshot VARCHAR(255),
        reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      INSERT INTO case_report_ups (
        id, case_id, school_id, reported_by, reported_by_label, report_reason,
        report_summary, school_name_snapshot, province_snapshot, district_snapshot,
        sub_district_snapshot, reported_at
      )
      SELECT
        id, case_id, school_id, reported_by, reported_by_label, report_reason,
        report_summary, school_name_snapshot, province_snapshot, district_snapshot,
        sub_district_snapshot, reported_at
      FROM case_tracking_report_up_backup_20260720
    `);
    await queryRunner.query(
      `CREATE INDEX idx_case_report_ups_case_time ON case_report_ups (case_id, reported_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_case_report_ups_school_time ON case_report_ups (school_id, reported_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_case_report_ups_province_time ON case_report_ups (province_snapshot, reported_at DESC)`,
    );

    await queryRunner.query(
      `ALTER TABLE case_reviews DROP CONSTRAINT IF EXISTS fk_case_reviews_action`,
    );
    await queryRunner.query(
      `ALTER TABLE case_reviews DROP CONSTRAINT IF EXISTS fk_case_reviews_resolution_outcome`,
    );
    await queryRunner.query(
      `ALTER TABLE case_reviews DROP CONSTRAINT IF EXISTS fk_case_reviews_source_actor`,
    );
    await queryRunner.query(
      `ALTER TABLE case_reviews DROP CONSTRAINT IF EXISTS chk_case_reviews_action_outcome`,
    );
    await queryRunner.query(
      `UPDATE case_reviews SET review_action = 'ASSIST' WHERE review_action = 'CONTINUE'`,
    );
    await queryRunner.query(`
      DELETE FROM case_reviews review
      USING case_tracking_report_up_backup_20260720 backup
      WHERE review.id = backup.id
    `);
    await queryRunner.query(`ALTER TABLE case_reviews DROP COLUMN source_actor_user_id`);
    await queryRunner.query(`ALTER TABLE case_reviews DROP COLUMN review_summary`);
    await queryRunner.query(`
      ALTER TABLE case_reviews ADD CONSTRAINT chk_case_reviews_resolution_outcome CHECK (
        resolution_outcome IS NULL OR resolution_outcome IN (
          'RETURNED_TO_SCHOOL', 'TRANSFERRED_SCHOOL', 'ILLNESS',
          'WORKING', 'UNREACHABLE', 'OTHER'
        )
      )
    `);

    await queryRunner.query(
      `ALTER TABLE task_submissions DROP CONSTRAINT IF EXISTS chk_task_submission_case_decision`,
    );
    await queryRunner.query(
      `ALTER TABLE task_submissions DROP CONSTRAINT IF EXISTS fk_task_submissions_resolution_outcome`,
    );
    await queryRunner.query(
      `ALTER TABLE task_submissions DROP CONSTRAINT IF EXISTS fk_task_submissions_follow_up_decision`,
    );
    await queryRunner.query(
      `ALTER TABLE task_submissions DROP COLUMN case_resolution_outcome_code`,
    );
    await queryRunner.query(`ALTER TABLE task_submissions DROP COLUMN case_follow_up_decision`);

    await queryRunner.query(`
      UPDATE cases case_record SET status = backup.previous_status
      FROM case_tracking_status_backup_20260720 backup
      WHERE backup.case_id = case_record.id
    `);
    await queryRunner.query(`
      UPDATE roles role_record SET default_permissions = backup.default_permissions
      FROM case_tracking_role_permission_backup_20260720 backup
      WHERE backup.role_id = role_record.id
    `);
    await queryRunner.query(`
      UPDATE users user_record SET permissions = backup.permissions
      FROM case_tracking_user_permission_backup_20260720 backup
      WHERE backup.user_id = user_record.id
    `);

    await queryRunner.query(`DROP TABLE case_tracking_status_backup_20260720`);
    await queryRunner.query(`DROP TABLE case_tracking_report_up_backup_20260720`);
    await queryRunner.query(`DROP TABLE case_tracking_user_permission_backup_20260720`);
    await queryRunner.query(`DROP TABLE case_tracking_role_permission_backup_20260720`);
    await queryRunner.query(`DROP TABLE case_follow_up_decisions`);
    await queryRunner.query(`DROP TABLE case_review_actions`);
    await queryRunner.query(`DROP TABLE case_resolution_outcomes`);
  }
}
