import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shared LINE verification links are long-lived administrator-managed records.
 * The encrypted token is retained only so an authorised school administrator
 * can re-share the same active link; public resolution always uses its hash.
 */
export class AddTeacherLineGroupInvitations20260815190000 implements MigrationInterface {
  name = 'AddTeacherLineGroupInvitations20260815190000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE teacher_line_group_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id INTEGER NOT NULL,
        token_hash CHAR(64) NOT NULL,
        token_encrypted TEXT NOT NULL,
        issued_by INTEGER NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        starts_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoked_by INTEGER,
        revocation_reason VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_teacher_line_group_invitations_token_hash UNIQUE (token_hash),
        CONSTRAINT fk_teacher_line_group_invitations_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_line_group_invitations_issued_by
          FOREIGN KEY (issued_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_line_group_invitations_revoked_by
          FOREIGN KEY (revoked_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_teacher_line_group_invitations_token_hash
          CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT chk_teacher_line_group_invitations_expiry
          CHECK (expires_at > starts_at),
        CONSTRAINT chk_teacher_line_group_invitations_revocation
          CHECK (
            (revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
            OR (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
          )
      );

      CREATE UNIQUE INDEX uq_teacher_line_group_invitations_open_school
        ON teacher_line_group_invitations (school_id)
        WHERE revoked_at IS NULL;

      CREATE INDEX idx_teacher_line_group_invitations_expiry
        ON teacher_line_group_invitations (expires_at)
        WHERE revoked_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE teacher_line_group_invitations`);
  }
}
