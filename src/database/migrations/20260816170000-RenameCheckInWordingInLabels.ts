import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * เจ้าของระบบสั่งให้ใช้คำว่า "เช็กชื่อ" แทน "เช็คชื่อ" ทุกจุด. The screens read
 * their wording from the catalogs, so the stored labels have to move with the
 * code — otherwise a page shows "เช็กชื่อ" in its heading and "เช็คชื่อ" in the
 * badge next to it.
 */
export class RenameCheckInWordingInLabels20260816170000 implements MigrationInterface {
  name = 'RenameCheckInWordingInLabels20260816170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE application_display_states
      SET label_th = REPLACE(label_th, 'เช็ค', 'เช็ก'), updated_at = now()
      WHERE label_th LIKE '%เช็ค%';

      UPDATE attendance_session_statuses
      SET label_th = REPLACE(label_th, 'เช็ค', 'เช็ก'), updated_at = now()
      WHERE label_th LIKE '%เช็ค%';

      UPDATE system_settings
      SET description = REPLACE(description, 'เช็ค', 'เช็ก'), updated_at = now()
      WHERE description LIKE '%เช็ค%';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE application_display_states
      SET label_th = REPLACE(label_th, 'เช็ก', 'เช็ค'), updated_at = now()
      WHERE label_th LIKE '%เช็ก%';

      UPDATE attendance_session_statuses
      SET label_th = REPLACE(label_th, 'เช็ก', 'เช็ค'), updated_at = now()
      WHERE label_th LIKE '%เช็ก%';

      UPDATE system_settings
      SET description = REPLACE(description, 'เช็ก', 'เช็ค'), updated_at = now()
      WHERE description LIKE '%เช็ก%';
    `);
  }
}
