import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type {
  ClassroomLinkLineDeliveryFailureCode,
  ClassroomLinkListRow,
  ClassroomLinkRow,
  ExternalTeacherRow,
} from './classroom-attendance-links.types';

@Injectable()
export class ClassroomAttendanceLinksRepository {
  constructor(private readonly dataSource: DataSource) {}

  async withTransaction<T>(work: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const result = await work(runner);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  private linkSelect(): string {
    return `
      SELECT link.id::text, link.school_id, school.name AS school_name,
             link.school_term_id::text, term.academic_year, term.semester,
             term.status AS term_status, link.classroom_id::text,
             classroom.grade_level_id, grade.label AS grade_label,
             classroom.legacy_room_number::text, classroom.room_name,
             classroom.classroom_status, link.token_hash, link.token_encrypted,
             link.link_status, link.issued_at, link.rotated_at, link.last_used_at,
             membership.id::text AS homeroom_teacher_membership_id,
             TRIM(teacher.first_name || ' ' || teacher.last_name) AS homeroom_teacher_name,
             line_account.provider_user_id AS line_provider_user_id,
             line_account.friend_state AS line_friend_state,
             link.line_delivery_teacher_membership_id::text,
             link.line_delivery_status, link.line_delivery_failure_code,
             link.line_delivery_attempt_count, link.line_delivery_request_id::text,
             link.line_delivery_last_attempted_at, link.line_delivered_at
      FROM classroom_attendance_links link
      JOIN schools school ON school.id = link.school_id
      JOIN school_terms term
        ON term.id = link.school_term_id AND term.school_id = link.school_id
      JOIN school_classrooms classroom
        ON classroom.id = link.classroom_id
       AND classroom.school_term_id = link.school_term_id
       AND classroom.school_id = link.school_id
      JOIN grade_levels grade ON grade.id = classroom.grade_level_id
      LEFT JOIN classroom_homeroom_teachers homeroom
        ON homeroom.classroom_id = classroom.id AND homeroom.school_id = classroom.school_id
      LEFT JOIN school_teacher_memberships membership
        ON membership.id = homeroom.teacher_membership_id
       AND membership.school_id = homeroom.school_id
       AND membership.membership_status = 'ACTIVE'
       AND membership.deleted_at IS NULL
      LEFT JOIN teachers teacher
        ON teacher.id = membership.teacher_id
       AND teacher.teacher_status = 'ACTIVE'
       AND teacher.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT account.provider_user_id, account.friend_state
        FROM teacher_messaging_accounts account
        WHERE account.teacher_id = teacher.id
          AND account.provider = 'LINE'
          AND account.unlinked_at IS NULL
          AND account.deleted_at IS NULL
        ORDER BY account.verified_at DESC, account.id DESC
        LIMIT 1
      ) line_account ON TRUE
    `;
  }

  async findActiveSchoolInScope(
    schoolId: number,
    scope: DataScope,
  ): Promise<{ id: number; name: string } | null> {
    const scopeQuery = buildDataScopeQuery(
      scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
      },
      2,
    );
    const result = await queryDataSource<{ id: number; name: string }>(
      this.dataSource,
      `SELECT school.id, school.name
       FROM schools school
       WHERE school.id = $1
         AND school.school_status = 'ACTIVE'
         AND ${scopeQuery.sql || 'TRUE'}
       LIMIT 1`,
      [schoolId, ...scopeQuery.params],
    );
    return result.rows[0] ?? null;
  }

