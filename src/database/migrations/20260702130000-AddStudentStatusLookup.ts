import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const STATUS_CATEGORIES =
  "'ACTIVE', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED', 'DECEASED', 'UNMAPPED'";

/**
 * EXPAND — canonical, editable lookup for ONEC enrollment status codes.
 *
 * The legacy source code remains intact in `StudentStatusID_Onec`. The nullable
 * canonical FK is backfilled only for known lookup values, so future/unknown
 * ONEC codes remain importable and can be surfaced as UNMAPPED without a fake
 * reference. `requires_followup` is policy metadata only and never creates or
 * changes a case by itself.
 */
export class AddStudentStatusLookup20260702130000 implements MigrationInterface {
  name = 'AddStudentStatusLookup20260702130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_status (
        code INTEGER PRIMARY KEY,
        label_th VARCHAR(100) NOT NULL,
        category VARCHAR(32) NOT NULL,
        is_active_for_login BOOLEAN NOT NULL DEFAULT FALSE,
        is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
        requires_followup BOOLEAN NOT NULL DEFAULT FALSE,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order SMALLINT NOT NULL,
        source_system VARCHAR(32) NOT NULL DEFAULT 'ONEC',
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_student_status_category CHECK (category IN (${STATUS_CATEGORIES})),
        CONSTRAINT chk_student_status_sort_order CHECK (sort_order >= 0),
        CONSTRAINT chk_student_status_source_system CHECK (length(trim(source_system)) > 0),
        CONSTRAINT chk_student_status_label_th CHECK (length(trim(label_th)) > 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('student_status'));

    await queryRunner.query(`
      INSERT INTO student_status (
        code, label_th, category, is_active_for_login, is_terminal,
        requires_followup, is_enabled, sort_order, source_system
      )
      VALUES
        (10, 'กำลังศึกษา', 'ACTIVE', TRUE, FALSE, FALSE, TRUE, 10, 'ONEC'),
        (20, 'จบการศึกษา', 'GRADUATED', FALSE, TRUE, FALSE, TRUE, 20, 'ONEC'),
        (30, 'ลาออก/จำหน่าย', 'WITHDRAWN', FALSE, TRUE, TRUE, TRUE, 30, 'ONEC'),
        (40, 'ย้ายสถานศึกษา', 'TRANSFERRED', FALSE, TRUE, FALSE, TRUE, 40, 'ONEC')
      ON CONFLICT (code) DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE student_term
        ADD COLUMN IF NOT EXISTS student_status_code INTEGER
    `);
    await queryRunner.query(`
      UPDATE student_term AS enrollment
      SET student_status_code = status.code
      FROM student_status AS status
      WHERE enrollment.student_status_code IS NULL
        AND enrollment."StudentStatusID_Onec" = status.code
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_term_student_status'
        ) THEN
          ALTER TABLE student_term
            ADD CONSTRAINT fk_student_term_student_status
            FOREIGN KEY (student_status_code) REFERENCES student_status(code)
            ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_student_term_student_status_code
        ON student_term (student_status_code)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_student_term_student_status_code`);
    await queryRunner.query(`
      ALTER TABLE student_term DROP CONSTRAINT IF EXISTS fk_student_term_student_status
    `);
    await queryRunner.query(`
      ALTER TABLE student_term DROP COLUMN IF EXISTS student_status_code
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS student_status`);
  }
}
