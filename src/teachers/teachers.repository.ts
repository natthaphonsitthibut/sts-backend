import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { escapeLikePattern } from '../common/utils/helpers';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type { TeacherRow, TeacherStatus } from './teachers.types';

/** Columns every teacher read returns, joined to the membership for the school in view. */
const TEACHER_SELECT_SQL = `
  teacher.id::text,
  teacher.first_name,
  teacher.last_name,
  teacher.citizen_id,
  teacher.phone,
  teacher.email,
  teacher.line_id,
  teacher.photo_storage_key,
  teacher.teacher_status,
  membership.id::text AS membership_id,
  membership.school_id,
  school.name AS school_name,
  membership.membership_status,
  membership.started_on::text,
  membership.ended_on::text,
  teacher.updated_at::text
`;

@Injectable()
export class TeachersRepository {
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

  /** True when the actor's data scope covers this school. */
  async isSchoolInScope(schoolId: number, scope: DataScope): Promise<boolean> {
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
    const result = await queryDataSource(
      this.dataSource,
      `
        SELECT 1
        FROM schools school
        WHERE school.id = $1
          AND school.school_status = 'ACTIVE'
          AND ${scopeQuery.sql || 'TRUE'}
        LIMIT 1
      `,
      [schoolId, ...scopeQuery.params],
    );
    return result.rows.length > 0;
  }

