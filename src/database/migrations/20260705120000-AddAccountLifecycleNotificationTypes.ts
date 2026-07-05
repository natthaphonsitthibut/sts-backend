import type { MigrationInterface, QueryRunner } from 'typeorm';

const TYPE_CODES = ['ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED'];

export class AddAccountLifecycleNotificationTypes20260705120000 implements MigrationInterface {
  name = 'AddAccountLifecycleNotificationTypes20260705120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO notification_types (code, label_th, required_permission, sort_order)
      VALUES
        ('${TYPE_CODES[0]}', 'บัญชีผู้ใช้งานถูกปิดใช้งาน', 'manage-users-list', 90),
        ('${TYPE_CODES[1]}', 'บัญชีผู้ใช้งานถูกเปิดใช้งานอีกครั้ง', 'manage-users-list', 100)
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
