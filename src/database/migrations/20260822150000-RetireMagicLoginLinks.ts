import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the magic-login link type.
 *
 * `/task/:token` has answered "ประเภทที่ไม่รองรับ" for a LOGIN link since the
 * follow-up/assistance split, and nothing in the frontend calls the verify
 * endpoint any more — the type survived only as code and three columns nobody
 * writes. What was left behind was worse than dead weight: `task_links` carried
 * `login_role`, `login_permissions` and `login_data_scope`, a second place where
 * a role and a permission list could be handed out, right after the permission
 * model was collapsed to one name per page.
 *
 * The demo LOGIN tasks and their audit entries go with it. Those log rows are
 * demo traffic for a flow that no longer exists, so the append-only guard is
 * lifted for exactly one DELETE and restored in a `finally` — the same narrow
 * exception used when the retired student accounts were removed.
 *
 * `down()` restores the columns and the `LOGIN` row so the schema can be walked
 * back; the demo tasks themselves are not recreated.
 */
export class RetireMagicLoginLinks20260822150000 implements MigrationInterface {
  name = 'RetireMagicLoginLinks20260822150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const loginTaskIds = `(SELECT id FROM tasks WHERE task_type = 'LOGIN')`;

    await queryRunner.query(`ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable`);
    try {
      await queryRunner.query(`
        DELETE FROM audit_log
        WHERE target_type IN ('tasks', 'task_links')
          AND target_id IN (
            SELECT id::text FROM tasks WHERE task_type = 'LOGIN'
            UNION ALL
            SELECT id::text FROM task_links WHERE task_id IN ${loginTaskIds}
          )
      `);
    } finally {
      await queryRunner.query(`ALTER TABLE audit_log ENABLE TRIGGER trg_audit_log_immutable`);
    }

    await queryRunner.query(`DELETE FROM task_links WHERE task_id IN ${loginTaskIds}`);
    await queryRunner.query(`DELETE FROM tasks WHERE task_type = 'LOGIN'`);
    await queryRunner.query(`DELETE FROM task_types WHERE code = 'LOGIN'`);

    await queryRunner.query(`
      ALTER TABLE task_links
        DROP COLUMN IF EXISTS login_role,
        DROP COLUMN IF EXISTS login_permissions,
        DROP COLUMN IF EXISTS login_data_scope
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD COLUMN IF NOT EXISTS login_role TEXT,
        ADD COLUMN IF NOT EXISTS login_permissions JSONB,
        ADD COLUMN IF NOT EXISTS login_data_scope JSONB
    `);
    await queryRunner.query(`
      INSERT INTO task_types (code, label_th, sort_order)
      VALUES ('LOGIN', 'ลิงก์เข้าใช้งาน', 30)
      ON CONFLICT (code) DO NOTHING
    `);
  }
}
