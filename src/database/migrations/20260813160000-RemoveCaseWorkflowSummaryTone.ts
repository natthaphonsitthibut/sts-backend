import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Case-status colour is presentation owned by the frontend status-code map.
 * Keeping a second persisted tone let the database and UI drift apart.
 */
export class RemoveCaseWorkflowSummaryTone20260813160000 implements MigrationInterface {
  name = 'RemoveCaseWorkflowSummaryTone20260813160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_workflow_statuses
        DROP CONSTRAINT IF EXISTS chk_case_workflow_statuses_summary_tone
    `);
    await queryRunner.query(`
      ALTER TABLE case_workflow_statuses
        DROP COLUMN IF EXISTS summary_tone
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_workflow_statuses
        ADD COLUMN IF NOT EXISTS summary_tone VARCHAR(16) NOT NULL DEFAULT 'default'
    `);
    await queryRunner.query(`
      UPDATE case_workflow_statuses
      SET summary_tone = CASE code
        WHEN 'OPEN' THEN 'default'
        WHEN 'PENDING_REVIEW' THEN 'info'
        WHEN 'IN_PROGRESS' THEN 'warning'
        WHEN 'STUDENT_NOT_FOUND' THEN 'danger'
        WHEN 'RESOLVED' THEN 'success'
        ELSE 'default'
      END
    `);
    await queryRunner.query(`
      ALTER TABLE case_workflow_statuses
        DROP CONSTRAINT IF EXISTS chk_case_workflow_statuses_summary_tone,
        ADD CONSTRAINT chk_case_workflow_statuses_summary_tone
          CHECK (summary_tone IN ('default', 'success', 'warning', 'danger', 'info')),
        ALTER COLUMN summary_tone DROP DEFAULT
    `);
  }
}
