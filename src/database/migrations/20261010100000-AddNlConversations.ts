import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-user nl-query chat history. One row per conversation, one row per turn
 * holding the full QueryEnvelope (decision: rows are stored; no retention job).
 */
export class AddNlConversations20261010100000 implements MigrationInterface {
  name = 'AddNlConversations20261010100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS nl_conversation (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(120) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_nl_conversation_user_updated
        ON nl_conversation (user_id, updated_at DESC) WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS nl_conversation_turn (
        id BIGSERIAL PRIMARY KEY,
        conversation_id UUID NOT NULL REFERENCES nl_conversation(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        question TEXT NOT NULL,
        answer_type VARCHAR(16) NOT NULL,
        envelope JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_nl_conversation_turn_seq UNIQUE (conversation_id, seq),
        CONSTRAINT chk_nl_conversation_turn_answer_type
          CHECK (answer_type IN ('result', 'clarification', 'refusal'))
      )
    `);
    await queryRunner.query(`
      ALTER TABLE nl_query_log
        ADD COLUMN IF NOT EXISTS conversation_id UUID NULL
          REFERENCES nl_conversation(id) ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE nl_query_log DROP COLUMN IF EXISTS conversation_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS nl_conversation_turn`);
    await queryRunner.query(`DROP TABLE IF EXISTS nl_conversation;`);
  }
}
