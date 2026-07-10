import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecruitmentCampaignStatus20260710150000 implements MigrationInterface {
  name = 'AddRecruitmentCampaignStatus20260710150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add status column matching task_links pattern
    await queryRunner.query(`
      ALTER TABLE follower_recruitment_campaigns
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    `);

    // 2. Add check constraint for valid statuses (ACTIVE, LOCKED, EXPIRED)
    await queryRunner.query(`
      ALTER TABLE follower_recruitment_campaigns
        ADD CONSTRAINT chk_frc_status
          CHECK (status IN ('ACTIVE', 'LOCKED', 'EXPIRED'))
    `);

    // 3. Backfill existing rows:
    //    - is_active = false → LOCKED
    //    - closes_at is past  → EXPIRED
    //    - opens_at is future → EXPIRED (not yet open = not accessible)
    //    - otherwise          → ACTIVE
    await queryRunner.query(`
      UPDATE follower_recruitment_campaigns
      SET status = CASE
        WHEN is_active = false THEN 'LOCKED'
        WHEN closes_at IS NOT NULL AND closes_at <= now() THEN 'EXPIRED'
        WHEN opens_at IS NOT NULL AND opens_at > now() THEN 'EXPIRED'
        ELSE 'ACTIVE'
      END
      WHERE deleted_at IS NULL
    `);

    // 4. Add status catalog entries matching TASK_LINK_STATE wording exactly
    await queryRunner.query(`
      INSERT INTO application_display_states (
        domain_code, code, label_th, badge_variant, summary_tone, sort_order
      ) VALUES
        ('RECRUITMENT_CAMPAIGN_STATE', 'ACTIVE', 'ใช้งาน', 'success', 'success', 10),
        ('RECRUITMENT_CAMPAIGN_STATE', 'LOCKED', 'ปิดใช้งาน', 'destructive', 'danger', 20),
        ('RECRUITMENT_CAMPAIGN_STATE', 'EXPIRED', 'หมดอายุ', 'warning', 'warning', 30)
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
      WHERE domain_code = 'RECRUITMENT_CAMPAIGN_STATE'
    `);
    await queryRunner.query(`
      ALTER TABLE follower_recruitment_campaigns
        DROP CONSTRAINT IF EXISTS chk_frc_status
    `);
    await queryRunner.query(`
      ALTER TABLE follower_recruitment_campaigns
        DROP COLUMN IF EXISTS status
    `);
  }
}
