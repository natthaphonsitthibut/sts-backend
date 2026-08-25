import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { MessagingFriendState } from '../common/messaging/messaging.types';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type {
  TeacherLineCitizenIdentityRow,
  TeacherLineGroupInvitationRow,
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

  async createGroupInvitation(input: {
    schoolId: number;
    schoolName: string;
    tokenHash: string;
    tokenEncrypted: string;
    issuedBy: number;
    startsAt: Date;
    expiresAt: Date;
  }): Promise<TeacherLineGroupInvitationRow | null> {
    try {
      return await this.withTransaction(async (queryRunner) => {
        const executor = this.executor(queryRunner);
        const existing = await this.findOpenGroupInvitationForSchool(
          input.schoolId,
          queryRunner,
          true,
        );
        if (existing) {
          if (new Date(existing.expires_at).getTime() > Date.now()) return null;
          await executor.query(
            `
              UPDATE teacher_line_group_invitations
              SET revoked_at = now(),
                  revoked_by = $2,
                  revocation_reason = 'EXPIRED_REPLACED',
                  updated_at = now()
              WHERE id = $1::uuid
                AND revoked_at IS NULL
            `,
            [existing.id, input.issuedBy],
          );
        }
        const inserted = await executor.query<TeacherLineGroupInvitationRow>(
          `
            INSERT INTO teacher_line_group_invitations (
              school_id, token_hash, token_encrypted, issued_by, starts_at, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING
              id::text,
              school_id,
              $7::text AS school_name,
              token_hash,
              token_encrypted,
              issued_by,
              issued_at,
              starts_at,
              expires_at,
              revoked_at,
              revoked_by,
              revocation_reason
          `,
          [
            input.schoolId,
            input.tokenHash,
            input.tokenEncrypted,
            input.issuedBy,
            input.startsAt,
            input.expiresAt,
            input.schoolName,
          ],
        );
        return inserted.rows[0] ?? null;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return null;
      throw error;
    }
  }

  async findActiveGroupInvitationForSchool(
    schoolId: number,
  ): Promise<TeacherLineGroupInvitationRow | null> {
    const invitation = await this.findOpenGroupInvitationForSchool(schoolId);
    return invitation && new Date(invitation.expires_at).getTime() > Date.now() ? invitation : null;
  }

  async findActiveGroupInvitationByTokenHash(
    tokenHash: string,
  ): Promise<TeacherLineGroupInvitationRow | null> {
    const result = await this.executor().query<TeacherLineGroupInvitationRow>(
      `
        SELECT
          invitation.id::text,
          invitation.school_id,
          school.name AS school_name,
          invitation.token_hash,
          invitation.token_encrypted,
          invitation.issued_by,
          invitation.issued_at,
          invitation.starts_at,
          invitation.expires_at,
          invitation.revoked_at,
          invitation.revoked_by,
          invitation.revocation_reason
        FROM teacher_line_group_invitations invitation
        JOIN schools school ON school.id = invitation.school_id
        WHERE invitation.token_hash = $1
          AND invitation.revoked_at IS NULL
          AND invitation.expires_at > now()
          AND school.school_status = 'ACTIVE'
        LIMIT 1
      `,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async updateActiveGroupInvitation(
    id: string,
    schoolId: number,
    startsAt: Date,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.executor().query(
      `
        UPDATE teacher_line_group_invitations
        SET starts_at = $3,
            expires_at = $4,
            updated_at = now()
        WHERE id = $1::uuid
          AND school_id = $2
          AND revoked_at IS NULL
          AND expires_at > now()
      `,
      [id, schoolId, startsAt, expiresAt],
    );
    return result.rowCount === 1;
  }

  async revokeActiveGroupInvitation(
    id: string,
    schoolId: number,
    revokedBy: number,
  ): Promise<boolean> {
    const result = await this.executor().query(
      `
        UPDATE teacher_line_group_invitations
        SET revoked_at = now(),
            revoked_by = $3,
            revocation_reason = 'REVOKED_BY_ADMIN',
            updated_at = now()
        WHERE id = $1::uuid
          AND school_id = $2
          AND revoked_at IS NULL
          AND expires_at > now()
      `,
      [id, schoolId, revokedBy],
    );
    return result.rowCount === 1;
  }

  private async findOpenGroupInvitationForSchool(
    schoolId: number,
    queryRunner?: QueryRunner,
    lock = false,
  ): Promise<TeacherLineGroupInvitationRow | null> {
    const result = await this.executor(queryRunner).query<TeacherLineGroupInvitationRow>(
      `
        SELECT
          invitation.id::text,
          invitation.school_id,
          school.name AS school_name,
          invitation.token_hash,
          invitation.token_encrypted,
          invitation.issued_by,
          invitation.issued_at,
          invitation.starts_at,
          invitation.expires_at,
          invitation.revoked_at,
          invitation.revoked_by,
          invitation.revocation_reason
        FROM teacher_line_group_invitations invitation
        JOIN schools school ON school.id = invitation.school_id
        WHERE invitation.school_id = $1
          AND invitation.revoked_at IS NULL
          AND school.school_status = 'ACTIVE'
        LIMIT 1
        ${lock ? 'FOR UPDATE OF invitation' : ''}
      `,
      [schoolId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * The teacher an address belongs to. Matched the same way `uq_teachers_email`
   * indexes it, so the lookup uses that index and cannot disagree with the
   * constraint that guarantees at most one row comes back.
   */
  async findActiveTeacherByEmail(
    email: string,
    schoolId: number,
  ): Promise<TeacherLineIdentityRow | null> {
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
          AND EXISTS (
            SELECT 1
            FROM school_teacher_memberships membership
            JOIN classroom_homeroom_teachers homeroom
              ON homeroom.teacher_membership_id = membership.id
             AND homeroom.school_id = membership.school_id
            JOIN school_classrooms classroom
              ON classroom.id = homeroom.classroom_id
             AND classroom.school_id = homeroom.school_id
             AND classroom.classroom_status = 'ACTIVE'
             AND classroom.deleted_at IS NULL
            JOIN school_terms term
              ON term.id = classroom.school_term_id
             AND term.school_id = classroom.school_id
             AND term.status = 'ACTIVE'
             AND term.deleted_at IS NULL
            WHERE membership.teacher_id = teacher.id
              AND membership.school_id = $2
              AND membership.membership_status = 'ACTIVE'
              AND membership.deleted_at IS NULL
          )
        LIMIT 1
      `,
      [email, schoolId],
    );
    return result.rows[0] ?? null;
  }

  async findActiveTeacherByCitizenId(
    citizenId: string,
    schoolId: number,
  ): Promise<TeacherLineCitizenIdentityRow | null> {
    const result = await this.executor().query<TeacherLineCitizenIdentityRow>(
      `
        SELECT
          teacher.id::text AS teacher_id,
          teacher.first_name,
          teacher.last_name
        FROM teachers teacher
        WHERE teacher.citizen_id = $1
          AND teacher.deleted_at IS NULL
          AND teacher.teacher_status = 'ACTIVE'
          AND EXISTS (
            SELECT 1
            FROM school_teacher_memberships membership
            JOIN classroom_homeroom_teachers homeroom
              ON homeroom.teacher_membership_id = membership.id
             AND homeroom.school_id = membership.school_id
            JOIN school_classrooms classroom
              ON classroom.id = homeroom.classroom_id
             AND classroom.school_id = homeroom.school_id
             AND classroom.classroom_status = 'ACTIVE'
             AND classroom.deleted_at IS NULL
            JOIN school_terms term
              ON term.id = classroom.school_term_id
             AND term.school_id = classroom.school_id
             AND term.status = 'ACTIVE'
             AND term.deleted_at IS NULL
            WHERE membership.teacher_id = teacher.id
              AND membership.school_id = $2
              AND membership.membership_status = 'ACTIVE'
              AND membership.deleted_at IS NULL
          )
        LIMIT 1
      `,
      [citizenId, schoolId],
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

  async hasActiveTeacherMembership(
    teacherId: string,
    queryRunner: QueryRunner,
    schoolId?: number,
  ): Promise<boolean> {
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
          AND ($2::bigint IS NULL OR membership.school_id = $2::bigint)
        LIMIT 1
      `,
      [teacherId, schoolId ?? null],
    );
    return result.rows.length > 0;
  }

  async hasActiveHomeroomTeacherMembership(
    teacherId: string,
    schoolId: number,
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    const result = await this.executor(queryRunner).query(
      `
        SELECT 1
        FROM teachers teacher
        JOIN school_teacher_memberships membership
          ON membership.teacher_id = teacher.id
         AND membership.school_id = $2::bigint
        JOIN classroom_homeroom_teachers homeroom
          ON homeroom.teacher_membership_id = membership.id
         AND homeroom.school_id = membership.school_id
        JOIN school_classrooms classroom
          ON classroom.id = homeroom.classroom_id
         AND classroom.school_id = homeroom.school_id
         AND classroom.classroom_status = 'ACTIVE'
         AND classroom.deleted_at IS NULL
        JOIN school_terms term
          ON term.id = classroom.school_term_id
         AND term.school_id = classroom.school_id
         AND term.status = 'ACTIVE'
         AND term.deleted_at IS NULL
        WHERE teacher.id = $1::bigint
          AND teacher.teacher_status = 'ACTIVE'
          AND teacher.deleted_at IS NULL
          AND membership.membership_status = 'ACTIVE'
          AND membership.deleted_at IS NULL
        LIMIT 1
      `,
      [teacherId, schoolId],
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
      verifiedVia: 'GOOGLE' | 'ARAID';
    },
    queryRunner: QueryRunner,
  ): Promise<string> {
    const result = await this.executor(queryRunner).query<{ id: string }>(
      `
        INSERT INTO teacher_messaging_accounts (
          teacher_id, provider, provider_channel_id, provider_user_id,
          display_name, friend_state, friend_checked_at, verified_at, verified_via
        )
        VALUES ($1::bigint, 'LINE', $2, $3, $4, $5, now(), now(), $6)
        RETURNING id::text AS id
      `,
      [
        input.teacherId,
        input.providerChannelId,
        input.providerUserId,
        input.displayName,
        input.friendState,
        input.verifiedVia,
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
