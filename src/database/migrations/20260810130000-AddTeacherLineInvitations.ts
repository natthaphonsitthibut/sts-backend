import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time credentials for a school administrator to invite a specific teacher
 * to bind LINE. Raw tokens are returned once and never persisted.
 */
export class AddTeacherLineInvitations20260810130000 implements MigrationInterface {
  name = 'AddTeacherLineInvitations20260810130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE teacher_line_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        teacher_membership_id BIGINT NOT NULL,
        token_hash CHAR(64) NOT NULL,
        issued_by INTEGER NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        revoked_by INTEGER,
        revocation_reason VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_teacher_line_invitations_token_hash UNIQUE (token_hash),
        CONSTRAINT fk_teacher_line_invitations_membership
          FOREIGN KEY (teacher_membership_id) REFERENCES school_teacher_memberships(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_line_invitations_issued_by
          FOREIGN KEY (issued_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_line_invitations_revoked_by
          FOREIGN KEY (revoked_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_teacher_line_invitations_token_hash
          CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT chk_teacher_line_invitations_expiry
          CHECK (expires_at > issued_at),
        CONSTRAINT chk_teacher_line_invitations_consumed
          CHECK (consumed_at IS NULL OR consumed_at >= issued_at),
        CONSTRAINT chk_teacher_line_invitations_revocation
          CHECK (
            (revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
            OR (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
          ),
        CONSTRAINT chk_teacher_line_invitations_terminal_state
          CHECK (consumed_at IS NULL OR revoked_at IS NULL)
      );

      CREATE UNIQUE INDEX uq_teacher_line_invitations_active_membership
        ON teacher_line_invitations (teacher_membership_id)
        WHERE consumed_at IS NULL AND revoked_at IS NULL;

      CREATE INDEX idx_teacher_line_invitations_membership_issued
        ON teacher_line_invitations (teacher_membership_id, issued_at DESC);

      CREATE INDEX idx_teacher_line_invitations_expiry
        ON teacher_line_invitations (expires_at)
        WHERE consumed_at IS NULL AND revoked_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE teacher_line_invitations`);
  }
}
