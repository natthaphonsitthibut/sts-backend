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
  teacher.linked_user_id,
  membership.id::text AS membership_id,
  membership.school_id,
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
   * Existing person with the same national id, so a transferring teacher is
   * re-used instead of duplicated. Only well-formed ids are ever stored, so a
   * blank id can never collide.
   */
  async findTeacherByCitizenId(
    citizenId: string,
    queryRunner: QueryRunner,
  ): Promise<{ id: string } | null> {
    const result = await createSqlQueryExecutor(queryRunner).query<{ id: string }>(
      `
        SELECT id::text
        FROM teachers
        WHERE citizen_id = $1 AND deleted_at IS NULL
        LIMIT 1
      `,
      [citizenId],
    );
    return result.rows[0] ?? null;
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
          school_id, teacher_id, teacher_user_id, membership_status, started_on, created_by, updated_by
        )
        VALUES ($1, $2, NULL, 'ACTIVE', CURRENT_DATE, $3, $3)
        RETURNING id::text
      `,
      [input.schoolId, input.teacherId, input.actorId],
    );
    return result.rows[0];
  }

  /**
   * Soft delete: the membership is ended and the person is marked inactive, so
   * attendance, timetable and audit rows that point at them stay intact.
   */
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
  }
}
