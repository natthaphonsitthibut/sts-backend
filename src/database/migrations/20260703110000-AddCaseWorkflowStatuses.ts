import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const BADGE_VARIANTS = "'default', 'secondary', 'destructive', 'success', 'warning'";
const SUMMARY_TONES = "'default', 'success', 'warning', 'danger', 'info'";

export class AddCaseWorkflowStatuses20260703110000 implements MigrationInterface {
  name = 'AddCaseWorkflowStatuses20260703110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE case_workflow_statuses (
        code VARCHAR(32) PRIMARY KEY,
        label_th VARCHAR(100) NOT NULL,
        badge_variant VARCHAR(16) NOT NULL,
        summary_tone VARCHAR(16) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_case_workflow_statuses_label_th CHECK (length(trim(label_th)) > 0),
        CONSTRAINT chk_case_workflow_statuses_badge_variant
          CHECK (badge_variant IN (${BADGE_VARIANTS})),
        CONSTRAINT chk_case_workflow_statuses_summary_tone
          CHECK (summary_tone IN (${SUMMARY_TONES})),
        CONSTRAINT chk_case_workflow_statuses_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('case_workflow_statuses'));
    await queryRunner.query(`
      INSERT INTO case_workflow_statuses (
        code, label_th, badge_variant, summary_tone, sort_order
      ) VALUES
        ('OPEN', 'รอสร้างลิงก์', 'secondary', 'default', 10),
        ('PENDING_REVIEW', 'รอตรวจผล', 'default', 'info', 20),
        ('IN_PROGRESS', 'กำลังติดตาม', 'warning', 'warning', 30),
        ('AWAITING_HELP', 'รอช่วยเหลือ', 'destructive', 'danger', 40),
        ('RESOLVED', 'ปิดเคสแล้ว', 'success', 'success', 50)
    `);
    await queryRunner.query(`ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_cases_status`);
    await queryRunner.query(`
      ALTER TABLE cases
      ADD CONSTRAINT fk_cases_workflow_status
      FOREIGN KEY (status) REFERENCES case_workflow_statuses(code)
      ON DELETE RESTRICT ON UPDATE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE cases DROP CONSTRAINT IF EXISTS fk_cases_workflow_status`);
    await queryRunner.query(`
      ALTER TABLE cases
      ADD CONSTRAINT chk_cases_status
      CHECK (status IN ('OPEN', 'IN_PROGRESS', 'AWAITING_HELP', 'PENDING_REVIEW', 'RESOLVED'))
    `);
    await queryRunner.query(`DROP TABLE case_workflow_statuses`);
  }
}
