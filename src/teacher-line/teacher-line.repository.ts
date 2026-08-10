import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { MessagingFriendState } from '../common/messaging/messaging.types';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type {
  TeacherLineIdentityRow,
  TeacherLineInvitationRow,
  TeacherMessagingAccountRow,
} from './teacher-line.types';

interface QueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

@Injectable()
export class TeacherLineRepository {
  constructor(private readonly dataSource: DataSource) {}

  async withTransaction<T>(operation: (queryRunner: QueryRunner) => Promise<T>): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await operation(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private executor(queryRunner?: QueryRunner): QueryExecutor {
    return queryRunner
      ? createSqlQueryExecutor(queryRunner)
      : {
          query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
            await queryDataSource<T>(this.dataSource, sql, params),
        };
  }

  /**
   * The teacher an address belongs to. Matched the same way `uq_teachers_email`
   * indexes it, so the lookup uses that index and cannot disagree with the
   * constraint that guarantees at most one row comes back.
   */
  async findActiveTeacherByEmail(email: string): Promise<TeacherLineIdentityRow | null> {
    const result = await this.executor().query<TeacherLineIdentityRow>(
      `
        SELECT
          teacher.id::text AS teacher_id,
          teacher.first_name,
          teacher.last_name,
          teacher.email
        FROM teachers teacher
        WHERE lower(btrim(teacher.email)) = lower(btrim($1))
          AND teacher.deleted_at IS NULL
          AND teacher.teacher_status = 'ACTIVE'
        LIMIT 1
      `,
      [email],
    );
    return result.rows[0] ?? null;
  }

  /** The account currently bound for this teacher on this channel, if any. */
  async findActiveAccountForTeacher(
    teacherId: string,
    providerChannelId: string,
    queryRunner?: QueryRunner,
  ): Promise<TeacherMessagingAccountRow | null> {
    const result = await this.executor(queryRunner).query<TeacherMessagingAccountRow>(
      `
        SELECT
          id::text AS id,
          teacher_id::text AS teacher_id,
          provider,
          provider_channel_id,
          provider_user_id,
          display_name,
          friend_state,
          friend_checked_at,
          verified_at
        FROM teacher_messaging_accounts
        WHERE teacher_id = $1::bigint
          AND provider = 'LINE'
          AND provider_channel_id = $2
          AND unlinked_at IS NULL
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [teacherId, providerChannelId],
    );
    return result.rows[0] ?? null;
  }

  async hasActiveAccountForTeacher(
    teacherId: string,
    providerChannelId: string,
    queryRunner?: QueryRunner,
  ): Promise<boolean> {
    const result = await this.executor(queryRunner).query(
      `
        SELECT 1
        FROM teacher_messaging_accounts
        WHERE teacher_id = $1::bigint
          AND provider = 'LINE'
          AND provider_channel_id = $2
          AND unlinked_at IS NULL
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [teacherId, providerChannelId],
    );
    return result.rows.length > 0;
  }

  async createInvitation(
    input: {
      teacherMembershipId: number;
      tokenHash: string;
      issuedBy: number;
      expiresAt: Date;
    },
    queryRunner: QueryRunner,
  ): Promise<{ id: string; expires_at: Date | string }> {
    const executor = this.executor(queryRunner);
    await executor.query(
      `
        UPDATE teacher_line_invitations
        SET revoked_at = now(),
            revoked_by = $2,
            revocation_reason = 'ROTATED_BY_NEW_INVITATION',
            updated_at = now()
        WHERE teacher_membership_id = $1
          AND consumed_at IS NULL
          AND revoked_at IS NULL
      `,
      [input.teacherMembershipId, input.issuedBy],
    );
    const result = await executor.query<{ id: string; expires_at: Date | string }>(
      `
        INSERT INTO teacher_line_invitations (
          teacher_membership_id, token_hash, issued_by, expires_at
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id::text, expires_at
      `,
      [input.teacherMembershipId, input.tokenHash, input.issuedBy, input.expiresAt],
    );
    return result.rows[0];
  }

  async findInvitationByTokenHash(
    tokenHash: string,
    queryRunner?: QueryRunner,
    lock = false,
  ): Promise<TeacherLineInvitationRow | null> {
    const result = await this.executor(queryRunner).query<TeacherLineInvitationRow>(
      `
        SELECT
          invitation.id::text,
          invitation.teacher_membership_id::text,
          membership.teacher_id::text,
          membership.school_id,
          teacher.first_name,
          teacher.last_name,
          teacher.email,
          invitation.token_hash,
          invitation.issued_by,
          invitation.issued_at,
          invitation.expires_at,
          invitation.consumed_at,
          invitation.revoked_at,
          invitation.revoked_by,
          invitation.revocation_reason,
          teacher.teacher_status,
          membership.membership_status,
          membership.deleted_at AS membership_deleted_at
        FROM teacher_line_invitations invitation
        JOIN school_teacher_memberships membership
          ON membership.id = invitation.teacher_membership_id
        JOIN teachers teacher ON teacher.id = membership.teacher_id
        WHERE invitation.token_hash = $1
        ${lock ? 'FOR UPDATE OF invitation' : ''}
      `,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async findInvitationById(
    invitationId: string,
    queryRunner: QueryRunner,
    lock = false,
  ): Promise<TeacherLineInvitationRow | null> {
    const result = await this.executor(queryRunner).query<TeacherLineInvitationRow>(
      `
        SELECT
          invitation.id::text,
          invitation.teacher_membership_id::text,
          membership.teacher_id::text,
          membership.school_id,
          teacher.first_name,
          teacher.last_name,
          teacher.email,
          invitation.token_hash,
          invitation.issued_by,
          invitation.issued_at,
          invitation.expires_at,
          invitation.consumed_at,
          invitation.revoked_at,
          invitation.revoked_by,
          invitation.revocation_reason,
          teacher.teacher_status,
          membership.membership_status,
          membership.deleted_at AS membership_deleted_at
        FROM teacher_line_invitations invitation
        JOIN school_teacher_memberships membership
          ON membership.id = invitation.teacher_membership_id
        JOIN teachers teacher ON teacher.id = membership.teacher_id
        WHERE invitation.id = $1::uuid
        ${lock ? 'FOR UPDATE OF invitation' : ''}
      `,
      [invitationId],
    );
    return result.rows[0] ?? null;
  }

  async revokeActiveInvitation(
    teacherMembershipId: number,
    revokedBy: number,
    reason: string,
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    const result = await this.executor(queryRunner).query(
      `
        UPDATE teacher_line_invitations
        SET revoked_at = now(), revoked_by = $2, revocation_reason = $3, updated_at = now()
        WHERE teacher_membership_id = $1
          AND consumed_at IS NULL
          AND revoked_at IS NULL
      `,
      [teacherMembershipId, revokedBy, reason],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async consumeInvitation(invitationId: string, queryRunner: QueryRunner): Promise<boolean> {
    const result = await this.executor(queryRunner).query(
      `
        UPDATE teacher_line_invitations
        SET consumed_at = now(), updated_at = now()
        WHERE id = $1::uuid
          AND consumed_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()
      `,
      [invitationId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Which teacher — if anyone — this chat account is already bound to. */
  async findActiveAccountByProviderUser(
    providerChannelId: string,
    providerUserId: string,
    queryRunner?: QueryRunner,
  ): Promise<TeacherMessagingAccountRow | null> {
    const result = await this.executor(queryRunner).query<TeacherMessagingAccountRow>(
      `
        SELECT
          id::text AS id,
          teacher_id::text AS teacher_id,
          provider,
          provider_channel_id,
          provider_user_id,
          display_name,
          friend_state,
          friend_checked_at,
          verified_at
        FROM teacher_messaging_accounts
        WHERE provider = 'LINE'
          AND provider_channel_id = $1
          AND provider_user_id = $2
          AND unlinked_at IS NULL
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [providerChannelId, providerUserId],
    );
    return result.rows[0] ?? null;
  }

  async unlinkAccount(accountId: string, reason: string, queryRunner: QueryRunner): Promise<void> {
    await this.executor(queryRunner).query(
      `
        UPDATE teacher_messaging_accounts
        SET unlinked_at = now(), unlinked_reason = $2
        WHERE id = $1::bigint AND unlinked_at IS NULL
      `,
      [accountId, reason],
    );
  }

  async unlinkActiveAccountForTeacher(
    teacherId: string,
    reason: string,
    updatedBy: number,
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    const result = await this.executor(queryRunner).query(
      `
        UPDATE teacher_messaging_accounts
        SET unlinked_at = now(), unlinked_reason = $2, updated_by = $3
        WHERE teacher_id = $1::bigint
          AND provider = 'LINE'
          AND unlinked_at IS NULL
          AND deleted_at IS NULL
      `,
      [teacherId, reason, updatedBy],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async hasActiveTeacherMembership(teacherId: string, queryRunner: QueryRunner): Promise<boolean> {
    const result = await this.executor(queryRunner).query(
      `
        SELECT 1
        FROM teachers teacher
        JOIN school_teacher_memberships membership
          ON membership.teacher_id = teacher.id
        WHERE teacher.id = $1::bigint
          AND teacher.teacher_status = 'ACTIVE'
          AND teacher.deleted_at IS NULL
          AND membership.membership_status = 'ACTIVE'
          AND membership.deleted_at IS NULL
        LIMIT 1
      `,
      [teacherId],
    );
    return result.rows.length > 0;
  }

  async insertAccount(
    input: {
      teacherId: string;
      providerChannelId: string;
      providerUserId: string;
      displayName: string | null;
      friendState: MessagingFriendState;
    },
    queryRunner: QueryRunner,
  ): Promise<string> {
    const result = await this.executor(queryRunner).query<{ id: string }>(
      `
        INSERT INTO teacher_messaging_accounts (
          teacher_id, provider, provider_channel_id, provider_user_id,
          display_name, friend_state, friend_checked_at, verified_at, verified_via
        )
        VALUES ($1::bigint, 'LINE', $2, $3, $4, $5, now(), now(), 'EMAIL_OTP')
        RETURNING id::text AS id
      `,
      [
        input.teacherId,
        input.providerChannelId,
        input.providerUserId,
        input.displayName,
        input.friendState,
      ],
    );
    return result.rows[0].id;
  }

  /**
   * Applies a friendship change that arrived by webhook. Keyed by the provider's
   * own id because that is all an inbound event carries.
   */
  async updateFriendStateByProviderUser(
    providerChannelId: string,
    providerUserId: string,
    friendState: MessagingFriendState,
  ): Promise<number> {
    const result = await this.executor().query(
      `
        UPDATE teacher_messaging_accounts
        SET friend_state = $3, friend_checked_at = now()
        WHERE provider = 'LINE'
          AND provider_channel_id = $1
          AND provider_user_id = $2
          AND unlinked_at IS NULL
          AND deleted_at IS NULL
      `,
      [providerChannelId, providerUserId, friendState],
    );
    return result.rowCount ?? 0;
  }

  async updateFriendState(
    accountId: string,
    friendState: MessagingFriendState,
    displayName: string | null,
    queryRunner?: QueryRunner,
  ): Promise<void> {
    await this.executor(queryRunner).query(
      `
        UPDATE teacher_messaging_accounts
        SET friend_state = $2,
            friend_checked_at = now(),
            display_name = COALESCE($3, display_name)
        WHERE id = $1::bigint
      `,
      [accountId, friendState, displayName],
    );
  }
}