  async list(input: {
    schoolId: number;
    schoolTermId: number;
    search?: string;
    gradeLevelId?: number;
    linkStatus?: 'ACTIVE' | 'INACTIVE' | 'NOT_CREATED';
    homeroomStatus?: 'ASSIGNED' | 'UNASSIGNED';
    page: number;
    limit: number;
    scope: DataScope;
  }): Promise<{ rows: ClassroomLinkListRow[]; total: number }> {
    const params: unknown[] = [input.schoolId, input.schoolTermId];
    const conditions = [
      'classroom.school_id = $1',
      'classroom.school_term_id = $2',
      'classroom.deleted_at IS NULL',
      'term.deleted_at IS NULL',
    ];
    const scope = buildDataScopeQuery(
      input.scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'classroom.grade_level_id',
        room: 'classroom.legacy_room_number',
      },
      params.length + 1,
    );
    conditions.push(scope.sql || 'TRUE');
    params.push(...scope.params);
    if (input.gradeLevelId) {
      params.push(input.gradeLevelId);
      conditions.push(`classroom.grade_level_id = $${params.length}`);
    }
    if (input.linkStatus) {
      if (input.linkStatus === 'NOT_CREATED') {
        conditions.push('link.id IS NULL');
      } else if (input.linkStatus === 'ACTIVE') {
        conditions.push(`(
          link.link_status = 'ACTIVE'
          AND school.school_status = 'ACTIVE'
          AND term.status = 'ACTIVE'
          AND classroom.classroom_status = 'ACTIVE'
        )`);
      } else {
        conditions.push(`(
          link.id IS NOT NULL
          AND NOT (
            link.link_status = 'ACTIVE'
            AND school.school_status = 'ACTIVE'
            AND term.status = 'ACTIVE'
            AND classroom.classroom_status = 'ACTIVE'
          )
        )`);
      }
    }
    if (input.homeroomStatus) {
      conditions.push(
        input.homeroomStatus === 'ASSIGNED' ? 'membership.id IS NOT NULL' : 'membership.id IS NULL',
      );
    }
    if (input.search) {
      params.push(`%${input.search.replace(/[\\%_]/g, (value) => `\\${value}`)}%`);
      conditions.push(`(
        classroom.room_name ILIKE $${params.length} ESCAPE '\\'
        OR grade.label ILIKE $${params.length} ESCAPE '\\'
        OR EXISTS (
          SELECT 1
          FROM classroom_homeroom_teacher_assignments search_assignment
          JOIN school_teacher_memberships search_membership
            ON search_membership.id = search_assignment.teacher_membership_id
           AND search_membership.school_id = search_assignment.school_id
           AND search_membership.membership_status = 'ACTIVE'
           AND search_membership.deleted_at IS NULL
          JOIN teachers search_teacher
            ON search_teacher.id = search_membership.teacher_id
           AND search_teacher.teacher_status = 'ACTIVE'
           AND search_teacher.deleted_at IS NULL
          WHERE search_assignment.classroom_id = classroom.id
            AND TRIM(search_teacher.first_name || ' ' || search_teacher.last_name)
                ILIKE $${params.length} ESCAPE '\\'
        )
      )`);
    }
    params.push(input.limit, (input.page - 1) * input.limit);
    const listFrom = `
      FROM school_classrooms classroom
      JOIN schools school ON school.id = classroom.school_id
      JOIN school_terms term
        ON term.id = classroom.school_term_id AND term.school_id = classroom.school_id
      JOIN grade_levels grade ON grade.id = classroom.grade_level_id
      LEFT JOIN classroom_attendance_links link ON link.classroom_id = classroom.id
      LEFT JOIN classroom_homeroom_teachers homeroom
        ON homeroom.classroom_id = classroom.id AND homeroom.school_id = classroom.school_id
      LEFT JOIN school_teacher_memberships membership
        ON membership.id = homeroom.teacher_membership_id
       AND membership.school_id = homeroom.school_id
       AND membership.membership_status = 'ACTIVE'
       AND membership.deleted_at IS NULL
      LEFT JOIN teachers teacher
        ON teacher.id = membership.teacher_id
       AND teacher.teacher_status = 'ACTIVE'
       AND teacher.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'teacherId', all_teacher.id::text,
              'teacherName', TRIM(all_teacher.first_name || ' ' || all_teacher.last_name),
              'hasPhoto', all_teacher.photo_storage_key IS NOT NULL,
              'isPrimary', all_assignment.is_primary
            ) ORDER BY all_assignment.is_primary DESC,
            TRIM(all_teacher.first_name || ' ' || all_teacher.last_name)
          ), '[]'::jsonb
        ) AS homeroom_teachers
        FROM classroom_homeroom_teacher_assignments all_assignment
        JOIN school_teacher_memberships all_membership
          ON all_membership.id = all_assignment.teacher_membership_id
         AND all_membership.membership_status = 'ACTIVE'
         AND all_membership.deleted_at IS NULL
        JOIN teachers all_teacher
          ON all_teacher.id = all_membership.teacher_id
         AND all_teacher.teacher_status = 'ACTIVE'
         AND all_teacher.deleted_at IS NULL
        WHERE all_assignment.classroom_id = classroom.id
          AND all_assignment.school_id = classroom.school_id
      ) all_homeroom ON TRUE
      LEFT JOIN LATERAL (
        SELECT account.provider_user_id, account.friend_state
        FROM teacher_messaging_accounts account
        WHERE account.teacher_id = teacher.id
          AND account.provider = 'LINE'
          AND account.unlinked_at IS NULL
          AND account.deleted_at IS NULL
        ORDER BY account.verified_at DESC, account.id DESC
        LIMIT 1
      ) line_account ON TRUE`;
    const latestSessionJoin = `
      LEFT JOIN LATERAL (
        SELECT session.id::text, session.attendance_date::text,
               session.status, session.submitted_at
        FROM attendance_sessions session
        WHERE session.classroom_id = classroom.id
          AND session.school_term_id = classroom.school_term_id
          AND session.deleted_at IS NULL
        ORDER BY session.attendance_date DESC,
                 session.checking_started_at DESC NULLS LAST,
                 session.id DESC
        LIMIT 1
      ) latest_session ON TRUE`;
    const result = await queryDataSource<ClassroomLinkListRow>(
      this.dataSource,
      `SELECT link.id::text, classroom.school_id, school.name AS school_name,
              school.school_status,
              classroom.school_term_id::text, term.academic_year, term.semester,
              term.status AS term_status, classroom.id::text AS classroom_id,
              classroom.grade_level_id, grade.label AS grade_label,
              classroom.legacy_room_number::text, classroom.room_name,
              classroom.classroom_status, link.token_hash, link.token_encrypted,
              link.link_status, link.issued_at, link.rotated_at, link.last_used_at,
              membership.id::text AS homeroom_teacher_membership_id,
              teacher.id::text AS homeroom_teacher_id,
              TRIM(teacher.first_name || ' ' || teacher.last_name) AS homeroom_teacher_name,
              (teacher.photo_storage_key IS NOT NULL) AS homeroom_teacher_has_photo,
              all_homeroom.homeroom_teachers,
              line_account.provider_user_id AS line_provider_user_id,
              line_account.friend_state AS line_friend_state,
              link.line_delivery_teacher_membership_id::text,
              COALESCE(link.line_delivery_status, 'NOT_READY') AS line_delivery_status,
              link.line_delivery_failure_code,
              COALESCE(link.line_delivery_attempt_count, 0) AS line_delivery_attempt_count,
              link.line_delivery_request_id::text,
              link.line_delivery_last_attempted_at, link.line_delivered_at,
              latest_session.id AS latest_session_id,
              latest_session.attendance_date AS latest_session_date,
              latest_session.status AS latest_session_status,
              latest_session.submitted_at AS latest_session_submitted_at
       ${listFrom} ${latestSessionJoin}
       WHERE ${conditions.join(' AND ')}
       ORDER BY classroom.grade_level_id, classroom.legacy_room_number, classroom.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const count = await queryDataSource<{ count: number | string }>(
      this.dataSource,
      `SELECT count(*) AS count
       ${listFrom}
       WHERE ${conditions.join(' AND ')}`,
      params.slice(0, -2),
    );
    return { rows: result.rows, total: Number(count.rows[0]?.count ?? 0) };
  }

  async lockEligibleClassrooms(
    input: {
      schoolId: number;
      schoolTermId: number;
      classroomIds?: number[];
      scope: DataScope;
    },
    runner: QueryRunner,
  ): Promise<Array<{ classroom_id: string }>> {
    const params: unknown[] = [input.schoolId, input.schoolTermId];
    const conditions = [
      'classroom.school_id = $1',
      'classroom.school_term_id = $2',
      "school.school_status = 'ACTIVE'",
      "term.status = 'ACTIVE'",
      "classroom.classroom_status = 'ACTIVE'",
      'term.deleted_at IS NULL',
      'classroom.deleted_at IS NULL',
    ];
    if (input.classroomIds) {
      params.push(input.classroomIds);
      conditions.push(`classroom.id = ANY($${params.length}::bigint[])`);
    }
    const scope = buildDataScopeQuery(
      input.scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'classroom.grade_level_id',
        room: 'classroom.legacy_room_number',
      },
      params.length + 1,
    );
    conditions.push(scope.sql || 'TRUE');
    params.push(...scope.params);
    const result = await createSqlQueryExecutor(runner).query<{ classroom_id: string }>(
      `SELECT classroom.id::text AS classroom_id
       FROM school_classrooms classroom
       JOIN schools school ON school.id = classroom.school_id
       JOIN school_terms term
         ON term.id = classroom.school_term_id AND term.school_id = classroom.school_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY classroom.id
       LIMIT 501
       FOR UPDATE OF classroom`,
      params,
    );
    return result.rows;
  }

  async upsertLinks(
    inputs: Array<{
      schoolId: number;
      schoolTermId: number;
      classroomId: number;
      tokenHash: string;
      tokenEncrypted: string;
      actorId: number;
    }>,
    runner: QueryRunner,
  ): Promise<ClassroomLinkRow[]> {
    if (inputs.length === 0) return [];
    await createSqlQueryExecutor(runner).query(
      `INSERT INTO classroom_attendance_links (
         school_id, school_term_id, classroom_id, token_hash, token_encrypted,
         link_status, issued_at, rotated_at, created_by, updated_by
       )
       SELECT input.school_id, input.school_term_id, input.classroom_id,
              input.token_hash, input.token_encrypted,
              'ACTIVE', now(), NULL, input.actor_id, input.actor_id
       FROM jsonb_to_recordset($1::jsonb) AS input(
         school_id integer,
         school_term_id bigint,
         classroom_id bigint,
         token_hash text,
         token_encrypted text,
         actor_id bigint
       )
       ON CONFLICT (classroom_id) DO UPDATE
       SET token_hash = EXCLUDED.token_hash,
           token_encrypted = EXCLUDED.token_encrypted,
           link_status = 'ACTIVE',
           issued_at = now(), rotated_at = now(), last_used_at = NULL,
           line_delivery_teacher_membership_id = NULL,
           line_delivery_status = 'NOT_READY',
           line_delivery_failure_code = NULL,
           line_delivery_attempt_count = 0,
           line_delivery_request_id = NULL,
           line_delivery_last_attempted_at = NULL,
           line_delivered_at = NULL,
           updated_by = EXCLUDED.updated_by
       WHERE classroom_attendance_links.link_status = 'INACTIVE'`,
      [
        JSON.stringify(
          inputs.map((input) => ({
            school_id: input.schoolId,
            school_term_id: input.schoolTermId,
            classroom_id: input.classroomId,
            token_hash: input.tokenHash,
            token_encrypted: input.tokenEncrypted,
            actor_id: input.actorId,
          })),
        ),
      ],
    );
    const rows = await createSqlQueryExecutor(runner).query<ClassroomLinkRow>(
      `${this.linkSelect()} WHERE link.classroom_id = ANY($1::bigint[]) ORDER BY link.classroom_id`,
      [inputs.map((input) => input.classroomId)],
    );
    return rows.rows;
  }

  async findById(id: string, runner?: QueryRunner, lock = false): Promise<ClassroomLinkRow | null> {
    const executor = runner
      ? createSqlQueryExecutor(runner)
      : {
          query: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
            queryDataSource<T>(this.dataSource, sql, params),
        };
    const result = await executor.query<ClassroomLinkRow>(
      `${this.linkSelect()} WHERE link.id = $1 ${lock ? 'FOR UPDATE OF link' : ''}`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findUsableByTokenHash(tokenHash: string): Promise<ClassroomLinkRow | null> {
    const result = await queryDataSource<ClassroomLinkRow>(
      this.dataSource,
      `${this.linkSelect()}
       WHERE link.token_hash = $1
         AND link.link_status = 'ACTIVE'
         AND school.school_status = 'ACTIVE'
         AND term.status = 'ACTIVE' AND term.deleted_at IS NULL
         AND classroom.classroom_status = 'ACTIVE' AND classroom.deleted_at IS NULL
       LIMIT 1`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async findUsableById(id: string): Promise<ClassroomLinkRow | null> {
    const result = await queryDataSource<ClassroomLinkRow>(
      this.dataSource,
      `${this.linkSelect()}
       WHERE link.id = $1
         AND link.link_status = 'ACTIVE'
         AND school.school_status = 'ACTIVE'
         AND term.status = 'ACTIVE' AND term.deleted_at IS NULL
         AND classroom.classroom_status = 'ACTIVE' AND classroom.deleted_at IS NULL
       LIMIT 1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async isLinkInScope(id: string, scope: DataScope): Promise<boolean> {
    const scopeQuery = buildDataScopeQuery(
      scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'classroom.grade_level_id',
        room: 'classroom.legacy_room_number',
      },
      2,
    );
    const result = await queryDataSource(
      this.dataSource,
      `SELECT 1
       FROM classroom_attendance_links link
       JOIN schools school ON school.id = link.school_id
       JOIN school_classrooms classroom ON classroom.id = link.classroom_id
       WHERE link.id = $1 AND ${scopeQuery.sql || 'TRUE'}
       LIMIT 1`,
      [id, ...scopeQuery.params],
    );
    return result.rows.length > 0;
  }

