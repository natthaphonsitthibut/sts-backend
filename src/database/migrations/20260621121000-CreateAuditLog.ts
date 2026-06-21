import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create the immutable central `audit_log` for operational/security events.
 *
 * Deliberately does NOT use the shared audit columns: this is an append-only
 * event log (no updated_at/updated_by/deleted_at). A BEFORE UPDATE/DELETE
 * trigger raises, so the trail cannot be rewritten.
 */
export class CreateAuditLog20260621121000 implements MigrationInterface {
  name = 'CreateAuditLog20260621121000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        actor_label TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        metadata JSONB,
        ip TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_actor_user_id
        ON audit_log (actor_user_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_action
        ON audit_log (action)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
        ON audit_log (created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_target
        ON audit_log (target_type, target_id)
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_log_block_mutation()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'audit_log is append-only; % is not allowed', TG_OP;
        END;
        $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log`);
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_log_immutable
        BEFORE UPDATE OR DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_log_block_mutation()`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audit_log_target`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audit_log_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audit_log_action`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audit_log_actor_user_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS audit_log`);
  }
}
