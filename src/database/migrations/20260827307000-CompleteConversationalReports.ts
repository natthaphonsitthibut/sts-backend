import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteConversationalReports20260827307000 implements MigrationInterface {
  name = 'CompleteConversationalReports20260827307000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $conversational_report_contract$
      DECLARE current_phase VARCHAR(24);
      BEGIN
        IF to_regclass('public.task_submissions') IS NULL
           OR to_regclass('public.case_review_actions') IS NULL THEN
          RAISE EXCEPTION 'conversational report prerequisites are missing';
        END IF;
        SELECT available_phase_code INTO current_phase
        FROM case_review_actions WHERE code = 'ASSIST';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'ASSIST review action is missing';
        END IF;
        IF current_phase IS NOT NULL AND current_phase <> 'FOLLOW_UP' THEN
          RAISE EXCEPTION 'unexpected ASSIST phase contract: %', current_phase;
        END IF;
      END
      $conversational_report_contract$
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
      ADD COLUMN execution_outcome_detail TEXT,
      ADD COLUMN contact_person_name VARCHAR(200),
      ADD COLUMN contact_channel_code VARCHAR(24),
      ADD CONSTRAINT chk_task_submissions_execution_outcome_detail CHECK (
        execution_outcome_detail IS NULL
        OR length(btrim(execution_outcome_detail)) BETWEEN 1 AND 2000
      ),
      ADD CONSTRAINT chk_task_submissions_contact_person_name CHECK (
        contact_person_name IS NULL OR length(btrim(contact_person_name)) BETWEEN 1 AND 200
      ),
      ADD CONSTRAINT chk_task_submissions_contact_channel_code CHECK (
        contact_channel_code IS NULL
        OR contact_channel_code IN ('IN_PERSON', 'PHONE', 'LINE', 'OTHER')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_tasks_case_round_history
      ON tasks (case_id, task_type, created_at DESC, id DESC)
      WHERE case_id IS NOT NULL AND deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_task_submissions_link_submitted
      ON task_submissions (task_link_id, submitted_at DESC, id DESC)
      WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      UPDATE case_review_actions
      SET available_phase_code = NULL, updated_at = now()
      WHERE code = 'ASSIST'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $conversational_report_rollback$
      DECLARE current_phase VARCHAR(24);
      BEGIN
        IF EXISTS (
          SELECT 1 FROM task_submissions
          WHERE execution_outcome_detail IS NOT NULL
             OR contact_person_name IS NOT NULL
             OR contact_channel_code IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'cannot drop execution_outcome_detail while report detail exists';
        END IF;
        SELECT available_phase_code INTO current_phase
        FROM case_review_actions WHERE code = 'ASSIST';
        IF NOT FOUND OR current_phase IS NOT NULL THEN
          RAISE EXCEPTION 'ASSIST action changed after migration; rollback refused';
        END IF;
      END
      $conversational_report_rollback$
    `);
    await queryRunner.query(`
      UPDATE case_review_actions
      SET available_phase_code = 'FOLLOW_UP', updated_at = now()
      WHERE code = 'ASSIST'
    `);
    await queryRunner.query(`DROP INDEX idx_task_submissions_link_submitted`);
    await queryRunner.query(`DROP INDEX idx_tasks_case_round_history`);
    await queryRunner.query(`
      ALTER TABLE task_submissions
      DROP CONSTRAINT chk_task_submissions_execution_outcome_detail,
      DROP CONSTRAINT chk_task_submissions_contact_person_name,
      DROP CONSTRAINT chk_task_submissions_contact_channel_code,
      DROP COLUMN execution_outcome_detail,
      DROP COLUMN contact_person_name,
      DROP COLUMN contact_channel_code
    `);
  }
}
