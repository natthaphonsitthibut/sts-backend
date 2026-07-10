import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFieldFollowerStatusCatalog20260710140000 implements MigrationInterface {
  name = 'AddFieldFollowerStatusCatalog20260710140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO application_display_states (
        domain_code, code, label_th, badge_variant, summary_tone, sort_order
      ) VALUES
        ('FIELD_FOLLOWER_STATUS', 'APPLIED', 'รอตรวจสอบ', 'warning', NULL, 10),
        ('FIELD_FOLLOWER_STATUS', 'VERIFIED', 'ยืนยันตัวตน', 'secondary', NULL, 20),
        ('FIELD_FOLLOWER_STATUS', 'ACTIVE', 'ใช้งาน', 'success', NULL, 30),
        ('FIELD_FOLLOWER_STATUS', 'SUSPENDED', 'ระงับ', 'destructive', NULL, 40)
      ON CONFLICT (domain_code, code) DO UPDATE
      SET label_th = EXCLUDED.label_th,
          badge_variant = EXCLUDED.badge_variant,
          summary_tone = EXCLUDED.summary_tone,
          sort_order = EXCLUDED.sort_order,
          is_active = TRUE,
          updated_at = now()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM application_display_states
      WHERE domain_code = 'FIELD_FOLLOWER_STATUS'
    `);
  }
}
