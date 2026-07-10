import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets any task link (LOGIN / ATTENDANCE / VISIT magic links) be scheduled to
 * open at a future time via a nullable opens_at. Until opens_at the link is not
 * redeemable and reads as SCHEDULED ("รอเปิด") — the same scheduled-link concept
 * already used by recruitment campaigns, so all links share one vocabulary.
 * NULL opens_at = opens immediately (existing behaviour, fully backward compatible).
 */
export class AddTaskLinkScheduledOpen20260710170000 implements MigrationInterface {
  name = 'AddTaskLinkScheduledOpen20260710170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD COLUMN IF NOT EXISTS opens_at TIMESTAMP WITH TIME ZONE NULL
    `);

    await queryRunner.query(`
      INSERT INTO application_display_states (
        domain_code, code, label_th, badge_variant, summary_tone, sort_order
      ) VALUES
        ('TASK_LINK_STATE', 'SCHEDULED', 'รอเปิด', 'secondary', 'info', 5)
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
      WHERE domain_code = 'TASK_LINK_STATE' AND code = 'SCHEDULED'
    `);
    await queryRunner.query(`
      ALTER TABLE task_links DROP COLUMN IF EXISTS opens_at
    `);
  }
}