  async updateToken(
    id: string,
    tokenHash: string,
    tokenEncrypted: string,
    actorId: number,
    runner: QueryRunner,
  ): Promise<void> {
    await createSqlQueryExecutor(runner).query(
      `UPDATE classroom_attendance_links
       SET token_hash = $2, token_encrypted = $3, link_status = 'ACTIVE',
           rotated_at = now(), last_used_at = NULL,
           line_delivery_status = CASE
             WHEN line_delivery_status = 'SENT' THEN 'NEEDS_RESEND'
             ELSE 'NOT_READY'
           END,
           line_delivery_failure_code = NULL,
           line_delivery_request_id = NULL,
           line_delivered_at = NULL,
           updated_by = $4
       WHERE id = $1`,
      [id, tokenHash, tokenEncrypted, actorId],
    );
  }

  async deactivate(id: string, actorId: number, runner: QueryRunner): Promise<void> {
    await createSqlQueryExecutor(runner).query(
      `UPDATE classroom_attendance_links
       SET link_status = 'INACTIVE', updated_by = $2
       WHERE id = $1`,
      [id, actorId],
    );
  }

  async recordLineDeliveryNotReady(
    id: string,
    teacherMembershipId: string | null,
    failureCode: Extract<
      ClassroomLinkLineDeliveryFailureCode,
      | 'HOMEROOM_UNAVAILABLE'
      | 'MESSAGING_DISABLED'
      | 'ACCOUNT_NOT_VERIFIED'
      | 'ACCOUNT_NOT_REACHABLE'
    >,
    actorId: number,
  ): Promise<ClassroomLinkRow | null> {
    await queryDataSource(
      this.dataSource,
      `UPDATE classroom_attendance_links
       SET line_delivery_teacher_membership_id = $2,
           line_delivery_status = 'NOT_READY',
           line_delivery_failure_code = $3,
           line_delivery_request_id = NULL,
           line_delivered_at = NULL,
           updated_by = $4
       WHERE id = $1 AND link_status = 'ACTIVE'`,
      [id, teacherMembershipId, failureCode, actorId],
    );
    return await this.findById(id);
  }

