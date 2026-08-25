import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A follow-up round and an assistance round record the same two outcome codes
 * but mean different things by them: assistance either succeeded or did not,
 * while a follow-up either found the student or did not. The wording therefore
 * belongs to the catalog per task type instead of being reworded in the UI.
 */
export class AddFollowUpOutcomeLabels20260827313100 implements MigrationInterface {
  name = 'AddFollowUpOutcomeLabels20260827313100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $prerequisites$
      BEGIN
        IF to_regclass('public.task_execution_outcome_options') IS NULL THEN
          RAISE EXCEPTION 'task_execution_outcome_options prerequisite is missing';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM task_execution_outcome_options WHERE code = 'SUCCEEDED'
        ) OR NOT EXISTS (
          SELECT 1 FROM task_execution_outcome_options WHERE code = 'NOT_SUCCEEDED'
        ) THEN
          RAISE EXCEPTION 'execution outcome catalog does not hold the expected codes';
        END IF;
      END
      $prerequisites$
    `);
    await queryRunner.query(`
      ALTER TABLE task_execution_outcome_options
        ADD COLUMN visit_label_th VARCHAR(200),
        ADD CONSTRAINT chk_task_execution_outcomes_visit_label CHECK (
          visit_label_th IS NULL OR btrim(visit_label_th) <> ''
        )
    `);
    await queryRunner.query(`
      UPDATE task_execution_outcome_options
      SET visit_label_th = CASE code
            WHEN 'SUCCEEDED' THEN 'พบนักเรียน'
            WHEN 'NOT_SUCCEEDED' THEN 'ไม่พบนักเรียน'
          END,
          updated_at = now()
      WHERE code IN ('SUCCEEDED', 'NOT_SUCCEEDED')
    `);
    await queryRunner.query(`
      UPDATE task_execution_outcome_options
      SET label_th = CASE code
            WHEN 'SUCCEEDED' THEN 'ช่วยเหลือสำเร็จ'
            WHEN 'NOT_SUCCEEDED' THEN 'ยังช่วยเหลือไม่สำเร็จ'
            ELSE label_th
          END,
          updated_at = now()
      WHERE code IN ('SUCCEEDED', 'NOT_SUCCEEDED')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE task_execution_outcome_options
      SET label_th = CASE code
            WHEN 'SUCCEEDED' THEN 'สำเร็จ'
            WHEN 'NOT_SUCCEEDED' THEN 'ยังไม่สำเร็จ'
            ELSE label_th
          END,
          updated_at = now()
      WHERE code IN ('SUCCEEDED', 'NOT_SUCCEEDED')
    `);
    await queryRunner.query(`
      ALTER TABLE task_execution_outcome_options
        DROP CONSTRAINT IF EXISTS chk_task_execution_outcomes_visit_label,
        DROP COLUMN IF EXISTS visit_label_th
    `);
  }
}
