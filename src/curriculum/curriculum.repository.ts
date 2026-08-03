import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { escapeLikePattern } from '../common/utils/helpers';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type {
  CurriculumGradeRow,
  CurriculumSubjectRow,
  CurriculumSubjectTeacherRow,
} from './curriculum.types';

const SUBJECT_SELECT_SQL = `
  offering.id::text,
  offering.school_id,
  offering.school_term_id::text,
  offering.grade_level_id,
  grade.label AS grade_label,
  offering.subject_id,
  subject.code AS subject_code,
  subject.name_th AS subject_name,
  offering.content_storage_key,
  offering.content_file_name,
  offering.content_file_size_bytes,
  offering.curriculum_status,
  offering.updated_at::text
`;

@Injectable()
export class CurriculumRepository {
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

  /**
   * Grade levels the school actually runs (it has classrooms for them in the
   * term), each with how many subjects the curriculum already offers.
   */
  async listGrades(input: {
    schoolId: number;
    termId?: number;
    searchTerm?: string;
  }): Promise<CurriculumGradeRow[]> {
    const params: unknown[] = [input.schoolId];
    const termFilter = input.termId
      ? `AND classroom.school_term_id = $${params.push(input.termId)}`
      : '';
    const search = input.searchTerm?.trim();
    const searchFilter = search
      ? `AND grade.label ILIKE $${params.push(`%${escapeLikePattern(search)}%`)} ESCAPE '\\'`
      : '';
    const offeringTermFilter = input.termId ? `AND offering.school_term_id = $2` : '';

    const result = await queryDataSource<CurriculumGradeRow>(
      this.dataSource,
      `
        SELECT
          grade.id AS grade_level_id,
          grade.label AS grade_label,
          grade.category AS grade_category,
          (
            SELECT COUNT(*)::int
            FROM curriculum_subjects offering
            WHERE offering.school_id = classrooms.school_id
              AND offering.grade_level_id = grade.id
              AND offering.curriculum_status = 'ACTIVE'
              AND offering.deleted_at IS NULL
              ${offeringTermFilter}
          ) AS subject_count
        FROM (
          SELECT DISTINCT classroom.school_id, classroom.grade_level_id
          FROM school_classrooms classroom
          WHERE classroom.school_id = $1
            AND classroom.classroom_status = 'ACTIVE'
            AND classroom.deleted_at IS NULL
            ${termFilter}
        ) classrooms
        JOIN grade_levels grade ON grade.id = classrooms.grade_level_id
        WHERE TRUE ${searchFilter}
        ORDER BY grade.id ASC
      `,
      params,
    );
    return result.rows;
  }

  async listSubjects(input: {
    schoolId: number;
    termId: number;
    gradeLevelId: number;
    searchTerm?: string;
    page: number;
    limit: number;
  }): Promise<{ rows: CurriculumSubjectRow[]; totalCount: number }> {
    const params: unknown[] = [input.schoolId, input.termId, input.gradeLevelId];
    const conditions = [
      'offering.school_id = $1',
      'offering.school_term_id = $2',
      'offering.grade_level_id = $3',
      "offering.curriculum_status = 'ACTIVE'",
      'offering.deleted_at IS NULL',
    ];
    const search = input.searchTerm?.trim();
    if (search) {
      params.push(`%${escapeLikePattern(search)}%`);
      conditions.push(`(
        subject.code ILIKE $${params.length} ESCAPE '\\'
        OR subject.name_th ILIKE $${params.length} ESCAPE '\\'
      )`);
    }

    const fromSql = `
      FROM curriculum_subjects offering
      JOIN subjects subject ON subject.id = offering.subject_id
      JOIN grade_levels grade ON grade.id = offering.grade_level_id
      WHERE ${conditions.join(' AND ')}
    `;

    const countResult = await queryDataSource<{ count: number }>(
      this.dataSource,
      `SELECT COUNT(*)::int AS count ${fromSql}`,
      params,
    );
    const result = await queryDataSource<CurriculumSubjectRow>(
      this.dataSource,
      `
        SELECT ${SUBJECT_SELECT_SQL}
        ${fromSql}
        ORDER BY subject.code ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, input.limit, (input.page - 1) * input.limit],
    );
    return { rows: result.rows, totalCount: countResult.rows[0]?.count ?? 0 };
  }

  async findSubjectById(
    curriculumSubjectId: string,
    queryRunner?: QueryRunner,
    lockForUpdate = false,
  ): Promise<CurriculumSubjectRow | null> {
    const sql = `
      SELECT ${SUBJECT_SELECT_SQL}
      FROM curriculum_subjects offering
      JOIN subjects subject ON subject.id = offering.subject_id
      JOIN grade_levels grade ON grade.id = offering.grade_level_id
      WHERE offering.id = $1 AND offering.deleted_at IS NULL
      LIMIT 1
      ${lockForUpdate ? 'FOR UPDATE OF offering' : ''}
    `;
    const result = queryRunner
      ? await createSqlQueryExecutor(queryRunner).query<CurriculumSubjectRow>(sql, [
          curriculumSubjectId,
        ])
      : await queryDataSource<CurriculumSubjectRow>(this.dataSource, sql, [curriculumSubjectId]);
    return result.rows[0] ?? null;
  }

  /** Teacher/classroom coverage rows for a set of offerings, in one round trip. */
  async listTeachersForSubjects(
    curriculumSubjectIds: string[],
  ): Promise<CurriculumSubjectTeacherRow[]> {
    if (curriculumSubjectIds.length === 0) return [];
    const result = await queryDataSource<CurriculumSubjectTeacherRow>(
      this.dataSource,
      `
        SELECT
          coverage.id::text,
          coverage.curriculum_subject_id::text,
          coverage.teacher_membership_id::text,
          COALESCE(
            NULLIF(BTRIM(teacher.first_name || ' ' || teacher.last_name), ''),
            'ไม่ระบุชื่อ'
          ) AS teacher_name,
          coverage.classroom_id::text,
          grade.label || '/' || classroom.room_code AS classroom_label
        FROM curriculum_subject_teachers coverage
        JOIN school_teacher_memberships membership
          ON membership.id = coverage.teacher_membership_id
        JOIN teachers teacher ON teacher.id = membership.teacher_id
        JOIN school_classrooms classroom ON classroom.id = coverage.classroom_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        WHERE coverage.curriculum_subject_id = ANY($1::bigint[])
          AND coverage.deleted_at IS NULL
        ORDER BY teacher_name ASC, classroom.room_code ASC
      `,
      [curriculumSubjectIds],
    );
    return result.rows;
  }

  /**
   * Subjects are a shared catalogue keyed by code, so a school reusing an
   * existing code joins that entry instead of creating a duplicate.
   */
  async upsertSubject(
    input: { code: string; nameTh: string; actorId: number | null },
    queryRunner: QueryRunner,
  ): Promise<{ id: number }> {
    const executor = createSqlQueryExecutor(queryRunner);
    const existing = await executor.query<{ id: number }>(
      `SELECT id FROM subjects WHERE LOWER(code) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
      [input.code],
    );
    if (existing.rows[0]) {
      await executor.query(`UPDATE subjects SET name_th = $2, updated_by = $3 WHERE id = $1`, [
        existing.rows[0].id,
        input.nameTh,
        input.actorId,
      ]);
      return existing.rows[0];
    }
    const created = await executor.query<{ id: number }>(
      `
        INSERT INTO subjects (code, name_th, created_by, updated_by)
        VALUES ($1, $2, $3, $3)
        RETURNING id
      `,
      [input.code, input.nameTh, input.actorId],
    );
    return created.rows[0];
  }

