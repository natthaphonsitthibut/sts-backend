import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import { escapeLikePattern } from '../common/utils/helpers';
import { queryDataSource } from '../database/sql-query';
import type {
  ClassroomSubjectRow,
  GradeSchoolSubjectRow,
  GradeSubjectClassroomRow,
  SchoolSubjectRow,
  SubjectGradeRow,
} from './subjects.types';

interface CountRow extends Record<string, unknown> {
  total: number;
}

interface ClassroomScopeRow extends Record<string, unknown> {
  id: string;
  school_id: number;
  grade_level_id: number;
}

@Injectable()
export class SubjectsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async listSchoolCatalog(options: {
    schoolId: number;
    page: number;
    limit: number;
    searchTerm?: string;
    status?: 'ACTIVE' | 'INACTIVE';
  }): Promise<{ rows: SchoolSubjectRow[]; totalCount: number }> {
    const params: unknown[] = [options.schoolId];
    const conditions = [
      'school_subject.school_id = $1',
      'school_subject.deleted_at IS NULL',
      'subject.deleted_at IS NULL',
    ];
    if (options.searchTerm) {
      params.push(`%${escapeLikePattern(options.searchTerm)}%`);
      conditions.push(
        `(subject.code ILIKE $${params.length} OR subject.name_th ILIKE $${params.length})`,
      );
    }
    if (options.status) {
      params.push(options.status);
      conditions.push(`school_subject.subject_status = $${params.length}`);
    }
    const whereSql = conditions.join(' AND ');
    const count = await queryDataSource<CountRow>(
      this.dataSource,
      `
        SELECT COUNT(*)::int AS total
        FROM school_subjects school_subject
        JOIN subjects subject ON subject.id = school_subject.subject_id
        WHERE ${whereSql}
      `,
      params,
    );
    const offset = (options.page - 1) * options.limit;
    const listParams = [...params, options.limit, offset];
    const rows = await queryDataSource<SchoolSubjectRow>(
      this.dataSource,
      `
        SELECT
          school_subject.id::text,
          school_subject.school_id,
          school_subject.subject_id,
          subject.code,
          subject.name_th,
          school_subject.subject_status,
          COUNT(classroom_subject.id)::int AS classroom_count,
          school_subject.created_at,
          school_subject.updated_at
        FROM school_subjects school_subject
        JOIN subjects subject ON subject.id = school_subject.subject_id
        LEFT JOIN classroom_subjects classroom_subject
          ON classroom_subject.school_subject_id = school_subject.id
         AND classroom_subject.offering_status = 'ACTIVE'
         AND classroom_subject.deleted_at IS NULL
        WHERE ${whereSql}
        GROUP BY school_subject.id, subject.id
        ORDER BY subject.code, school_subject.id
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
      `,
      listParams,
    );
    return { rows: rows.rows, totalCount: count.rows[0]?.total ?? 0 };
  }

  async createSchoolSubject(
    input: { schoolId: number; code: string; nameTh: string; actorId: number | null },
    queryRunner: QueryRunner,
  ): Promise<SchoolSubjectRow | null> {
    const rows = (await queryRunner.query(
      `
        WITH target_subject AS (
          INSERT INTO subjects (code, name_th, is_active, created_by, updated_by)
          VALUES ($2, $3, TRUE, $4, $4)
          ON CONFLICT (code) DO UPDATE SET
            name_th = EXCLUDED.name_th,
            is_active = TRUE,
            deleted_at = NULL,
            deleted_by = NULL,
            updated_by = EXCLUDED.updated_by
          WHERE subjects.name_th = EXCLUDED.name_th
             OR subjects.deleted_at IS NOT NULL
             OR NOT subjects.is_active
          RETURNING id, code, name_th
        ), target_school_subject AS (
          INSERT INTO school_subjects (
            school_id, subject_id, subject_status, created_by, updated_by
          )
          SELECT $1, subject.id, 'ACTIVE', $4, $4
          FROM target_subject subject
          ON CONFLICT (school_id, subject_id) WHERE deleted_at IS NULL
          DO UPDATE SET
            subject_status = 'ACTIVE',
            deleted_at = NULL,
            deleted_by = NULL,
            updated_by = EXCLUDED.updated_by
          RETURNING *
        )
        SELECT
          school_subject.id::text,
          school_subject.school_id,
          school_subject.subject_id,
          subject.code,
          subject.name_th,
          school_subject.subject_status,
          0::int AS classroom_count,
          school_subject.created_at,
          school_subject.updated_at
        FROM target_school_subject school_subject
        JOIN target_subject subject ON subject.id = school_subject.subject_id
      `,
      [input.schoolId, input.code, input.nameTh, input.actorId],
    )) as SchoolSubjectRow[];
    return rows[0] ?? null;
  }

  async findSchoolSubjectById(
    schoolSubjectId: number,
    queryRunner: QueryRunner,
  ): Promise<SchoolSubjectRow | null> {
    const rows = (await queryRunner.query(
      `
        SELECT
          school_subject.id::text,
          school_subject.school_id,
          school_subject.subject_id,
          subject.code,
          subject.name_th,
          school_subject.subject_status,
          (
            SELECT COUNT(*)::int
            FROM classroom_subjects classroom_subject
            WHERE classroom_subject.school_subject_id = school_subject.id
              AND classroom_subject.offering_status = 'ACTIVE'
              AND classroom_subject.deleted_at IS NULL
          ) AS classroom_count,
          school_subject.created_at,
          school_subject.updated_at
        FROM school_subjects school_subject
        JOIN subjects subject ON subject.id = school_subject.subject_id
        WHERE school_subject.id = $1
          AND school_subject.deleted_at IS NULL
          AND subject.deleted_at IS NULL
        FOR UPDATE OF school_subject
      `,
      [schoolSubjectId],
    )) as SchoolSubjectRow[];
    return rows[0] ?? null;
  }

  async updateSchoolSubjectStatus(
    schoolSubjectId: number,
    status: 'ACTIVE' | 'INACTIVE',
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<SchoolSubjectRow> {
    await queryRunner.query(
      `
        UPDATE school_subjects
        SET subject_status = $2, updated_by = $3
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [schoolSubjectId, status, actorId],
    );
    if (status === 'INACTIVE') {
      await queryRunner.query(
        `
          UPDATE classroom_subjects
          SET offering_status = 'INACTIVE', updated_by = $2
          WHERE school_subject_id = $1
            AND offering_status = 'ACTIVE'
            AND deleted_at IS NULL
        `,
        [schoolSubjectId, actorId],
      );
    }
    return (await this.findSchoolSubjectById(schoolSubjectId, queryRunner))!;
  }

  async findClassroomScope(classroomId: number): Promise<ClassroomScopeRow | null> {
    const result = await queryDataSource<ClassroomScopeRow>(
      this.dataSource,
      `
        SELECT id::text, school_id, grade_level_id
        FROM school_classrooms
        WHERE id = $1
          AND classroom_status = 'ACTIVE'
          AND deleted_at IS NULL
      `,
      [classroomId],
    );
    return result.rows[0] ?? null;
  }

  async listClassroomOfferings(classroomId: number): Promise<ClassroomSubjectRow[]> {
    const result = await queryDataSource<ClassroomSubjectRow>(
      this.dataSource,
      `
        SELECT
          classroom_subject.id::text,
          classroom_subject.school_id,
          classroom_subject.classroom_id::text,
          classroom_subject.school_subject_id::text,
          school_subject.subject_id,
          subject.code,
          subject.name_th,
          classroom_subject.offering_status
        FROM classroom_subjects classroom_subject
        JOIN school_subjects school_subject
          ON school_subject.id = classroom_subject.school_subject_id
         AND school_subject.school_id = classroom_subject.school_id
        JOIN subjects subject ON subject.id = school_subject.subject_id
        WHERE classroom_subject.classroom_id = $1
          AND classroom_subject.offering_status = 'ACTIVE'
          AND classroom_subject.deleted_at IS NULL
          AND school_subject.subject_status = 'ACTIVE'
          AND school_subject.deleted_at IS NULL
          AND subject.is_active
          AND subject.deleted_at IS NULL
        ORDER BY subject.code
      `,
      [classroomId],
    );
    return result.rows;
  }

  async countActiveSchoolSubjects(
    schoolId: number,
    schoolSubjectIds: number[],
    queryRunner: QueryRunner,
  ): Promise<number> {
    if (schoolSubjectIds.length === 0) return 0;
    const rows = (await queryRunner.query(
      `
        SELECT COUNT(*)::int AS total
        FROM school_subjects school_subject
        JOIN subjects subject ON subject.id = school_subject.subject_id
        WHERE school_subject.school_id = $1
          AND school_subject.id = ANY($2::bigint[])
          AND school_subject.subject_status = 'ACTIVE'
          AND school_subject.deleted_at IS NULL
          AND subject.is_active
          AND subject.deleted_at IS NULL
      `,
      [schoolId, schoolSubjectIds],
    )) as CountRow[];
    return Number(rows[0]?.total ?? 0);
  }

  async replaceClassroomOfferings(
    input: {
      classroomId: number;
      schoolId: number;
      schoolSubjectIds: number[];
      actorId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      `SELECT id FROM school_classrooms WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [input.classroomId, input.schoolId],
    );
    const desired = Array.from(new Set(input.schoolSubjectIds));

    await queryRunner.query(
      `
        UPDATE classroom_subjects
        SET offering_status = 'INACTIVE', updated_by = $3
        WHERE classroom_id = $1
          AND school_id = $2
          AND NOT (school_subject_id = ANY($4::bigint[]))
          AND offering_status = 'ACTIVE'
          AND deleted_at IS NULL
      `,
      [input.classroomId, input.schoolId, input.actorId, desired],
    );
    await queryRunner.query(
      `
        INSERT INTO classroom_subjects (
          school_id, classroom_id, school_subject_id, offering_status, created_by, updated_by
        )
        SELECT $2, $1, desired.id, 'ACTIVE', $3, $3
        FROM unnest($4::bigint[]) desired(id)
        ON CONFLICT (classroom_id, school_subject_id) WHERE deleted_at IS NULL
        DO UPDATE SET
          offering_status = 'ACTIVE',
          deleted_at = NULL,
          deleted_by = NULL,
          updated_by = EXCLUDED.updated_by
      `,
      [input.classroomId, input.schoolId, input.actorId, desired],
    );
  }

  async listSubjectGrades(input: {
    schoolId: number;
    termId?: number;
    searchTerm?: string;
  }): Promise<SubjectGradeRow[]> {
    const params: unknown[] = [input.schoolId];
    const termSql = input.termId
      ? `AND classroom.school_term_id = $${params.push(input.termId)}`
      : '';
    const searchSql = input.searchTerm
      ? `AND grade.label ILIKE $${params.push(`%${escapeLikePattern(input.searchTerm)}%`)} ESCAPE '\\'`
      : '';
    const result = await queryDataSource<SubjectGradeRow>(
      this.dataSource,
      `
        SELECT
          grade.id AS grade_level_id,
          grade.label AS grade_label,
          grade.category AS grade_category,
          COUNT(DISTINCT classroom_subject.school_subject_id)::int AS subject_count
        FROM school_classrooms classroom
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        LEFT JOIN classroom_subjects classroom_subject
          ON classroom_subject.classroom_id = classroom.id
         AND classroom_subject.offering_status = 'ACTIVE'
         AND classroom_subject.deleted_at IS NULL
        LEFT JOIN school_subjects school_subject
          ON school_subject.id = classroom_subject.school_subject_id
         AND school_subject.subject_status = 'ACTIVE'
         AND school_subject.deleted_at IS NULL
        WHERE classroom.school_id = $1
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
          ${termSql}
          ${searchSql}
        GROUP BY grade.id, grade.label, grade.category
        ORDER BY grade.id
      `,
      params,
    );
    return result.rows;
  }

  async listGradeSchoolSubjects(input: {
    schoolId: number;
    termId: number;
    gradeLevelId: number;
    page: number;
    limit: number;
    searchTerm?: string;
    schoolSubjectId?: number;
  }): Promise<{ rows: GradeSchoolSubjectRow[]; totalCount: number }> {
    const params: unknown[] = [input.schoolId, input.termId, input.gradeLevelId];
    const searchSql = input.searchTerm
      ? `AND (subject.code ILIKE $${params.push(`%${escapeLikePattern(input.searchTerm)}%`)} ESCAPE '\\' OR subject.name_th ILIKE $${params.length} ESCAPE '\\')`
      : '';
    const schoolSubjectSql = input.schoolSubjectId
      ? `AND school_subject.id = $${params.push(input.schoolSubjectId)}`
      : '';
    const fromSql = `
      FROM school_subjects school_subject
      JOIN subjects subject ON subject.id = school_subject.subject_id
      JOIN classroom_subjects classroom_subject
        ON classroom_subject.school_subject_id = school_subject.id
       AND classroom_subject.school_id = school_subject.school_id
       AND classroom_subject.offering_status = 'ACTIVE'
       AND classroom_subject.deleted_at IS NULL
      JOIN school_classrooms classroom
        ON classroom.id = classroom_subject.classroom_id
       AND classroom.school_id = school_subject.school_id
       AND classroom.school_term_id = $2
       AND classroom.grade_level_id = $3
       AND classroom.classroom_status = 'ACTIVE'
       AND classroom.deleted_at IS NULL
      JOIN grade_levels grade ON grade.id = classroom.grade_level_id
      WHERE school_subject.school_id = $1
        AND school_subject.subject_status = 'ACTIVE'
        AND school_subject.deleted_at IS NULL
        AND subject.is_active
        AND subject.deleted_at IS NULL
        ${searchSql}
        ${schoolSubjectSql}
    `;
    const count = await queryDataSource<CountRow>(
      this.dataSource,
      `SELECT COUNT(DISTINCT school_subject.id)::int AS total ${fromSql}`,
      params,
    );
    const rows = await queryDataSource<GradeSchoolSubjectRow>(
      this.dataSource,
      `
        SELECT
          school_subject.id::text,
          school_subject.school_id,
          school_subject.subject_id,
          subject.code,
          subject.name_th,
          school_subject.subject_status,
          COUNT(DISTINCT classroom.id)::int AS classroom_count,
          school_subject.created_at,
          school_subject.updated_at,
          grade.id AS grade_level_id,
          grade.label AS grade_label
        ${fromSql}
        GROUP BY school_subject.id, subject.id, grade.id, grade.label
        ORDER BY subject.name_th, subject.code
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, input.limit, (input.page - 1) * input.limit],
    );
    return { rows: rows.rows, totalCount: Number(count.rows[0]?.total ?? 0) };
  }

  async listGradeSubjectClassrooms(input: {
    schoolSubjectIds: number[];
    schoolId: number;
    termId: number;
    gradeLevelId: number;
  }): Promise<GradeSubjectClassroomRow[]> {
    if (input.schoolSubjectIds.length === 0) return [];
    const result = await queryDataSource<GradeSubjectClassroomRow>(
      this.dataSource,
      `
        SELECT
          classroom_subject.school_subject_id::text,
          classroom_subject.id::text AS classroom_subject_id,
          classroom.id::text AS classroom_id,
          grade.label || '/' || classroom.room_code AS classroom_label,
          -- Teachers ride along with the offering they belong to: the screen
          -- lists classrooms per subject, and a second round trip per classroom
          -- would be one query per row on a grade with a dozen rooms.
          COALESCE(teachers.assignments, '[]'::json) AS teachers
        FROM classroom_subjects classroom_subject
        JOIN school_classrooms classroom
          ON classroom.id = classroom_subject.classroom_id
         AND classroom.school_id = classroom_subject.school_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        LEFT JOIN LATERAL (
          SELECT json_agg(
            json_build_object(
              'membershipId', assignment.teacher_membership_id::text,
              'teacherId', teacher.id::text,
              'name', TRIM(teacher.first_name || ' ' || teacher.last_name),
              -- The version stamp comes along so a replaced photo busts the
              -- cache on its own, the same shape every other photo url uses.
              'photoUpdatedAt', CASE
                WHEN teacher.photo_storage_key IS NOT NULL THEN teacher.updated_at
                ELSE NULL
              END
            )
            ORDER BY teacher.first_name, teacher.last_name, assignment.id
          ) AS assignments
          FROM classroom_subject_teachers assignment
          JOIN school_teacher_memberships membership
            ON membership.id = assignment.teacher_membership_id
          JOIN teachers teacher ON teacher.id = membership.teacher_id
          WHERE assignment.classroom_subject_id = classroom_subject.id
            AND assignment.assignment_status = 'ACTIVE'
            AND assignment.deleted_at IS NULL
        ) teachers ON TRUE
        WHERE classroom_subject.school_subject_id = ANY($1::bigint[])
          AND classroom_subject.school_id = $2
          AND classroom.school_term_id = $3
          AND classroom.grade_level_id = $4
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
          AND classroom_subject.offering_status = 'ACTIVE'
          AND classroom_subject.deleted_at IS NULL
        ORDER BY classroom.room_code, classroom.id
      `,
      [input.schoolSubjectIds, input.schoolId, input.termId, input.gradeLevelId],
    );
    return result.rows;
  }

  async assertGradeClassrooms(
    input: {
      classroomIds: number[];
      schoolId: number;
      termId: number;
      gradeLevelId: number;
    },
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `
        WITH locked_classrooms AS (
          SELECT classroom.id
          FROM school_classrooms classroom
          WHERE classroom.id = ANY($1::bigint[])
            AND classroom.school_id = $2
            AND classroom.school_term_id = $3
            AND classroom.grade_level_id = $4
            AND classroom.classroom_status = 'ACTIVE'
            AND classroom.deleted_at IS NULL
          FOR SHARE
        )
        SELECT COUNT(*)::int AS total FROM locked_classrooms
      `,
      [input.classroomIds, input.schoolId, input.termId, input.gradeLevelId],
    )) as CountRow[];
    return Number(rows[0]?.total ?? 0) === input.classroomIds.length;
  }

  async updateSubjectName(
    subjectId: number,
    nameTh: string,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      `UPDATE subjects SET name_th = $2, updated_by = $3 WHERE id = $1 AND deleted_at IS NULL`,
      [subjectId, nameTh, actorId],
    );
  }

  async isSubjectSharedWithAnotherSchool(
    subjectId: number,
    schoolId: number,
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SELECT EXISTS (
         SELECT 1
         FROM school_subjects
         WHERE subject_id = $1
           AND school_id <> $2
           AND deleted_at IS NULL
       ) AS shared`,
      [subjectId, schoolId],
    )) as Array<{ shared: boolean }>;
    return rows[0]?.shared === true;
  }

  async replaceGradeSubjectClassrooms(
    input: {
      schoolSubjectId: number;
      schoolId: number;
      termId: number;
      gradeLevelId: number;
      classroomIds: number[];
      actorId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      `
        UPDATE classroom_subjects classroom_subject
        SET offering_status = 'INACTIVE', updated_by = $6
        FROM school_classrooms classroom
        WHERE classroom.id = classroom_subject.classroom_id
          AND classroom_subject.school_subject_id = $1
          AND classroom_subject.school_id = $2
          AND classroom.school_term_id = $3
          AND classroom.grade_level_id = $4
          AND classroom_subject.offering_status = 'ACTIVE'
          AND classroom_subject.deleted_at IS NULL
          AND NOT (classroom.id = ANY($5::bigint[]))
      `,
      [
        input.schoolSubjectId,
        input.schoolId,
        input.termId,
        input.gradeLevelId,
        input.classroomIds,
        input.actorId,
      ],
    );
    await queryRunner.query(
      `
        INSERT INTO classroom_subjects (
          school_id, classroom_id, school_subject_id, offering_status, created_by, updated_by
        )
        SELECT $2::bigint, classroom_id, $1::bigint, 'ACTIVE', $4::bigint, $4::bigint
        FROM unnest($3::bigint[]) classroom_id
        ON CONFLICT (classroom_id, school_subject_id) WHERE deleted_at IS NULL
        DO UPDATE SET offering_status = 'ACTIVE', updated_by = EXCLUDED.updated_by
      `,
      [input.schoolSubjectId, input.schoolId, input.classroomIds, input.actorId],
    );
  }

  async removeGradeSubjectClassrooms(
    input: {
      schoolSubjectId: number;
      schoolId: number;
      termId: number;
      gradeLevelId: number;
      actorId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      `
        UPDATE classroom_subjects classroom_subject
        SET offering_status = 'INACTIVE', updated_by = $5
        FROM school_classrooms classroom
        WHERE classroom.id = classroom_subject.classroom_id
          AND classroom_subject.school_subject_id = $1
          AND classroom_subject.school_id = $2
          AND classroom.school_term_id = $3
          AND classroom.grade_level_id = $4
          AND classroom_subject.offering_status = 'ACTIVE'
          AND classroom_subject.deleted_at IS NULL
      `,
      [input.schoolSubjectId, input.schoolId, input.termId, input.gradeLevelId, input.actorId],
    );
  }

  /**
   * Offerings a teacher change may touch, checked against the actor's school
   * before anything is written — an id from the request body is otherwise a
   * free choice of any classroom in the country.
   */
  async findClassroomSubjectsForTeacherUpdate(input: {
    classroomSubjectIds: number[];
    schoolId: number;
  }): Promise<Array<{ id: string; classroom_id: string; school_subject_id: string }>> {
    if (input.classroomSubjectIds.length === 0) return [];
    const result = await queryDataSource<{
      id: string;
      classroom_id: string;
      school_subject_id: string;
    }>(
      this.dataSource,
      `
        SELECT id::text, classroom_id::text, school_subject_id::text
        FROM classroom_subjects
        WHERE id = ANY($1::bigint[])
          AND school_id = $2
          AND offering_status = 'ACTIVE'
          AND deleted_at IS NULL
      `,
      [input.classroomSubjectIds, input.schoolId],
    );
    return result.rows;
  }

  /** Memberships that are actually this school's, for the same reason. */
  async filterSchoolTeacherMemberships(input: {
    membershipIds: number[];
    schoolId: number;
  }): Promise<number[]> {
    if (input.membershipIds.length === 0) return [];
    const result = await queryDataSource<{ id: string }>(
      this.dataSource,
      `
        SELECT id::text
        FROM school_teacher_memberships
        WHERE id = ANY($1::bigint[])
          AND school_id = $2
          AND membership_status = 'ACTIVE'
          AND deleted_at IS NULL
      `,
      [input.membershipIds, input.schoolId],
    );
    return result.rows.map((row) => Number(row.id));
  }

  /**
   * Makes the given teachers the whole set for these offerings.
   *
   * Deactivate-then-reactivate rather than delete-then-insert so an assignment
   * that comes back keeps its audit row and its id; the partial unique index is
   * on live rows only, so a soft-deleted one would never collide anyway.
   */
  async replaceClassroomSubjectTeachers(
    input: {
      classroomSubjects: Array<{ id: number; classroomId: number }>;
      schoolId: number;
      teacherMembershipIds: number[];
      actorId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<void> {
    const offeringIds = input.classroomSubjects.map((offering) => offering.id);
    if (offeringIds.length === 0) return;
    await queryRunner.query(
      `
        UPDATE classroom_subject_teachers
        SET assignment_status = 'INACTIVE', updated_by = $3
        WHERE classroom_subject_id = ANY($1::bigint[])
          AND NOT (teacher_membership_id = ANY($2::bigint[]))
          AND assignment_status = 'ACTIVE'
          AND deleted_at IS NULL
      `,
      [offeringIds, input.teacherMembershipIds, input.actorId],
    );
    if (input.teacherMembershipIds.length === 0) return;
    await queryRunner.query(
      `
        INSERT INTO classroom_subject_teachers (
          school_id, classroom_id, classroom_subject_id, teacher_membership_id,
          assignment_status, created_by, updated_by
        )
        SELECT $2::integer, offering.classroom_id, offering.id, membership_id,
               'ACTIVE', $4::integer, $4::integer
        FROM unnest($1::bigint[], $5::bigint[]) AS offering(id, classroom_id)
        CROSS JOIN unnest($3::bigint[]) AS membership_id
        ON CONFLICT (classroom_subject_id, teacher_membership_id) WHERE deleted_at IS NULL
        DO UPDATE SET assignment_status = 'ACTIVE', updated_by = EXCLUDED.updated_by
      `,
      [
        offeringIds,
        input.schoolId,
        input.teacherMembershipIds,
        input.actorId,
        input.classroomSubjects.map((offering) => offering.classroomId),
      ],
    );
  }

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
}
