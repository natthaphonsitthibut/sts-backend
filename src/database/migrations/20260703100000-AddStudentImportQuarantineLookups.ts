import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const BADGE_VARIANTS = "'default', 'secondary', 'destructive', 'success', 'warning'";

export class AddStudentImportQuarantineLookups20260703100000 implements MigrationInterface {
  name = 'AddStudentImportQuarantineLookups20260703100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_import_quarantine_statuses (
        code VARCHAR(16) PRIMARY KEY,
        label_th VARCHAR(100) NOT NULL,
        badge_variant VARCHAR(16) NOT NULL,
        sort_order SMALLINT NOT NULL,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_student_import_quarantine_statuses_code
          CHECK (code IN ('PENDING', 'RESOLVED', 'REJECTED')),
        CONSTRAINT chk_student_import_quarantine_statuses_badge_variant
          CHECK (badge_variant IN (${BADGE_VARIANTS})),
        CONSTRAINT chk_student_import_quarantine_statuses_sort_order CHECK (sort_order >= 0),
        CONSTRAINT chk_student_import_quarantine_statuses_label_th CHECK (length(trim(label_th)) > 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('student_import_quarantine_statuses'));

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_import_quarantine_reason_codes (
        code VARCHAR(64) PRIMARY KEY,
        label_th VARCHAR(160) NOT NULL,
        sort_order SMALLINT NOT NULL,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_student_import_quarantine_reason_codes_sort_order CHECK (sort_order >= 0),
        CONSTRAINT chk_student_import_quarantine_reason_codes_label_th CHECK (length(trim(label_th)) > 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('student_import_quarantine_reason_codes'));

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_import_quarantine_resolution_states (
        code VARCHAR(32) PRIMARY KEY,
        label_th VARCHAR(100) NOT NULL,
        badge_variant VARCHAR(16) NOT NULL,
        sort_order SMALLINT NOT NULL,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_student_import_quarantine_resolution_states_code
          CHECK (code IN ('ACTION_REQUIRED', 'DECISION_REQUIRED', 'RETRY_ELIGIBLE', 'BLOCKED')),
        CONSTRAINT chk_student_import_quarantine_resolution_states_badge_variant
          CHECK (badge_variant IN (${BADGE_VARIANTS})),
        CONSTRAINT chk_student_import_quarantine_resolution_states_sort_order CHECK (sort_order >= 0),
        CONSTRAINT chk_student_import_quarantine_resolution_states_label_th CHECK (length(trim(label_th)) > 0)
      )
    `);
    await queryRunner.query(
      auditUpdatedAtTriggerSql('student_import_quarantine_resolution_states'),
    );

    await queryRunner.query(`
      INSERT INTO student_import_quarantine_statuses (code, label_th, badge_variant, sort_order)
      VALUES
        ('PENDING', 'รอตรวจสอบ', 'warning', 10),
        ('RESOLVED', 'แก้ไขแล้ว', 'success', 20),
        ('REJECTED', 'ปฏิเสธแล้ว', 'secondary', 30)
      ON CONFLICT (code) DO UPDATE
      SET label_th = EXCLUDED.label_th,
          badge_variant = EXCLUDED.badge_variant,
          sort_order = EXCLUDED.sort_order
    `);

    await queryRunner.query(`
      INSERT INTO student_import_quarantine_resolution_states (
        code, label_th, badge_variant, sort_order
      )
      VALUES
        ('ACTION_REQUIRED', 'ต้องแก้ข้อมูล', 'warning', 10),
        ('DECISION_REQUIRED', 'ต้องตัดสินใจ', 'default', 20),
        ('RETRY_ELIGIBLE', 'ผ่านการตรวจเบื้องต้น', 'success', 30),
        ('BLOCKED', 'ต้องตรวจสอบเพิ่มเติม', 'secondary', 40)
      ON CONFLICT (code) DO UPDATE
      SET label_th = EXCLUDED.label_th,
          badge_variant = EXCLUDED.badge_variant,
          sort_order = EXCLUDED.sort_order
    `);

    await queryRunner.query(`
      INSERT INTO student_import_quarantine_reason_codes (code, label_th, sort_order)
      VALUES
        ('IDENTIFIER_CONFLICT', 'เลขนี้ตรงกับหลายโปรไฟล์ในระบบ', 10),
        ('UNMAPPED_STUDENT_STATUS', 'สถานะนักเรียนยังไม่จับคู่', 20),
        ('MISSING_NATURAL_KEY_FIELD', 'ข้อมูลภาคเรียนบังคับไม่ครบหรือไม่ถูกต้อง', 30),
        ('BLANK_REQUIRED_IDENTITY', 'ไม่มีรหัสประจำตัว', 40),
        ('DUPLICATE_ROW_IN_FILE', 'แถวซ้ำในไฟล์', 50),
        ('MULTIPLE_ACTIVE_ENROLLMENTS', 'พบการลงทะเบียนที่ยังใช้งานหลายรายการ', 60),
        ('NAME_CONFLICT_FOR_IDENTIFIER', 'ชื่อไม่ตรงกับรหัสประจำตัวเดิม', 70),
        ('INVALID_NATIONAL_ID_CHECKSUM', 'เลขประจำตัวประชาชนไม่ผ่านการตรวจสอบ', 80),
        ('SCHOOL_NOT_FOUND', 'ไม่พบโรงเรียนในข้อมูลหลัก', 90),
        ('GRADE_NOT_FOUND', 'ไม่พบชั้นเรียนในข้อมูลหลัก', 100),
        ('ROOM_NOT_FOUND', 'ไม่พบห้องเรียนในข้อมูลหลัก', 110),
        ('STATUS_CAUSE_UNMAPPED', 'สาเหตุสถานะนักเรียนยังไม่จับคู่', 120)
      ON CONFLICT (code) DO UPDATE
      SET label_th = EXCLUDED.label_th,
          sort_order = EXCLUDED.sort_order
    `);

    await queryRunner.query(`
      ALTER TABLE student_import_quarantine_rows
        DROP CONSTRAINT IF EXISTS chk_student_import_quarantine_status
    `);
    await queryRunner.query(`
      ALTER TABLE student_import_quarantine_rows
        DROP CONSTRAINT IF EXISTS chk_student_import_quarantine_reason
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_student_import_quarantine_rows_status'
        ) THEN
          ALTER TABLE student_import_quarantine_rows
            ADD CONSTRAINT fk_student_import_quarantine_rows_status
            FOREIGN KEY (status) REFERENCES student_import_quarantine_statuses(code)
            ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_student_import_quarantine_rows_reason_code'
        ) THEN
          ALTER TABLE student_import_quarantine_rows
            ADD CONSTRAINT fk_student_import_quarantine_rows_reason_code
            FOREIGN KEY (reason_code) REFERENCES student_import_quarantine_reason_codes(code)
            ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_import_quarantine_rows
        DROP CONSTRAINT IF EXISTS fk_student_import_quarantine_rows_reason_code
    `);
    await queryRunner.query(`
      ALTER TABLE student_import_quarantine_rows
        DROP CONSTRAINT IF EXISTS fk_student_import_quarantine_rows_status
    `);
    await queryRunner.query(`
      ALTER TABLE student_import_quarantine_rows
        ADD CONSTRAINT chk_student_import_quarantine_reason
        CHECK (reason_code IN ('MISSING_NATURAL_KEY_FIELD', 'UNMAPPED_STUDENT_STATUS',
          'DUPLICATE_ROW_IN_FILE', 'MULTIPLE_ACTIVE_ENROLLMENTS', 'IDENTIFIER_CONFLICT',
          'NAME_CONFLICT_FOR_IDENTIFIER', 'INVALID_NATIONAL_ID_CHECKSUM', 'SCHOOL_NOT_FOUND',
          'GRADE_NOT_FOUND', 'ROOM_NOT_FOUND', 'STATUS_CAUSE_UNMAPPED',
          'BLANK_REQUIRED_IDENTITY'))
    `);
    await queryRunner.query(`
      ALTER TABLE student_import_quarantine_rows
        ADD CONSTRAINT chk_student_import_quarantine_status
        CHECK (status IN ('PENDING', 'RESOLVED', 'REJECTED'))
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS student_import_quarantine_resolution_states`);
    await queryRunner.query(`DROP TABLE IF EXISTS student_import_quarantine_reason_codes`);
    await queryRunner.query(`DROP TABLE IF EXISTS student_import_quarantine_statuses`);
  }
}
