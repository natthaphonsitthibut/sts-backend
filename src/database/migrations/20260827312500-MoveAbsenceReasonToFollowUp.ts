import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Stores newly discovered absence causes with the follow-up evidence that established them. */
export class MoveAbsenceReasonToFollowUp20260827312500 implements MigrationInterface {
  name = 'MoveAbsenceReasonToFollowUp20260827312500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_submissions
        ADD COLUMN absence_reason_code VARCHAR(40) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        ADD CONSTRAINT fk_task_submissions_absence_reason
        FOREIGN KEY (absence_reason_code)
        REFERENCES absence_reasons(code)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX idx_task_submissions_absence_reason_submitted
      ON task_submissions (absence_reason_code, submitted_at DESC)
      WHERE absence_reason_code IS NOT NULL AND deleted_at IS NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_attendance_exceptions_reason_session`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_attendance_exceptions_absence_reason`);
    await queryRunner.query(`
      ALTER TABLE attendance_exceptions
        DROP CONSTRAINT IF EXISTS chk_attendance_exceptions_absence_reason,
        DROP CONSTRAINT IF EXISTS fk_attendance_exceptions_absence_reason,
        DROP COLUMN IF EXISTS absence_reason_code
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE attendance_exceptions
        ADD COLUMN absence_reason_code VARCHAR(40) NULL
    `);
    await queryRunner.query(`
      UPDATE attendance_exceptions
      SET absence_reason_code = 'UNKNOWN'
      WHERE attendance_status_code = 2
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_exceptions
        ADD CONSTRAINT fk_attendance_exceptions_absence_reason
          FOREIGN KEY (absence_reason_code) REFERENCES absence_reasons(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_attendance_exceptions_absence_reason CHECK (
          (attendance_status_code = 2 AND absence_reason_code IS NOT NULL)
          OR (attendance_status_code IN (3, 4) AND absence_reason_code IS NULL)
        )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_attendance_exceptions_absence_reason
      ON attendance_exceptions (absence_reason_code)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_attendance_exceptions_reason_session
      ON attendance_exceptions (absence_reason_code, session_id)
      WHERE attendance_status_code = 2
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_task_submissions_absence_reason_submitted
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT IF EXISTS fk_task_submissions_absence_reason
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP COLUMN IF EXISTS absence_reason_code
    `);
  }
}