  async createSubjectOffering(
    input: {
      schoolId: number;
      termId: number;
      gradeLevelId: number;
      subjectId: number;
      actorId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<{ id: string }> {
    const result = await createSqlQueryExecutor(queryRunner).query<{ id: string }>(
      `
        INSERT INTO curriculum_subjects (
          school_id, school_term_id, grade_level_id, subject_id, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $5)
        RETURNING id::text
      `,
      [input.schoolId, input.termId, input.gradeLevelId, input.subjectId, input.actorId],
    );
    return result.rows[0];
  }

  async updateSubjectOffering(
    curriculumSubjectId: string,
    subjectId: number,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await createSqlQueryExecutor(queryRunner).query(
      `UPDATE curriculum_subjects SET subject_id = $2, updated_by = $3 WHERE id = $1`,
      [curriculumSubjectId, subjectId, actorId],
    );
  }

  async updateContent(
    curriculumSubjectId: string,
    content: { storageKey: string; fileName: string; sizeBytes: number } | null,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await createSqlQueryExecutor(queryRunner).query(
      `
        UPDATE curriculum_subjects
        SET content_storage_key = $2,
            content_file_name = $3,
            content_file_size_bytes = $4,
            updated_by = $5
        WHERE id = $1
      `,
      [
        curriculumSubjectId,
        content?.storageKey ?? null,
        content?.fileName ?? null,
        content?.sizeBytes ?? null,
        actorId,
      ],
    );
  }

  /**
   * Replaces the whole coverage set for an offering. The form always submits the
   * complete list, so a diff would only add complexity without changing outcome.
   */
  async replaceTeacherCoverage(
    input: {
      curriculumSubjectId: string;
      schoolId: number;
      termId: number;
      gradeLevelId: number;
      coverage: Array<{ teacherMembershipId: number; classroomId: number }>;
      actorId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<void> {
    const executor = createSqlQueryExecutor(queryRunner);
    await executor.query(
      `
        UPDATE curriculum_subject_teachers
        SET deleted_at = now(), deleted_by = $2, updated_by = $2
        WHERE curriculum_subject_id = $1 AND deleted_at IS NULL
      `,
      [input.curriculumSubjectId, input.actorId],
    );
    if (input.coverage.length === 0) return;

    const values: string[] = [];
    const params: unknown[] = [
      input.curriculumSubjectId,
      input.schoolId,
      input.termId,
      input.gradeLevelId,
      input.actorId,
    ];
    for (const item of input.coverage) {
      const teacherIndex = params.push(item.teacherMembershipId);
      const classroomIndex = params.push(item.classroomId);
      values.push(`($1, $2, $3, $4, $${teacherIndex}, $${classroomIndex}, $5, $5)`);
    }
    await executor.query(
      `
        INSERT INTO curriculum_subject_teachers (
          curriculum_subject_id, school_id, school_term_id, grade_level_id,
          teacher_membership_id, classroom_id, created_by, updated_by
        )
        VALUES ${values.join(', ')}
      `,
      params,
    );
  }

  async softDeleteSubjectOffering(
    curriculumSubjectId: string,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    const executor = createSqlQueryExecutor(queryRunner);
    await executor.query(
      `
        UPDATE curriculum_subject_teachers
        SET deleted_at = now(), deleted_by = $2, updated_by = $2
        WHERE curriculum_subject_id = $1 AND deleted_at IS NULL
      `,
      [curriculumSubjectId, actorId],
    );
    await executor.query(
      `
        UPDATE curriculum_subjects
        SET curriculum_status = 'INACTIVE', deleted_at = now(), deleted_by = $2
        WHERE id = $1
      `,
      [curriculumSubjectId, actorId],
    );
  }
}
