import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPiiExportRequests20260705180000 implements MigrationInterface {
  name = 'AddPiiExportRequests20260705180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pii_export_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_user_id INTEGER NOT NULL
          CONSTRAINT fk_pii_export_requests_requester
          REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        approver_user_id INTEGER
          CONSTRAINT fk_pii_export_requests_approver
          REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        scope_snapshot JSONB NOT NULL,
        include_full_national_id BOOLEAN NOT NULL DEFAULT FALSE,
        reason_code VARCHAR(40) NOT NULL,
        reason_note TEXT,
        row_estimate INTEGER CHECK (row_estimate IS NULL OR row_estimate >= 0),
        download_token_hash TEXT,
        download_expires_at TIMESTAMPTZ,
        downloaded_at TIMESTAMPTZ,
        rejected_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_pii_export_requests_status
          CHECK (status IN ('PENDING','APPROVED','REJECTED','DOWNLOADED','EXPIRED','CANCELLED')),
        CONSTRAINT chk_pii_export_requests_scope_object
          CHECK (jsonb_typeof(scope_snapshot) = 'object'),
        CONSTRAINT chk_pii_export_requests_reason_code
          CHECK (length(trim(reason_code)) > 0),
        CONSTRAINT chk_pii_export_requests_reason_note
          CHECK (reason_note IS NULL OR length(trim(reason_note)) > 0),
        CONSTRAINT chk_pii_export_requests_rejected_reason
          CHECK (rejected_reason IS NULL OR length(trim(rejected_reason)) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pii_export_requests_status
        ON pii_export_requests (status, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pii_export_requests_requester
        ON pii_export_requests (requester_user_id, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pii_export_requests_active_token
        ON pii_export_requests (download_token_hash)
        WHERE download_token_hash IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pii_export_events (
        id BIGSERIAL PRIMARY KEY,
        request_id UUID NOT NULL
          CONSTRAINT fk_pii_export_events_request
          REFERENCES pii_export_requests(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        actor_user_id INTEGER
          CONSTRAINT fk_pii_export_events_actor
          REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        action VARCHAR(20) NOT NULL,
        metadata JSONB,
        ip TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_pii_export_events_action
          CHECK (action IN ('REQUEST','APPROVE','REJECT','DOWNLOAD','EXPIRE','CANCEL'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pii_export_events_request
        ON pii_export_events (request_id, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pii_export_events_actor
        ON pii_export_events (actor_user_id, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION pii_export_events_block_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'pii_export_events is append-only; % is not allowed', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_pii_export_events_immutable ON pii_export_events`,
    );
    await queryRunner.query(`
      CREATE TRIGGER trg_pii_export_events_immutable
        BEFORE UPDATE OR DELETE ON pii_export_events
        FOR EACH ROW EXECUTE FUNCTION pii_export_events_block_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_pii_export_events_immutable ON pii_export_events`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS pii_export_events_block_mutation()`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pii_export_events_actor`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pii_export_events_request`);
    await queryRunner.query(`DROP TABLE IF EXISTS pii_export_events`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_pii_export_requests_active_token`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pii_export_requests_requester`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pii_export_requests_status`);
    await queryRunner.query(`DROP TABLE IF EXISTS pii_export_requests`);
  }
}
