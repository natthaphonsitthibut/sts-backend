import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

export class AddStudentStatusPresentation20260703130000 implements MigrationInterface {
  name = 'AddStudentStatusPresentation20260703130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE student_status_categories (
        code VARCHAR(32) PRIMARY KEY,
        label_th VARCHAR(100) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_student_status_categories_label CHECK (length(trim(label_th)) > 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('student_status_categories'));
    await queryRunner.query(`
      INSERT INTO student_status_categories (code, label_th, sort_order) VALUES
        ('ACTIVE', 'กำลังศึกษา', 10),
        ('GRADUATED', 'สำเร็จการศึกษา', 20),
        ('WITHDRAWN', 'ลาออก/พ้นสภาพ', 30),
        ('TRANSFERRED', 'ย้ายสถานศึกษา', 40),
        ('DECEASED', 'เสียชีวิต', 50),
        ('UNMAPPED', 'ยังไม่ได้จับคู่', 60)
    `);
    await queryRunner.query(
      `ALTER TABLE student_status DROP CONSTRAINT chk_student_status_category`,
    );
    await queryRunner.query(`
      ALTER TABLE student_status
      ADD CONSTRAINT fk_student_status_category
      FOREIGN KEY (category) REFERENCES student_status_categories(code)
      ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE student_status
      ADD COLUMN badge_variant VARCHAR(16) NOT NULL DEFAULT 'secondary'
    `);
    await queryRunner.query(`
      UPDATE student_status
      SET badge_variant = CASE
        WHEN category = 'ACTIVE' THEN 'success'
        WHEN category = 'UNMAPPED' THEN 'warning'
        ELSE 'secondary'
      END
    `);
    await queryRunner.query(`
      ALTER TABLE student_status
      ADD CONSTRAINT chk_student_status_badge_variant
      CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
    `);
    await queryRunner.query(`
      INSERT INTO application_display_states (
        domain_code, code, label_th, badge_variant, summary_tone, sort_order
      ) VALUES
        ('RECORD_ACTIVITY', 'ACTIVE', 'เปิดใช้งาน', 'success', NULL, 10),
        ('RECORD_ACTIVITY', 'INACTIVE', 'ปิดใช้งาน', 'secondary', NULL, 20),
        ('STUDENT_STATUS_FLAG', 'LOGIN_ALLOWED', 'นโยบาย: เข้าสู่ระบบได้', 'success', NULL, 10),
        ('STUDENT_STATUS_FLAG', 'TERMINAL', 'สิ้นสุด', 'secondary', NULL, 20),
        ('STUDENT_STATUS_FLAG', 'FOLLOWUP_REQUIRED', 'ควรพิจารณาติดตาม', 'warning', NULL, 30),
        ('STUDENT_STATUS_FLAG', 'DISABLED', 'ปิดใช้งาน', 'destructive', NULL, 40),
        ('ROLE_ORIGIN', 'SYSTEM', 'ระบบ', 'secondary', NULL, 10),
        ('ATTENDANCE_ANOMALY', 'HOLIDAY_ATTENDANCE', 'เช็คชื่อในวันหยุด', 'warning', NULL, 10),
        ('ATTENDANCE_ANOMALY', 'CANCELLED_ATTENDANCE', 'เช็คชื่อในวันที่ยกเลิกเรียน', 'warning', NULL, 20),
        ('ATTENDANCE_ANOMALY', 'OUT_OF_TERM', 'เช็คชื่อนอกช่วงภาคเรียน', 'destructive', NULL, 30),
        ('ATTENDANCE_ANOMALY', 'MISSING_CALENDAR_DAY', 'ไม่มีวันในปฏิทิน', 'secondary', NULL, 40)
      ON CONFLICT (domain_code, code) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM application_display_states
      WHERE domain_code IN ('RECORD_ACTIVITY','STUDENT_STATUS_FLAG','ROLE_ORIGIN','ATTENDANCE_ANOMALY')
    `);
    await queryRunner.query(`
      ALTER TABLE student_status DROP CONSTRAINT IF EXISTS chk_student_status_badge_variant
    `);
    await queryRunner.query(`ALTER TABLE student_status DROP COLUMN badge_variant`);
    await queryRunner.query(
      `ALTER TABLE student_status DROP CONSTRAINT fk_student_status_category`,
    );
    await queryRunner.query(`
      ALTER TABLE student_status ADD CONSTRAINT chk_student_status_category
      CHECK (category IN ('ACTIVE','GRADUATED','WITHDRAWN','TRANSFERRED','DECEASED','UNMAPPED'))
    `);
    await queryRunner.query(`DROP TABLE student_status_categories`);
  }
}
