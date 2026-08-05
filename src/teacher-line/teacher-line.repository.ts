import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { MessagingFriendState } from '../common/messaging/messaging.types';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type { TeacherLineIdentityRow, TeacherMessagingAccountRow } from './teacher-line.types';

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
