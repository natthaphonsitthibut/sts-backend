import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCaseFollowingWorkflow20260802120000 implements MigrationInterface {
  name = 'UpdateCaseFollowingWorkflow20260802120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO case_workflow_statuses (
        code, label_th, badge_variant, summary_tone, sort_order
      ) VALUES
        ('STUDENT_NOT_FOUND', 'ไม่พบนักเรียน', 'destructive', 'danger', 40)
      ON CONFLICT (code) DO UPDATE SET
        label_th = EXCLUDED.label_th,
        badge_variant = EXCLUDED.badge_variant,
        summary_tone = EXCLUDED.summary_tone,
        sort_order = EXCLUDED.sort_order,
        is_active = TRUE,
        deleted_at = NULL
    `);
    await queryRunner.query(`
      UPDATE case_workflow_statuses
      SET label_th = CASE code
        WHEN 'OPEN' THEN 'รอมอบหมาย'
        WHEN 'IN_PROGRESS' THEN 'รอติดตาม'
        WHEN 'PENDING_REVIEW' THEN 'รอพิจารณา'
        WHEN 'RESOLVED' THEN 'เสร็จสิ้น'
        ELSE label_th
      END
      WHERE code IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'RESOLVED')
    `);
    await queryRunner.query(`
      CREATE TABLE case_completion_outcomes (
        code VARCHAR(40) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ,
        created_by INTEGER,
        updated_by INTEGER,
        deleted_by INTEGER,
        CONSTRAINT chk_case_completion_outcomes_label CHECK (length(trim(label_th)) > 0),
        CONSTRAINT chk_case_completion_outcomes_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      INSERT INTO case_completion_outcomes (code, label_th, sort_order) VALUES
        ('CLOSED', 'ปิดเคส', 10),
        ('REFERRED_AGENCY', 'ส่งต่อหน่วยงาน', 20)
    `);
    await queryRunner.query(`
      ALTER TABLE cases
        ADD COLUMN completion_outcome_code VARCHAR(40),
        ADD CONSTRAINT fk_cases_completion_outcome
          FOREIGN KEY (completion_outcome_code) REFERENCES case_completion_outcomes(code)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      UPDATE cases SET completion_outcome_code = 'CLOSED'
      WHERE status = 'RESOLVED' AND completion_outcome_code IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE cases ADD CONSTRAINT chk_cases_completion_outcome
      CHECK (
        (status = 'RESOLVED' AND completion_outcome_code IS NOT NULL)
        OR (status <> 'RESOLVED' AND completion_outcome_code IS NULL)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE case_review_actions
        ADD COLUMN completion_outcome_code VARCHAR(40),
        ADD CONSTRAINT fk_case_review_actions_completion_outcome
          FOREIGN KEY (completion_outcome_code) REFERENCES case_completion_outcomes(code)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      UPDATE case_review_actions
      SET is_active = FALSE, updated_at = now()
      WHERE code = 'CONTINUE'
    `);
    await queryRunner.query(`
      UPDATE case_review_actions
      SET label_th = 'ปิดเคส', target_case_status_code = 'RESOLVED',
          completion_outcome_code = 'CLOSED', requires_resolution_outcome = FALSE,
          sort_order = 20, is_active = TRUE, deleted_at = NULL, updated_at = now()
      WHERE code = 'CLOSE'
    `);
    await queryRunner.query(`
      INSERT INTO case_review_actions (
        code, label_th, target_case_status_code, completion_outcome_code,
        requires_resolution_outcome, required_permission_code, sort_order
      ) VALUES (
        'REFER_AGENCY', 'ส่งต่อหน่วยงาน', 'RESOLVED', 'REFERRED_AGENCY',
        FALSE, 'review-cases', 10
      )
      ON CONFLICT (code) DO UPDATE SET
        label_th = EXCLUDED.label_th,
        target_case_status_code = EXCLUDED.target_case_status_code,
        completion_outcome_code = EXCLUDED.completion_outcome_code,
        requires_resolution_outcome = EXCLUDED.requires_resolution_outcome,
        required_permission_code = EXCLUDED.required_permission_code,
        sort_order = EXCLUDED.sort_order,
        is_active = TRUE,
        deleted_at = NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE case_review_actions SET is_active = FALSE WHERE code = 'REFER_AGENCY'`,
    );
    await queryRunner.query(`
      UPDATE case_review_actions
      SET label_th = 'ปิดเคส', target_case_status_code = 'RESOLVED',
          requires_resolution_outcome = TRUE, completion_outcome_code = NULL,
          sort_order = 20, is_active = TRUE
      WHERE code = 'CLOSE'
    `);
    await queryRunner.query(
      `UPDATE case_review_actions SET is_active = TRUE WHERE code = 'CONTINUE'`,
    );
    await queryRunner.query(
      `ALTER TABLE case_review_actions DROP CONSTRAINT fk_case_review_actions_completion_outcome`,
    );
    await queryRunner.query(`ALTER TABLE case_review_actions DROP COLUMN completion_outcome_code`);
    await queryRunner.query(`ALTER TABLE cases DROP CONSTRAINT chk_cases_completion_outcome`);
    await queryRunner.query(`ALTER TABLE cases DROP CONSTRAINT fk_cases_completion_outcome`);
    await queryRunner.query(`ALTER TABLE cases DROP COLUMN completion_outcome_code`);
    await queryRunner.query(`DROP TABLE case_completion_outcomes`);
    await queryRunner.query(`DELETE FROM case_workflow_statuses WHERE code = 'STUDENT_NOT_FOUND'`);
    await queryRunner.query(`
      UPDATE case_workflow_statuses
      SET label_th = CASE code
        WHEN 'OPEN' THEN 'รอสร้างลิงก์'
        WHEN 'IN_PROGRESS' THEN 'กำลังติดตาม'
        WHEN 'PENDING_REVIEW' THEN 'รอตรวจผล'
        WHEN 'RESOLVED' THEN 'ปิดเคสแล้ว'
        ELSE label_th
      END
      WHERE code IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'RESOLVED')
    `);
  }
}
