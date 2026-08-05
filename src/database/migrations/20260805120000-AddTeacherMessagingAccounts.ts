import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * Where a teacher's verified chat account lives, so the school can push that
 * teacher's attendance link to them directly (design: task-teacher-line-linking.md).
 *
 * Provider-neutral on purpose. LINE is the only value the CHECK accepts today,
 * but a national system should not put one vendor's name in a column, and the
 * columns here describe the general shape of "an account on a chat platform"
 * rather than anything LINE-specific.
 *
 * NOT a column on `teachers`:
 * - a binding is verified, can be replaced, and can be revoked, so it carries its
 *   own timestamps and history; flattening that onto the person would lose it
 * - `teachers.line_id` already exists and is a different thing entirely — the
 *   hand-typed LINE ID people exchange, which cannot be used to send anything
 *
 * Deliberately NOT stored: the user's LINE access/refresh tokens. Once the
 * binding is verified they are never needed again — friendship is re-read with
 * the school's own channel token — so no user credential sits in the database.
 */
export class AddTeacherMessagingAccounts20260805120000 implements MigrationInterface {
  name = 'AddTeacherMessagingAccounts20260805120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE teacher_messaging_accounts (
        id BIGSERIAL PRIMARY KEY,
        teacher_id BIGINT NOT NULL,
        provider VARCHAR(16) NOT NULL,
        provider_channel_id VARCHAR(64) NOT NULL,
        provider_user_id VARCHAR(64) NOT NULL,
        display_name VARCHAR(255),
        friend_state VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
        friend_checked_at TIMESTAMPTZ,
        verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        verified_via VARCHAR(16) NOT NULL DEFAULT 'EMAIL_OTP',
        unlinked_at TIMESTAMPTZ,
        unlinked_reason VARCHAR(255),
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT fk_teacher_messaging_accounts_teacher
          FOREIGN KEY (teacher_id) REFERENCES teachers(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT chk_teacher_messaging_accounts_provider
          CHECK (provider IN ('LINE')),
        CONSTRAINT chk_teacher_messaging_accounts_friend_state
          CHECK (friend_state IN ('FRIEND', 'NOT_FRIEND', 'BLOCKED', 'UNKNOWN')),
        CONSTRAINT chk_teacher_messaging_accounts_verified_via
          CHECK (verified_via IN ('EMAIL_OTP')),
        CONSTRAINT chk_teacher_messaging_accounts_provider_user_id
          CHECK (length(btrim(provider_user_id)) > 0),
        CONSTRAINT chk_teacher_messaging_accounts_provider_channel_id
          CHECK (length(btrim(provider_channel_id)) > 0),
        CONSTRAINT chk_teacher_messaging_accounts_unlink
          CHECK (unlinked_at IS NOT NULL OR unlinked_reason IS NULL)
      );
      ${auditUpdatedAtTriggerSql('teacher_messaging_accounts')}

      -- One chat account belongs to one teacher: without this, someone who got
      -- hold of a second teacher's email could point the same LINE account at
      -- both and receive both teachers' links.
      CREATE UNIQUE INDEX uq_teacher_messaging_accounts_provider_user
        ON teacher_messaging_accounts (provider, provider_channel_id, provider_user_id)
        WHERE unlinked_at IS NULL AND deleted_at IS NULL;

      -- And one teacher has one active account per channel, so "send this
      -- teacher their link" never has to choose between two destinations.
      CREATE UNIQUE INDEX uq_teacher_messaging_accounts_teacher
        ON teacher_messaging_accounts (teacher_id, provider, provider_channel_id)
        WHERE unlinked_at IS NULL AND deleted_at IS NULL;

      CREATE INDEX idx_teacher_messaging_accounts_teacher
        ON teacher_messaging_accounts (teacher_id)
        WHERE deleted_at IS NULL;

      -- The teacher table filters on "verified / not verified", which reads the
      -- active rows by state.
      CREATE INDEX idx_teacher_messaging_accounts_friend_state
        ON teacher_messaging_accounts (friend_state)
        WHERE unlinked_at IS NULL AND deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_teacher_messaging_accounts_set_updated_at
        ON teacher_messaging_accounts;
      DROP TABLE IF EXISTS teacher_messaging_accounts;
    `);
  }
}