  async claimLineDelivery(
    id: string,
    teacherMembershipId: string,
    deliveryRequestId: string,
    actorId: number,
  ): Promise<ClassroomLinkRow | null> {
    const result = await queryDataSource<{ id: string }>(
      this.dataSource,
      `UPDATE classroom_attendance_links
       SET line_delivery_teacher_membership_id = $2,
           line_delivery_status = 'SENDING',
           line_delivery_failure_code = NULL,
           line_delivery_attempt_count = line_delivery_attempt_count + 1,
           line_delivery_request_id = $3::uuid,
           line_delivery_last_attempted_at = now(),
           line_delivered_at = NULL,
           updated_by = $4
       WHERE id = $1
         AND link_status = 'ACTIVE'
         AND EXISTS (
           SELECT 1
           FROM classroom_homeroom_teachers homeroom
           JOIN school_teacher_memberships membership
             ON membership.id = homeroom.teacher_membership_id
            AND membership.school_id = homeroom.school_id
            AND membership.membership_status = 'ACTIVE'
            AND membership.deleted_at IS NULL
           JOIN teachers teacher
             ON teacher.id = membership.teacher_id
            AND teacher.teacher_status = 'ACTIVE'
            AND teacher.deleted_at IS NULL
           WHERE homeroom.classroom_id = classroom_attendance_links.classroom_id
             AND homeroom.teacher_membership_id = $2
         )
         AND (
           line_delivery_status <> 'SENDING'
           OR line_delivery_last_attempted_at < now() - interval '5 minutes'
         )
         AND NOT (
           line_delivery_status = 'SENT'
           AND line_delivery_request_id = $3::uuid
           AND line_delivery_teacher_membership_id = $2
         )
       RETURNING id::text`,
      [id, teacherMembershipId, deliveryRequestId, actorId],
    );
    return result.rows[0] ? await this.findById(id) : null;
  }

