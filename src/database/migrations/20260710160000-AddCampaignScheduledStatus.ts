import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a fourth recruitment-campaign state, SCHEDULED ("รอเปิด"), for campaigns
 * whose opens_at is still in the future. Previously such campaigns were labelled
 * EXPIRED ("หมดอายุ"), which read as "already over" for something not yet open.
 * Mirrors the scheduled-link concept shared with task_links (TASK_LINK_STATE).
 */
export class AddCampaignScheduledStatus20260710160000 implements MigrationInterface {
  name = 'AddCampaignScheduledStatus20260710160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Widen the CHECK constraint to allow SCHEDULED
    await queryRunner.query(`
      ALTER TABLE follower_recruitment_campaigns
        DROP CONSTRAINT IF EXISTS chk_frc_status
    `);
    await queryRunner.query(`
      ALTER TABLE follower_recruitment_campaigns
        ADD CONSTRAINT chk_frc_status
          CHECK (status IN ('ACTIVE', 'LOCKED', 'EXPIRED', 'SCHEDULED'))
    `);

    // 2. Backfill: not-yet-opened, still-active, not-yet-closed campaigns → SCHEDULED
    await queryRunner.query(`
      UPDATE follower_recruitment_campaigns
      SET status = 'SCHEDULED'
      WHERE deleted_at IS NULL
        AND is_active = true
        AND opens_at IS NOT NULL AND opens_at > now()
        AND (closes_at IS NULL OR closes_at > now())
    `);

    // 3. Catalog entry — same wording posture as TASK_LINK_STATE (neutral tone)
    await queryRunner.query(`
      INSERT INTO application_display_states (
        domain_code, code, label_th, badge_variant, summary_tone, sort_order
      ) VALUES
        ('RECRUITMENT_CAMPAIGN_STATE', 'SCHEDULED', 'รอเปิด', 'secondary', 'info', 5)
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
    // Revert SCHEDULED rows to the previous EXPIRED labelling before narrowing
    // the constraint again, so the CHECK can be re-applied without violation.
    await queryRunner.query(`
      UPDATE follower_recruitment_campaigns
      SET status = 'EXPIRED'
      WHERE status = 'SCHEDULED'
    `);
    await queryRunner.query(`
      DELETE FROM application_display_states
      WHERE domain_code = 'RECRUITMENT_CAMPAIGN_STATE' AND code = 'SCHEDULED'
    `);
    await queryRunner.query(`
      ALTER TABLE follower_recruitment_campaigns
        DROP CONSTRAINT IF EXISTS chk_frc_status
    `);
    await queryRunner.query(`
      ALTER TABLE follower_recruitment_campaigns
        ADD CONSTRAINT chk_frc_status
          CHECK (status IN ('ACTIVE', 'LOCKED', 'EXPIRED'))
    `);
  }
}
