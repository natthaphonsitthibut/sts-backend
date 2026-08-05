import type { MigrationInterface, QueryRunner } from 'typeorm';

const NEW_REASON_CODES = [
  'MISSING_IMPORT_FIELD',
  'CLASSROOM_IDENTITY_CONFLICT',
  'TEACHER_MEMBERSHIP_NOT_FOUND',
  'SUBJECT_NOT_FOUND',
  'INVALID_ASSIGNMENT_KIND',
  'INVALID_IMPORT_DATE',
  'ASSIGNMENT_CONFLICT',
] as const;

export class ExpandCanonicalImportTargets20260714280000 implements MigrationInterface {
  name = 'ExpandCanonicalImportTargets20260714280000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_import_batches
        DROP CONSTRAINT chk_student_import_batches_target;
      ALTER TABLE student_import_batches
        ADD CONSTRAINT chk_student_import_batches_target
          CHECK (target IN (
            'student_term',
            'student_exit_events',
            'school_teacher_membership',
            'school_classroom',
            'classroom_teacher_assignment'
          ));

      INSERT INTO student_import_quarantine_reason_codes (code, label_th, sort_order)
      VALUES
        ('MISSING_IMPORT_FIELD', 'ข้อมูลบังคับของรายการนำเข้าไม่ครบ', 180),
        ('CLASSROOM_IDENTITY_CONFLICT', 'รหัสหรือเลขห้องชนกับห้องเรียนเดิม', 190),
        ('TEACHER_MEMBERSHIP_NOT_FOUND', 'ไม่พบครูในรายชื่อครูของโรงเรียน', 200),
        ('SUBJECT_NOT_FOUND', 'ไม่พบวิชาในข้อมูลหลัก', 210),
        ('INVALID_ASSIGNMENT_KIND', 'ประเภทการมอบหมายครูไม่ถูกต้อง', 220),
        ('INVALID_IMPORT_DATE', 'ช่วงวันที่ของรายการนำเข้าไม่ถูกต้อง', 230),
        ('ASSIGNMENT_CONFLICT', 'การมอบหมายครูชนกับรายการที่ใช้งานอยู่', 240)
      ON CONFLICT (code) DO UPDATE
      SET label_th = EXCLUDED.label_th,
          sort_order = EXCLUDED.sort_order;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $target_rows$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM student_import_batches
          WHERE target IN ('school_classroom', 'classroom_teacher_assignment')
        ) THEN
          RAISE EXCEPTION 'cannot remove canonical import targets while import batches still reference them';
        END IF;
        IF EXISTS (
          SELECT 1
          FROM student_import_quarantine_rows
          WHERE reason_code = ANY(ARRAY[
            'MISSING_IMPORT_FIELD',
            'CLASSROOM_IDENTITY_CONFLICT',
            'TEACHER_MEMBERSHIP_NOT_FOUND',
            'SUBJECT_NOT_FOUND',
            'INVALID_ASSIGNMENT_KIND',
            'INVALID_IMPORT_DATE',
            'ASSIGNMENT_CONFLICT'
          ]::text[])
        ) THEN
          RAISE EXCEPTION 'cannot remove canonical import reasons while quarantine rows still reference them';
        END IF;
      END;
      $target_rows$;

      ALTER TABLE student_import_batches
        DROP CONSTRAINT chk_student_import_batches_target;
      ALTER TABLE student_import_batches
        ADD CONSTRAINT chk_student_import_batches_target
          CHECK (target IN ('student_term', 'student_exit_events', 'school_teacher_membership'));
    `);
    await queryRunner.query(
      `DELETE FROM student_import_quarantine_reason_codes WHERE code = ANY($1::text[])`,
      [NEW_REASON_CODES],
    );
  }
}