  async finishLineDelivery(
    id: string,
    deliveryRequestId: string,
    delivered: boolean,
    failureCode: Extract<
      ClassroomLinkLineDeliveryFailureCode,
      'PROVIDER_REJECTED' | 'PROVIDER_UNAVAILABLE'
    > | null,
    actorId: number,
  ): Promise<ClassroomLinkRow | null> {
    await queryDataSource(
      this.dataSource,
      `UPDATE classroom_attendance_links
       SET line_delivery_status = CASE WHEN $3::boolean THEN 'SENT' ELSE 'FAILED' END,
           line_delivery_failure_code = $4,
           line_delivered_at = CASE WHEN $3::boolean THEN now() ELSE NULL END,
           updated_by = $5
       WHERE id = $1
         AND line_delivery_request_id = $2::uuid
         AND line_delivery_status = 'SENDING'`,
      [id, deliveryRequestId, delivered, failureCode, actorId],
    );
    return await this.findById(id);
  }

  async findTeacherByEmail(email: string, schoolId: number): Promise<ExternalTeacherRow | null> {
    return await this.findTeacher(`lower(btrim(teacher.email)) = $1`, [email, schoolId]);
  }

  async findTeacherByCitizenId(
    citizenId: string,
    schoolId: number,
  ): Promise<ExternalTeacherRow | null> {
    return await this.findTeacher(`teacher.citizen_id = $1`, [citizenId, schoolId]);
  }

