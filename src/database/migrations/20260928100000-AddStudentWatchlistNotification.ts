import type { MigrationInterface, QueryRunner } from 'typeorm';

const TYPE_CODE = 'STUDENT_WATCHLIST_ALERT';

/**
 * FN-STS-28 — alert when a teacher's comment puts a student into the
 * เฝ้าระวัง group (level ควรเฝ้าดู or น่ากังวล). The inbox so far only carried
 * case status changes, and its CHECKs pinned every row to that one type with a
 * case attached. This adds the second type and makes the constraints say, per
 * type, what each row must carry:
 *
 * - CASE_STATUS_CHANGED: a case and its status, as before;
 * - STUDENT_WATCHLIST_ALERT: a student and no case (the comment is the
 *   reference, in ref_entity/ref_id).
 *
 * Every type names its student, so the snapshot check no longer depends on the
 * type. Recipients are resolved by the existing scope fan-out and the
 * type's required page (`dashboard`, which holds the กลุ่มเฝ้าระวัง tab).
 *
 * `down()` deletes the new type's rows, then restores the original constraints.
 */
export class AddStudentWatchlistNotification20260928100000 implements MigrationInterface {
  name = 'AddStudentWatchlistNotification20260928100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO notification_types (code, label_th, required_permission, is_enabled, sort_order)
      VALUES ($1, 'นักเรียนเข้ากลุ่มเฝ้าระวัง', 'dashboard', TRUE, 20)
      ON CONFLICT (code) DO NOTHING
    `,
      [TYPE_CODE],
    );
    await queryRunner.query(`
      ALTER TABLE notifications ALTER COLUMN case_status_code DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE notifications
        DROP CONSTRAINT chk_notifications_case_context,
        ADD CONSTRAINT chk_notifications_case_context CHECK (
          (type_code = 'CASE_STATUS_CHANGED'
            AND case_id IS NOT NULL
            AND case_status_code IS NOT NULL)
          OR (type_code = '${TYPE_CODE}'
            AND case_id IS NULL
            AND case_status_code IS NULL
            AND student_person_uuid IS NOT NULL)
        ),
        DROP CONSTRAINT chk_notifications_student_context,
        ADD CONSTRAINT chk_notifications_student_context CHECK (
          student_name_snapshot IS NOT NULL AND length(btrim(student_name_snapshot)) > 0
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM notifications WHERE type_code = $1`, [TYPE_CODE]);
    await queryRunner.query(`
      ALTER TABLE notifications
        DROP CONSTRAINT chk_notifications_case_context,
        ADD CONSTRAINT chk_notifications_case_context CHECK (
          type_code = 'CASE_STATUS_CHANGED'
          AND case_id IS NOT NULL
          AND case_status_code IS NOT NULL
        ),
        DROP CONSTRAINT chk_notifications_student_context,
        ADD CONSTRAINT chk_notifications_student_context CHECK (
          type_code = 'CASE_STATUS_CHANGED'
          AND student_name_snapshot IS NOT NULL
          AND length(btrim(student_name_snapshot)) > 0
        )
    `);
    await queryRunner.query(`
      ALTER TABLE notifications ALTER COLUMN case_status_code SET NOT NULL
    `);
    await queryRunner.query(`DELETE FROM notification_types WHERE code = $1`, [TYPE_CODE]);
  }
}
