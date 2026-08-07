import type { MigrationInterface, QueryRunner } from 'typeorm';

const CLEANUP_REASON = 'TEACHER_DEACTIVATED_LEGACY_CLEANUP';

/**
 * Releases LINE identities left active by the old teacher-deactivation flow.
 * The account rows remain as history; only their active binding is closed.
 */
export class UnlinkInactiveTeacherMessagingAccounts20260807170000 implements MigrationInterface {
  name = 'UnlinkInactiveTeacherMessagingAccounts20260807170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE teacher_messaging_accounts account
        SET unlinked_at = now(),
            unlinked_reason = $1
        FROM teachers teacher
        WHERE teacher.id = account.teacher_id
          AND account.provider = 'LINE'
          AND account.unlinked_at IS NULL
          AND account.deleted_at IS NULL
          AND (teacher.teacher_status <> 'ACTIVE' OR teacher.deleted_at IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1
            FROM school_teacher_memberships active_membership
            WHERE active_membership.teacher_id = account.teacher_id
              AND active_membership.membership_status = 'ACTIVE'
              AND active_membership.deleted_at IS NULL
          )
      `,
      [CLEANUP_REASON],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE teacher_messaging_accounts account
        SET unlinked_at = NULL,
            unlinked_reason = NULL
        WHERE account.unlinked_reason = $1
          AND account.unlinked_at IS NOT NULL
          AND account.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM teacher_messaging_accounts conflict
            WHERE conflict.id <> account.id
              AND conflict.provider = account.provider
              AND conflict.provider_channel_id = account.provider_channel_id
              AND conflict.provider_user_id = account.provider_user_id
              AND conflict.unlinked_at IS NULL
              AND conflict.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1
            FROM teacher_messaging_accounts conflict
            WHERE conflict.id <> account.id
              AND conflict.teacher_id = account.teacher_id
              AND conflict.provider = account.provider
              AND conflict.provider_channel_id = account.provider_channel_id
              AND conflict.unlinked_at IS NULL
              AND conflict.deleted_at IS NULL
          )
      `,
      [CLEANUP_REASON],
    );
  }
}