  async findActiveMembership(
    membershipId: string,
    schoolId: number,
  ): Promise<ExternalTeacherRow | null> {
    const result = await queryDataSource<ExternalTeacherRow>(
      this.dataSource,
      `SELECT teacher.id::text AS teacher_id, membership.id::text AS teacher_membership_id,
              membership.school_id,
              TRIM(teacher.first_name || ' ' || teacher.last_name) AS teacher_display_name,
              lower(btrim(teacher.email)) AS normalized_email, teacher.citizen_id,
              teacher.teacher_status, membership.membership_status,
              teacher.deleted_at AS teacher_deleted_at,
              membership.deleted_at AS membership_deleted_at
       FROM school_teacher_memberships membership
       JOIN teachers teacher ON teacher.id = membership.teacher_id
       WHERE membership.id = $1 AND membership.school_id = $2
       LIMIT 1`,
      [membershipId, schoolId],
    );
    return result.rows[0] ?? null;
  }

  private async findTeacher(
    condition: string,
    params: unknown[],
  ): Promise<ExternalTeacherRow | null> {
    const result = await queryDataSource<ExternalTeacherRow>(
      this.dataSource,
      `SELECT teacher.id::text AS teacher_id, membership.id::text AS teacher_membership_id,
              membership.school_id,
              TRIM(teacher.first_name || ' ' || teacher.last_name) AS teacher_display_name,
              lower(btrim(teacher.email)) AS normalized_email, teacher.citizen_id,
              teacher.teacher_status, membership.membership_status,
              teacher.deleted_at AS teacher_deleted_at,
              membership.deleted_at AS membership_deleted_at
       FROM teachers teacher
       JOIN school_teacher_memberships membership ON membership.teacher_id = teacher.id
       WHERE ${condition} AND membership.school_id = $2
       LIMIT 2`,
      params,
    );
    return result.rows.length === 1 ? result.rows[0] : null;
  }

