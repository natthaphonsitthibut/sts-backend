import type { MigrationInterface, QueryRunner } from 'typeorm';

const TYPE_CODES = ['STUDENT_ACCOUNT_BATCH_COMPLETED', 'STUDENT_ACCOUNT_BATCH_FAILED'];

export class AddStudentAccountBatchNotificationTypes20260704120000 implements MigrationInterface {
  name = 'AddStudentAccountBatchNotificationTypes20260704120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO notification_types (code, label_th, required_permission, sort_order)
      VALUES
        ('${TYPE_CODES[0]}', 'สร้างบัญชีนักเรียนเสร็จแล้ว', 'manage-student-accounts', 70),
        ('${TYPE_CODES[1]}', 'สร้างบัญชีนักเรียนไม่สำเร็จ', 'manage-student-accounts', 80)
      ON CONFLICT (code) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM notifications WHERE type_code = ANY($1::varchar[])`, [
      TYPE_CODES,
    ]);
    await queryRunner.query(`DELETE FROM notification_types WHERE code = ANY($1::varchar[])`, [
      TYPE_CODES,
    ]);
  }
}
