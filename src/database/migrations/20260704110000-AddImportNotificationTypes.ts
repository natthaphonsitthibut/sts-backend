import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImportNotificationTypes20260704110000 implements MigrationInterface {
  name = 'AddImportNotificationTypes20260704110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO notification_types (code, label_th, required_permission, sort_order)
      VALUES
        ('IMPORT_COMPLETED', 'นำเข้าข้อมูลเสร็จแล้ว', 'import-data', 50),
        ('IMPORT_FAILED', 'นำเข้าข้อมูลไม่สำเร็จ', 'import-data', 60)
      ON CONFLICT (code) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM notifications
      WHERE type_code IN ('IMPORT_COMPLETED', 'IMPORT_FAILED')
    `);
    await queryRunner.query(`
      DELETE FROM notification_types
      WHERE code IN ('IMPORT_COMPLETED', 'IMPORT_FAILED')
    `);
  }
}