  async bindExternalIdentity(
    input: {
      teacherId: string;
      provider: 'GOOGLE' | 'THAID';
      providerSubject: string;
      normalizedEmail: string | null;
    },
    runner: QueryRunner,
  ): Promise<void> {
    await createSqlQueryExecutor(runner).query(
      `INSERT INTO teacher_external_identities (
         teacher_id, provider, provider_subject, normalized_email,
         verified_at, last_authenticated_at
       ) VALUES ($1, $2, $3, $4, now(), now())
       ON CONFLICT (teacher_id, provider) DO UPDATE
       SET provider_subject = CASE
             WHEN teacher_external_identities.provider_subject = EXCLUDED.provider_subject
             THEN EXCLUDED.provider_subject
             ELSE teacher_external_identities.provider_subject
           END,
           normalized_email = EXCLUDED.normalized_email,
           last_authenticated_at = now(), deleted_at = NULL, deleted_by = NULL
       RETURNING id`,
      [input.teacherId, input.provider, input.providerSubject, input.normalizedEmail],
    );
    const identity = await createSqlQueryExecutor(runner).query<{ teacher_id: string }>(
      `SELECT teacher_id::text
       FROM teacher_external_identities
       WHERE provider = $1 AND provider_subject = $2 AND deleted_at IS NULL`,
      [input.provider, input.providerSubject],
    );
    if (identity.rows[0]?.teacher_id !== input.teacherId) {
      throw new Error('EXTERNAL_IDENTITY_CONFLICT');
    }
  }

  async touchLinkUsed(id: string): Promise<void> {
    await queryDataSource(
      this.dataSource,
      `UPDATE classroom_attendance_links SET last_used_at = now() WHERE id = $1 AND link_status = 'ACTIVE'`,
      [id],
    );
  }
}