  async listTeachers(input: {
    schoolId: number;
    searchTerm?: string;
    teacherStatus?: TeacherStatus;
    sortBy?: 'name' | 'citizenId' | 'phone' | 'lineId' | 'email';
    sortOrder?: 'asc' | 'desc';
    page: number;
    limit: number;
  }): Promise<{ rows: TeacherRow[]; totalCount: number }> {
    const params: unknown[] = [input.schoolId];
    const conditions = [
      'membership.school_id = $1',
      'membership.deleted_at IS NULL',
      'teacher.deleted_at IS NULL',
    ];

    const search = input.searchTerm?.trim();
    if (search) {
      params.push(`%${escapeLikePattern(search)}%`);
      conditions.push(`(
        CONCAT_WS(' ', teacher.first_name, teacher.last_name) ILIKE $${params.length} ESCAPE '\\'
        OR COALESCE(teacher.citizen_id, '') ILIKE $${params.length} ESCAPE '\\'
        OR COALESCE(teacher.phone, '') ILIKE $${params.length} ESCAPE '\\'
        OR COALESCE(teacher.email, '') ILIKE $${params.length} ESCAPE '\\'
        OR COALESCE(teacher.line_id, '') ILIKE $${params.length} ESCAPE '\\'
      )`);
    }
    if (input.teacherStatus) {
      params.push(input.teacherStatus);
      conditions.push(`membership.membership_status = $${params.length}`);
    }

    const fromSql = `
      FROM school_teacher_memberships membership
      JOIN teachers teacher ON teacher.id = membership.teacher_id
      LEFT JOIN schools school ON school.id = membership.school_id
      WHERE ${conditions.join(' AND ')}
    `;

    const countResult = await queryDataSource<{ count: number }>(
      this.dataSource,
      `SELECT COUNT(*)::int AS count ${fromSql}`,
      params,
    );
    const offset = (input.page - 1) * input.limit;
    const sortColumn =
      {
        name: 'teacher.first_name',
        citizenId: 'teacher.citizen_id',
        phone: 'teacher.phone',
        lineId: 'teacher.line_id',
        email: 'teacher.email',
      }[input.sortBy ?? 'name'] ?? 'teacher.first_name';
    const sortOrder = input.sortOrder === 'desc' ? 'DESC' : 'ASC';
    const sortExpression =
      input.sortBy === undefined || input.sortBy === 'name'
        ? `teacher.first_name ${sortOrder}, teacher.last_name ${sortOrder}`
        : `${sortColumn} ${sortOrder} NULLS LAST`;
    const result = await queryDataSource<TeacherRow>(
      this.dataSource,
      `
        SELECT ${TEACHER_SELECT_SQL}
        ${fromSql}
        ORDER BY ${sortExpression}, teacher.id ${sortOrder}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, input.limit, offset],
    );
    return { rows: result.rows, totalCount: countResult.rows[0]?.count ?? 0 };
  }

  async findTeacherById(teacherId: string, queryRunner?: QueryRunner): Promise<TeacherRow | null> {
    const sql = `
      SELECT ${TEACHER_SELECT_SQL}
      FROM teachers teacher
      JOIN school_teacher_memberships membership
        ON membership.teacher_id = teacher.id
       AND membership.deleted_at IS NULL
      LEFT JOIN schools school ON school.id = membership.school_id
      WHERE teacher.id = $1 AND teacher.deleted_at IS NULL
      ORDER BY
        CASE WHEN membership.membership_status = 'ACTIVE' THEN 0 ELSE 1 END,
        membership.started_on DESC,
        membership.id DESC
      LIMIT 1
    `;
    const result = queryRunner
      ? await createSqlQueryExecutor(queryRunner).query<TeacherRow>(sql, [teacherId])
      : await queryDataSource<TeacherRow>(this.dataSource, sql, [teacherId]);
    return result.rows[0] ?? null;
  }

  /**
   * Read-only profile access for classroom-link operators. The teacher must be
   * an active homeroom teacher of at least one classroom inside the actor's
   * school/grade/room scope; a guessed id outside that scope returns no row.
   */
  async findActiveHomeroomTeacherInScope(
    teacherId: string,
    scope: DataScope,
  ): Promise<TeacherRow | null> {
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
    const result = await queryDataSource<TeacherRow>(
      this.dataSource,
      `
        SELECT ${TEACHER_SELECT_SQL}
        FROM teachers teacher
        JOIN school_teacher_memberships membership
          ON membership.teacher_id = teacher.id
         AND membership.membership_status = 'ACTIVE'
         AND membership.deleted_at IS NULL
        JOIN schools school
          ON school.id = membership.school_id
         AND school.school_status = 'ACTIVE'
        WHERE teacher.id = $1
          AND teacher.teacher_status = 'ACTIVE'
          AND teacher.deleted_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM classroom_homeroom_teacher_assignments homeroom
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
            WHERE homeroom.teacher_membership_id = membership.id
              AND homeroom.school_id = membership.school_id
              AND ${scopeQuery.sql || 'TRUE'}
          )
        ORDER BY membership.started_on DESC, membership.id DESC
        LIMIT 1
      `,
      [teacherId, ...scopeQuery.params],
    );
    return result.rows[0] ?? null;
  }

  async listActivePiiRevealGroups(
    actorUserId: number,
    subjectRef: string,
    ttlSeconds: number,
  ): Promise<string[]> {
    const result = await queryDataSource<{ field_group: string }>(
      this.dataSource,
      `
        SELECT DISTINCT field_group
        FROM pii_access_events
        WHERE actor_user_id = $1
          AND subject_type = 'TEACHER'
          AND subject_ref = $2
          AND created_at >= now() - ($3 * interval '1 second')
      `,
      [actorUserId, subjectRef, ttlSeconds],
    );
    return result.rows.map((row) => row.field_group);
  }

  async insertPiiAccessEvent(input: {
    actorUserId: number | null;
    actorRoles: string[];
    subjectRef: string;
    subjectRefKeyVersion: number;
    reasonCode: string;
    reasonNote: string | null;
    requestId: string | null;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void> {
    await queryDataSource(
      this.dataSource,
      `
        INSERT INTO pii_access_events (
          actor_user_id, actor_roles, actor_kind, subject_student_ref,
          subject_type, subject_ref, subject_ref_key_version, field_group,
          reason_code, reason_note, purpose_link_id, request_id, ip, user_agent
        )
        VALUES ($1, $2::jsonb, 'STAFF', $3, 'TEACHER', $3, $4,
                'NATIONAL_ID', $5, $6, NULL, $7, $8, $9)
      `,
      [
        input.actorUserId,
        JSON.stringify(input.actorRoles),
        input.subjectRef,
        input.subjectRefKeyVersion,
        input.reasonCode,
        input.reasonNote,
        input.requestId,
        input.ip,
        input.userAgent,
      ],
    );
  }

  /**
   * Existing person with the same national id, so a transferring teacher is
   * re-used instead of duplicated. Only well-formed ids are ever stored, so a
   * blank id can never collide.
   */
  async findTeacherByCitizenId(
    citizenId: string,
    queryRunner: QueryRunner,
  ): Promise<{ id: string; teacher_status: 'ACTIVE' | 'INACTIVE' } | null> {
    const result = await createSqlQueryExecutor(queryRunner).query<{
      id: string;
      teacher_status: 'ACTIVE' | 'INACTIVE';
    }>(
      `
        SELECT id::text, teacher_status
        FROM teachers
        WHERE citizen_id = $1 AND deleted_at IS NULL
        LIMIT 1
      `,
      [citizenId],
    );
    return result.rows[0] ?? null;
  }

  async reactivateTeacher(
    teacherId: string,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await createSqlQueryExecutor(queryRunner).query(
      `
        UPDATE teachers
        SET teacher_status = 'ACTIVE', updated_by = $2, updated_at = now()
        WHERE id = $1
          AND teacher_status = 'INACTIVE'
          AND deleted_at IS NULL
      `,
      [teacherId, actorId],
    );
  }

  async createTeacher(
    input: {
      firstName: string;
      lastName: string;
      citizenId: string | null;
      phone: string | null;
      email: string | null;
      lineId: string | null;
      actorId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<{ id: string }> {
    const result = await createSqlQueryExecutor(queryRunner).query<{ id: string }>(
      `
        INSERT INTO teachers (
          first_name, last_name, citizen_id, phone, email, line_id, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        RETURNING id::text
      `,
      [
        input.firstName,
        input.lastName,
        input.citizenId,
        input.phone,
        input.email,
        input.lineId,
        input.actorId,
      ],
    );
    return result.rows[0];
  }

  async updateTeacher(
    teacherId: string,
    input: {
      firstName?: string;
      lastName?: string;
      citizenId?: string | null;
      phone?: string | null;
      email?: string | null;
      lineId?: string | null;
      actorId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<void> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown): void => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (input.firstName !== undefined) set('first_name', input.firstName);
    if (input.lastName !== undefined) set('last_name', input.lastName);
    if (input.citizenId !== undefined) set('citizen_id', input.citizenId);
    if (input.phone !== undefined) set('phone', input.phone);
    if (input.email !== undefined) set('email', input.email);
    if (input.lineId !== undefined) set('line_id', input.lineId);
    if (assignments.length === 0) return;
    set('updated_by', input.actorId);

    params.push(teacherId);
    await createSqlQueryExecutor(queryRunner).query(
      `UPDATE teachers SET ${assignments.join(', ')} WHERE id = $${params.length}`,
      params,
    );
  }

  async updateTeacherPhoto(
    teacherId: string,
    storageKey: string | null,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await createSqlQueryExecutor(queryRunner).query(
      `UPDATE teachers SET photo_storage_key = $2, updated_by = $3 WHERE id = $1`,
      [teacherId, storageKey, actorId],
    );
  }

  async findActiveMembership(
    teacherId: string,
    schoolId: number,
    queryRunner: QueryRunner,
  ): Promise<{ id: string } | null> {
    const result = await createSqlQueryExecutor(queryRunner).query<{ id: string }>(
      `
        SELECT id::text
        FROM school_teacher_memberships
        WHERE teacher_id = $1
          AND school_id = $2
          AND membership_status = 'ACTIVE'
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [teacherId, schoolId],
    );
    return result.rows[0] ?? null;
  }

