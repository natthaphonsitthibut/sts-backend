import type { MigrationInterface, QueryRunner } from 'typeorm';

const TYPE_CODE = 'TASK_OVERDUE';

export class AddOverdueTaskReminder20260705130000 implements MigrationInterface {
  name = 'AddOverdueTaskReminder20260705130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE task_links ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ`,
    );
    await queryRunner.query(`
      INSERT INTO notification_types (code, label_th, required_permission, sort_order)
      VALUES ('${TYPE_CODE}', 'งานเยี่ยมบ้านเลยกำหนด', 'create', 110)
      ON CONFLICT (code) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM notifications WHERE type_code = $1`, [TYPE_CODE]);
    await queryRunner.query(`DELETE FROM notification_types WHERE code = $1`, [TYPE_CODE]);
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS overdue_notified_at`);
  }
}
