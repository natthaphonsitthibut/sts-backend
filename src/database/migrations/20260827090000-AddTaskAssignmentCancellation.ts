import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cancelling an assignment that was handed out but never reported on.
 *
 * "ปิดใช้งานโดยผู้ดูแล" (LOCKED) and "หมดอายุ" (EXPIRED) already exist, but
 * neither says what happened here: the case owner withdrew the assignment and
 * the case went back to รอมอบหมาย. It needs its own state so the badge, the
 * link check and the case history can tell the three apart, plus the reason the
 * owner typed — a withdrawal of someone else's work is not self-explanatory.
 */
export class AddTaskAssignmentCancellation20260827090000 implements MigrationInterface {
  name = 'AddTaskAssignmentCancellation20260827090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS cancelled_by INTEGER NULL REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS cancel_reason TEXT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE task_links
        DROP CONSTRAINT IF EXISTS chk_task_links_cancel_reason
    `);
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD CONSTRAINT chk_task_links_cancel_reason
          CHECK (
            cancel_reason IS NULL
            OR (BTRIM(cancel_reason) <> '' AND length(cancel_reason) <= 500)
          )
    `);
    // A cancelled link carries all three, or none of them.
    await queryRunner.query(`
      ALTER TABLE task_links
        DROP CONSTRAINT IF EXISTS chk_task_links_cancelled_together
    `);
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD CONSTRAINT chk_task_links_cancelled_together
          CHECK (
            (cancelled_at IS NULL AND cancel_reason IS NULL)
            OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)
          )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_links_cancelled_at
        ON task_links (cancelled_at)
        WHERE cancelled_at IS NOT NULL
    `);
    // `task_links.status` and `tasks.status` are FK-checked against their own
    // catalogues, so the two new states have to exist there before any row can
    // carry them. EXPIRED joins CANCELLED: expiry used to live only in a
    // read-side comparison against expires_at, and the sweep now writes it.
    await queryRunner.query(`
      INSERT INTO task_link_statuses (code, label_th, badge_variant, sort_order)
      VALUES
        ('CANCELLED', 'ยกเลิกแล้ว', 'destructive', 25),
        ('EXPIRED', 'หมดอายุ', 'warning', 20)
      ON CONFLICT (code) DO UPDATE
      SET label_th = EXCLUDED.label_th,
          badge_variant = EXCLUDED.badge_variant,
          sort_order = EXCLUDED.sort_order,
          is_active = TRUE,
          deleted_at = NULL,
          updated_at = now()
    `);
    await queryRunner.query(`
      INSERT INTO task_workflow_statuses (code, label_th, badge_variant, sort_order)
      VALUES
        ('CANCELLED', 'ยกเลิกแล้ว', 'destructive', 40),
        ('EXPIRED', 'หมดอายุ', 'warning', 50)
      ON CONFLICT (code) DO UPDATE
      SET label_th = EXCLUDED.label_th,
          badge_variant = EXCLUDED.badge_variant,
          sort_order = EXCLUDED.sort_order,
          is_active = TRUE,
          deleted_at = NULL,
          updated_at = now()
    `);
    await queryRunner.query(`
      INSERT INTO application_display_states (
        domain_code, code, label_th, badge_variant, summary_tone, sort_order
      ) VALUES
        ('TASK_LINK_STATE', 'CANCELLED', 'ยกเลิกแล้ว', 'destructive', 'danger', 25)
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
      WHERE domain_code = 'TASK_LINK_STATE' AND code = 'CANCELLED'
    `);
    // Only removable while nothing carries them.
    await queryRunner.query(`
      DELETE FROM task_link_statuses
      WHERE code IN ('CANCELLED', 'EXPIRED')
        AND NOT EXISTS (SELECT 1 FROM task_links WHERE status = task_link_statuses.code)
    `);
    await queryRunner.query(`
      DELETE FROM task_workflow_statuses
      WHERE code IN ('CANCELLED', 'EXPIRED')
        AND NOT EXISTS (SELECT 1 FROM tasks WHERE status = task_workflow_statuses.code)
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_links_cancelled_at`);
    await queryRunner.query(`
      ALTER TABLE task_links
        DROP CONSTRAINT IF EXISTS chk_task_links_cancelled_together,
        DROP CONSTRAINT IF EXISTS chk_task_links_cancel_reason,
        DROP COLUMN IF EXISTS cancel_reason,
        DROP COLUMN IF EXISTS cancelled_by,
        DROP COLUMN IF EXISTS cancelled_at
    `);
  }
}