  async createMembership(
    input: { teacherId: string; schoolId: number; actorId: number | null },
    queryRunner: QueryRunner,
  ): Promise<{ id: string }> {
    const result = await createSqlQueryExecutor(queryRunner).query<{ id: string }>(
      `
        INSERT INTO school_teacher_memberships (
          school_id, teacher_id, membership_status, started_on, created_by, updated_by
        )
        VALUES ($1, $2, 'ACTIVE', CURRENT_DATE, $3, $3)
        RETURNING id::text
      `,
      [input.schoolId, input.teacherId, input.actorId],
    );
    return result.rows[0];
  }

  async lockHomeroomClassroomsForTeacher(
    teacherId: string,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await createSqlQueryExecutor(queryRunner).query(
      `
        SELECT classroom.id
        FROM school_classrooms classroom
        WHERE classroom.id IN (
          SELECT primary_assignment.classroom_id
          FROM classroom_homeroom_teachers primary_assignment
          JOIN school_teacher_memberships membership
            ON membership.id = primary_assignment.teacher_membership_id
          WHERE membership.teacher_id = $1
          UNION
          SELECT additional_assignment.classroom_id
          FROM classroom_additional_homeroom_teachers additional_assignment
          JOIN school_teacher_memberships membership
            ON membership.id = additional_assignment.teacher_membership_id
          WHERE membership.teacher_id = $1
        )
        ORDER BY classroom.id
        FOR UPDATE OF classroom
      `,
      [teacherId],
    );
  }

  /** Ends the membership and removes its current homeroom relation. */
  async deactivateTeacher(
    input: { teacherId: string; membershipId: string; actorId: number | null },
    queryRunner: QueryRunner,
  ): Promise<void> {
    const executor = createSqlQueryExecutor(queryRunner);
    await executor.query(
      `
        UPDATE school_teacher_memberships
        SET membership_status = 'INACTIVE',
            ended_on = CURRENT_DATE,
            updated_by = $2
        WHERE id = $1
      `,
      [input.membershipId, input.actorId],
    );
    await executor.query(
      `DELETE FROM classroom_additional_homeroom_teachers WHERE teacher_membership_id = $1`,
      [input.membershipId],
    );
    await executor.query(
      `DELETE FROM classroom_homeroom_teachers WHERE teacher_membership_id = $1`,
      [input.membershipId],
    );
    await executor.query(
      `
        UPDATE teachers
        SET teacher_status = 'INACTIVE', updated_by = $2
        WHERE id = $1
          AND NOT EXISTS (
            SELECT 1
            FROM school_teacher_memberships other
            WHERE other.teacher_id = teachers.id
              AND other.membership_status = 'ACTIVE'
              AND other.deleted_at IS NULL
          )
      `,
      [input.teacherId, input.actorId],
    );
    await executor.query(
      `
        UPDATE teacher_messaging_accounts account
        SET unlinked_at = now(),
            unlinked_reason = 'TEACHER_DEACTIVATED',
            updated_by = $2
        WHERE account.teacher_id = $1
          AND account.provider = 'LINE'
          AND account.unlinked_at IS NULL
          AND account.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM school_teacher_memberships active_membership
            WHERE active_membership.teacher_id = account.teacher_id
              AND active_membership.membership_status = 'ACTIVE'
              AND active_membership.deleted_at IS NULL
          )
      `,
      [input.teacherId, input.actorId],
    );
  }
}
