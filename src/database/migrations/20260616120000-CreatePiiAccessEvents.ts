import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 of PII masking — create the immutable `pii_access_events` log that
 * records every sensitive-PII reveal (who, which student ref, which field group,
 * why, when). Additive and reversible.
 *
 * Deliberately does NOT use the shared audit columns: this is an append-only
 * event log (no updated_at/updated_by/deleted_at). A BEFORE UPDATE/DELETE trigger
 * raises, so the trail cannot be rewritten. The subject is a keyed-HMAC reference
 * (common/utils/pii-ref.util.ts), never the raw national id.
 */
export class CreatePiiAccessEvents20260616120000 implements MigrationInterface {
  name = 'CreatePiiAccessEvents20260616120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pii_access_events (
        id BIGSERIAL PRIMARY KEY,
        actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        actor_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('STAFF', 'GUEST')),
        subject_student_ref TEXT NOT NULL,
        subject_ref_key_version SMALLINT NOT NULL DEFAULT 1,
        field_group TEXT NOT NULL CHECK (field_group IN ('NATIONAL_ID', 'PASSPORT', 'ADDRESS')),
        reason_code TEXT NOT NULL,
        reason_note TEXT,
        purpose_link_id TEXT,
        request_id TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pii_access_events_subject
        ON pii_access_events (subject_student_ref, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pii_access_events_actor
        ON pii_access_events (actor_user_id, created_at)
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION pii_access_events_block_mutation()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'pii_access_events is append-only; % is not allowed', TG_OP;
        END;
        $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_pii_access_events_immutable ON pii_access_events`,
    );
    await queryRunner.query(`
      CREATE TRIGGER trg_pii_access_events_immutable
        BEFORE UPDATE OR DELETE ON pii_access_events
        FOR EACH ROW EXECUTE FUNCTION pii_access_events_block_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_pii_access_events_immutable ON pii_access_events`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS pii_access_events_block_mutation()`);
    await queryRunner.query(`DROP TABLE IF EXISTS pii_access_events`);
  }
}
