import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { ATTENDANCE_STATUS_CODE } from '../attendance/attendance-status';
import { escapeLikePattern } from '../common/utils/helpers';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import { HOMEROOM_SUBJECT_CODE } from './homeroom-subject.constants';
import type {
  ClassroomRosterRow,
  ClassroomDailyAttendanceRow,
  ClassroomStudentAttendanceDayRow,
  ClassroomStudentAttendanceSummaryRow,
  ClassroomTeacherAssignmentRow,
  SchoolClassroomOptionRow,
  SchoolClassroomRow,
  SchoolClassroomSummaryRow,
  SchoolTeacherCandidateRow,
  SchoolTeacherMembershipRow,
  ScopedSchoolRow,
  StructureStatus,
  TeacherAssignmentKind,
} from './school-structure.types';
import type { ClassroomStudentProblemCategoryOption } from './classroom-student-comment.constants';

/**
 * Free-text match on an enrolled student (school-owned number or full name).
 * Pair with a parameter built through {@link escapeLikePattern} so `%`/`_`
 * typed by the user match literally instead of acting as wildcards.
 */
function enrolledStudentSearchCondition(paramIndex: number): string {
  return `(
    COALESCE(enrollment.student_number, '') ILIKE $${paramIndex} ESCAPE '\\'
    OR CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec")
         ILIKE $${paramIndex} ESCAPE '\\'
  )`;
}

/** Free-text match on the person who recorded an attendance row (login or full name). */
function recorderSearchCondition(paramIndex: number): string {
  return `(
    COALESCE(attendance."RecordedBy", '') ILIKE $${paramIndex} ESCAPE '\\'
    OR EXISTS (
      SELECT 1 FROM teachers recorder_teacher_search
      WHERE recorder_teacher_search.id = attendance.recorded_by_teacher_id
        AND CONCAT_WS(' ', recorder_teacher_search.first_name, recorder_teacher_search.last_name)
              ILIKE $${paramIndex} ESCAPE '\\'
    )
    OR EXISTS (
      SELECT 1 FROM users recorder_user_search
      WHERE recorder_user_search.username = attendance."RecordedBy"
        AND CONCAT_WS(' ', recorder_user_search."FirstName", recorder_user_search."LastName")
              ILIKE $${paramIndex} ESCAPE '\\'
    )
  )`;
}

@Injectable()
export class SchoolStructureRepository {
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

  async listScopedSchools(scope: DataScope): Promise<ScopedSchoolRow[]> {
    const scopeQuery = buildDataScopeQuery(
      scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
      },
      1,
    );
    const result = await queryDataSource<ScopedSchoolRow>(
      this.dataSource,
      `
        SELECT school.id, school.name, school.province, school.district, school.sub_district
        FROM schools school
        WHERE school.school_status = 'ACTIVE'
          AND ${scopeQuery.sql || 'TRUE'}
        ORDER BY school.name, school.id
      `,
      scopeQuery.params,
    );
    return result.rows;
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

  async findTermSchoolId(termId: number, queryRunner?: QueryRunner): Promise<number | null> {
    const sql = `
      SELECT school_id
      FROM school_terms
      WHERE id = $1 AND deleted_at IS NULL
      ${queryRunner ? 'FOR UPDATE' : ''}
    `;
    const result = queryRunner
      ? await createSqlQueryExecutor(queryRunner).query<{ school_id: number }>(sql, [termId])
      : await queryDataSource<{ school_id: number }>(this.dataSource, sql, [termId]);
    return result.rows[0]?.school_id ?? null;
  }

  async listClassrooms(input: {
    schoolId: number;
    userId: number | null;
    termId?: number;
    gradeLevelId?: number;
    classroomId?: number;
    search?: string;
    sortBy: 'room' | 'grade' | 'students' | 'homeroomTeacher';
    sortDirection: 'asc' | 'desc';
    page: number;
    limit: number;
  }): Promise<{
    rows: SchoolClassroomRow[];
    totalCount: number;
    teacherCount: number;
    studentCount: number;
  }> {
    const params: unknown[] = [input.schoolId];
    const conditions = ['classroom.school_id = $1', 'classroom.deleted_at IS NULL'];
    if (input.termId) {
      params.push(input.termId);
      conditions.push(`classroom.school_term_id = $${params.length}`);
    }
    if (input.gradeLevelId) {
      params.push(input.gradeLevelId);
      conditions.push(`classroom.grade_level_id = $${params.length}`);
    }
    if (input.classroomId) {
      params.push(input.classroomId);
      conditions.push(`classroom.id = $${params.length}`);
    }
    if (input.search) {
      params.push(`%${escapeLikePattern(input.search)}%`);
      const searchParam = `$${params.length}`;
      conditions.push(`(
        classroom.room_code ILIKE ${searchParam} ESCAPE '\\'
        OR COALESCE(classroom.room_name, '') ILIKE ${searchParam} ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM grade_levels search_grade
          WHERE search_grade.id = classroom.grade_level_id
            AND search_grade.label ILIKE ${searchParam} ESCAPE '\\'
        )
        OR EXISTS (
          SELECT 1
          FROM classroom_teacher_assignments search_assignment
          JOIN school_teacher_memberships search_membership
            ON search_membership.id = search_assignment.teacher_membership_id
           AND search_membership.membership_status = 'ACTIVE'
           AND search_membership.deleted_at IS NULL
          JOIN teachers search_teacher_person
            ON search_teacher_person.id = search_membership.teacher_id
           AND search_teacher_person.deleted_at IS NULL
          WHERE search_assignment.classroom_id = classroom.id
            AND search_assignment.assignment_kind = 'HOMEROOM'
            AND search_assignment.assignment_status = 'ACTIVE'
            AND search_assignment.deleted_at IS NULL
            AND CONCAT_WS(' ', search_teacher_person.first_name, search_teacher_person.last_name)
                ILIKE ${searchParam} ESCAPE '\\'
        )
      )`);
    }
    const orderBy =
      input.sortBy === 'room'
        ? 'classroom.room_code'
        : input.sortBy === 'students'
          ? 'student_count'
          : input.sortBy === 'homeroomTeacher'
            ? // Rooms with no homeroom teacher sort last in both directions —
              // "ยังไม่กำหนด" is an empty cell, not a name at either end.
              'homeroom.homeroom_teacher_name COLLATE "th-x-icu" NULLS LAST'
            : 'classroom.grade_level_id';
    const direction = input.sortDirection === 'desc' ? 'DESC' : 'ASC';
    const offset = (input.page - 1) * input.limit;
    const summaryResult = await queryDataSource<SchoolClassroomSummaryRow>(
      this.dataSource,
      `
        WITH filtered_classrooms AS (
          SELECT classroom.id, classroom.school_id
          FROM school_classrooms classroom
          WHERE ${conditions.join(' AND ')}
        )
        SELECT
          (SELECT COUNT(*)::int FROM filtered_classrooms) AS classroom_count,
          (
            SELECT COUNT(DISTINCT membership.teacher_id)::int
            FROM filtered_classrooms classroom
            JOIN classroom_teacher_assignments assignment
              ON assignment.classroom_id = classroom.id
             AND assignment.school_id = classroom.school_id
             AND assignment.assignment_status = 'ACTIVE'
             AND assignment.deleted_at IS NULL
            JOIN school_teacher_memberships membership
              ON membership.id = assignment.teacher_membership_id
             AND membership.school_id = assignment.school_id
             AND membership.membership_status = 'ACTIVE'
             AND membership.deleted_at IS NULL
            JOIN teachers teacher
              ON teacher.id = membership.teacher_id
             AND teacher.teacher_status = 'ACTIVE'
             AND teacher.deleted_at IS NULL
          ) AS teacher_count,
          (
            SELECT COUNT(DISTINCT enrollment.student_uuid)::int
            FROM filtered_classrooms classroom
            JOIN student_term enrollment
              ON enrollment.classroom_id = classroom.id
             AND enrollment.deleted_at IS NULL
          ) AS student_count
      `,
      params,
    );
    const favoriteUserParam = params.length + 1;
    const listParams = [...params, input.userId, input.limit, offset];
    const result = await queryDataSource<SchoolClassroomRow>(
      this.dataSource,
      `
        SELECT
          classroom.id::text,
          classroom.school_term_id::text,
          classroom.school_id,
          term.academic_year,
          term.semester,
          classroom.grade_level_id,
          grade.label AS grade_label,
          classroom.legacy_room_number,
          classroom.room_code,
          classroom.room_name,
          classroom.classroom_status,
          classroom.card_cover_color,
          classroom.cover_image_storage_key,
          classroom.cover_image_position_x,
          classroom.cover_image_position_y,
          classroom.cover_image_scale,
          classroom.updated_at,
          (favorite.user_id IS NOT NULL) AS is_favorite,
          favorite.created_at AS favorited_at,
          homeroom.homeroom_teacher_name,
          COUNT(enrollment.student_uuid)::int AS student_count
        FROM school_classrooms classroom
        JOIN school_terms term ON term.id = classroom.school_term_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        LEFT JOIN user_classroom_favorites favorite
          ON favorite.classroom_id = classroom.id
         AND favorite.user_id = $${favoriteUserParam}
        LEFT JOIN student_term enrollment
          ON enrollment.classroom_id = classroom.id AND enrollment.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT TRIM(teacher_person.first_name || ' ' || teacher_person.last_name)
                 AS homeroom_teacher_name
          FROM classroom_teacher_assignments assignment
          JOIN school_teacher_memberships membership
            ON membership.id = assignment.teacher_membership_id
           AND membership.school_id = assignment.school_id
           AND membership.membership_status = 'ACTIVE'
           AND membership.deleted_at IS NULL
          JOIN teachers teacher_person ON teacher_person.id = membership.teacher_id
          AND teacher_person.deleted_at IS NULL
          WHERE assignment.classroom_id = classroom.id
            AND assignment.school_id = classroom.school_id
            AND assignment.assignment_kind = 'HOMEROOM'
            AND assignment.assignment_status = 'ACTIVE'
            AND assignment.deleted_at IS NULL
          ORDER BY assignment.id DESC
          LIMIT 1
        ) homeroom ON TRUE
        WHERE ${conditions.join(' AND ')}
        GROUP BY classroom.id, term.academic_year, term.semester, grade.label,
                 favorite.user_id, favorite.created_at,
                 homeroom.homeroom_teacher_name
        ORDER BY (favorite.user_id IS NOT NULL) DESC, favorite.created_at DESC NULLS LAST,
                 ${orderBy} ${direction}, classroom.room_code ${direction}, classroom.id ${direction}
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
      `,
      listParams,
    );
    const summary = summaryResult.rows[0];
    return {
      rows: result.rows,
      totalCount: Number(summary?.classroom_count ?? 0),
      teacherCount: Number(summary?.teacher_count ?? 0),
      studentCount: Number(summary?.student_count ?? 0),
    };
  }

  async listClassroomOptions(
    schoolId: number,
    termId?: number,
    gradeLevelId?: number,
  ): Promise<SchoolClassroomOptionRow[]> {
    const params: unknown[] = [schoolId];
    const conditions = ['school_id = $1', `classroom_status = 'ACTIVE'`, 'deleted_at IS NULL'];
    if (termId) {
      params.push(termId);
      conditions.push(`school_term_id = $${params.length}`);
    }
    if (gradeLevelId) {
      params.push(gradeLevelId);
      conditions.push(`grade_level_id = $${params.length}`);
    }
    const result = await queryDataSource<SchoolClassroomOptionRow>(
      this.dataSource,
      `
        SELECT classroom.id::text, classroom.grade_level_id, grade.label AS grade_label,
               classroom.room_code, classroom.room_name
        FROM school_classrooms classroom
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        WHERE ${conditions.map((condition) => `classroom.${condition}`).join(' AND ')}
        ORDER BY classroom.grade_level_id, classroom.room_code, classroom.id
      `,
      params,
    );
    return result.rows;
  }

  /**
   * `favoriteUserId` resolves the star for a specific actor; omit it (writes,
   * `FOR UPDATE` reads) and the row reports no favorite rather than guessing.
   */
  async findClassroomById(
    classroomId: number,
    queryRunner?: QueryRunner,
    favoriteUserId?: number | null,
  ): Promise<SchoolClassroomRow | null> {
    const sql = `
      SELECT
        classroom.id::text,
        classroom.school_term_id::text,
        classroom.school_id,
        term.academic_year,
        term.semester,
        classroom.grade_level_id,
        grade.label AS grade_label,
        classroom.legacy_room_number,
        classroom.room_code,
        classroom.room_name,
        classroom.classroom_status,
        classroom.card_cover_color,
        classroom.cover_image_storage_key,
        classroom.cover_image_position_x,
        classroom.cover_image_position_y,
        classroom.cover_image_scale,
        classroom.updated_at,
        (favorite.user_id IS NOT NULL) AS is_favorite,
        favorite.created_at AS favorited_at,
        (
          SELECT TRIM(teacher_person.first_name || ' ' || teacher_person.last_name)
          FROM classroom_teacher_assignments assignment
          JOIN school_teacher_memberships membership
            ON membership.id = assignment.teacher_membership_id
           AND membership.school_id = assignment.school_id
           AND membership.membership_status = 'ACTIVE'
           AND membership.deleted_at IS NULL
          JOIN teachers teacher_person ON teacher_person.id = membership.teacher_id
          AND teacher_person.deleted_at IS NULL
          WHERE assignment.classroom_id = classroom.id
            AND assignment.school_id = classroom.school_id
            AND assignment.assignment_kind = 'HOMEROOM'
            AND assignment.assignment_status = 'ACTIVE'
            AND assignment.deleted_at IS NULL
          ORDER BY assignment.id DESC
          LIMIT 1
        ) AS homeroom_teacher_name,
        (SELECT COUNT(*)::int FROM student_term enrollment
          WHERE enrollment.classroom_id = classroom.id AND enrollment.deleted_at IS NULL
        ) AS student_count
      FROM school_classrooms classroom
      JOIN school_terms term ON term.id = classroom.school_term_id
      JOIN grade_levels grade ON grade.id = classroom.grade_level_id
      LEFT JOIN user_classroom_favorites favorite
        ON favorite.classroom_id = classroom.id
       AND favorite.user_id = $2
      WHERE classroom.id = $1 AND classroom.deleted_at IS NULL
      ${queryRunner ? 'FOR UPDATE OF classroom' : ''}
    `;
    const params = [classroomId, favoriteUserId ?? null];
    const result = queryRunner
      ? await createSqlQueryExecutor(queryRunner).query<SchoolClassroomRow>(sql, params)
      : await queryDataSource<SchoolClassroomRow>(this.dataSource, sql, params);
    return result.rows[0] ?? null;
  }

  async createClassroom(
    input: {
      schoolTermId: number;
      schoolId: number;
      gradeLevelId: number;
      roomCode: string;
      roomNumber: number;
      roomName: string | null;
      actorId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<SchoolClassroomRow> {
    const result = await createSqlQueryExecutor(queryRunner).query<{ id: string }>(
      `
        INSERT INTO school_classrooms (
          school_term_id, school_id, grade_level_id, legacy_room_number,
          room_code, room_name, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        RETURNING id::text
      `,
      [
        input.schoolTermId,
        input.schoolId,
        input.gradeLevelId,
        input.roomNumber,
        input.roomCode,
        input.roomName,
        input.actorId,
      ],
    );
    const classroomId = result.rows[0]?.id;
    if (!classroomId) {
      throw new Error('CREATE_CLASSROOM_FAILED');
    }
    const homeroom = await createSqlQueryExecutor(queryRunner).query<{ id: string }>(
      `
        WITH homeroom_subject AS (
          SELECT id
          FROM subjects
          WHERE code = $1
            AND is_active
            AND deleted_at IS NULL
        ), school_offering AS (
          INSERT INTO school_subjects (
            school_id,
            subject_id,
            subject_status,
            created_by,
            updated_by
          )
          SELECT $2, subject.id, 'ACTIVE', $3, $3
          FROM homeroom_subject subject
          ON CONFLICT (school_id, subject_id) WHERE deleted_at IS NULL
          DO UPDATE SET
            subject_status = 'ACTIVE',
            deleted_at = NULL,
            deleted_by = NULL,
            updated_by = EXCLUDED.updated_by
          RETURNING id
        )
        INSERT INTO classroom_subjects (
          school_id,
          classroom_id,
          school_subject_id,
          offering_status,
          created_by,
          updated_by
        )
        SELECT $2, $4, school_offering.id, 'ACTIVE', $3, $3
        FROM school_offering
        ON CONFLICT (classroom_id, school_subject_id) WHERE deleted_at IS NULL
        DO UPDATE SET
          offering_status = 'ACTIVE',
          deleted_at = NULL,
          deleted_by = NULL,
          updated_by = EXCLUDED.updated_by
        RETURNING id::text
      `,
      [HOMEROOM_SUBJECT_CODE, input.schoolId, input.actorId, classroomId],
    );
    if (homeroom.rows.length !== 1) {
      throw new Error('HOMEROOM_SUBJECT_UNAVAILABLE');
    }
    return (await this.findClassroomById(Number(classroomId), queryRunner))!;
  }

  async updateClassroom(
    classroomId: number,
    changes: {
      gradeLevelId?: number;
      roomCode?: string;
      roomNumber?: number;
      roomName?: string | null;
      classroomStatus?: StructureStatus;
    },
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<SchoolClassroomRow> {
    await queryRunner.query(
      `
        UPDATE school_classrooms
        SET grade_level_id = COALESCE($2, grade_level_id),
            room_code = COALESCE($3, room_code),
            legacy_room_number = COALESCE($4, legacy_room_number),
            room_name = CASE WHEN $5 THEN $6 ELSE room_name END,
            classroom_status = COALESCE($7, classroom_status),
            updated_by = $8
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [
        classroomId,
        changes.gradeLevelId ?? null,
        changes.roomCode ?? null,
        changes.roomNumber ?? null,
        changes.roomName !== undefined,
        changes.roomName ?? null,
        changes.classroomStatus ?? null,
        actorId,
      ],
    );
    return (await this.findClassroomById(classroomId, queryRunner))!;
  }

  /** Live usage counts that gate destructive classroom changes. */
  async getClassroomUsage(
    classroomId: number,
    queryRunner?: QueryRunner,
  ): Promise<{ studentCount: number; assignmentCount: number }> {
    const sql = `
        SELECT
          (
            SELECT COUNT(*)::int FROM student_term enrollment
            WHERE enrollment.classroom_id = $1 AND enrollment.deleted_at IS NULL
          ) AS student_count,
          (
            SELECT COUNT(*)::int FROM classroom_teacher_assignments assignment
            WHERE assignment.classroom_id = $1
              AND assignment.assignment_status = 'ACTIVE'
              AND assignment.deleted_at IS NULL
          ) AS assignment_count
      `;
    const result = queryRunner
      ? await createSqlQueryExecutor(queryRunner).query<{
          student_count: number;
          assignment_count: number;
        }>(sql, [classroomId])
      : await queryDataSource<{ student_count: number; assignment_count: number }>(
          this.dataSource,
          sql,
          [classroomId],
        );
    return {
      studentCount: Number(result.rows[0]?.student_count ?? 0),
      assignmentCount: Number(result.rows[0]?.assignment_count ?? 0),
    };
  }

  async softDeleteClassroom(
    classroomId: number,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      `
        UPDATE school_classrooms
        SET deleted_at = now(), deleted_by = $2
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [classroomId, actorId],
    );
  }

  async setClassroomFavorite(
    userId: number,
    classroomId: number,
    isFavorite: boolean,
  ): Promise<void> {
    if (isFavorite) {
      await queryDataSource(
        this.dataSource,
        `
          INSERT INTO user_classroom_favorites (user_id, classroom_id, created_at)
          VALUES ($1, $2, now())
          ON CONFLICT (user_id, classroom_id)
          DO UPDATE SET created_at = EXCLUDED.created_at
        `,
        [userId, classroomId],
      );
      return;
    }
    await queryDataSource(
      this.dataSource,
      `DELETE FROM user_classroom_favorites WHERE user_id = $1 AND classroom_id = $2`,
      [userId, classroomId],
    );
  }

  async updateClassroomPresentation(
    classroomId: number,
    presentation: {
      cardCoverColor: string;
      coverImageStorageKey: string | null;
      coverImagePositionX: number;
      coverImagePositionY: number;
      coverImageScale: number;
    },
    actorId: number,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await createSqlQueryExecutor(queryRunner).query(
      `
        UPDATE school_classrooms
        SET card_cover_color = $2,
            cover_image_storage_key = $3,
            cover_image_position_x = $4,
            cover_image_position_y = $5,
            cover_image_scale = $6,
            updated_by = $7
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [
        classroomId,
        presentation.cardCoverColor,
        presentation.coverImageStorageKey,
        presentation.coverImagePositionX,
        presentation.coverImagePositionY,
        presentation.coverImageScale,
        actorId,
      ],
    );
  }

  async listTeachers(input: {
    schoolId: number;
    termId?: number;
    gradeLevelId?: number;
    classroomId?: number;
    assignedToFilteredClassrooms?: boolean;
    sortBy: 'name' | 'status';
    sortDirection: 'asc' | 'desc';
    page: number;
    limit: number;
  }): Promise<{ rows: SchoolTeacherMembershipRow[]; totalCount: number; activeCount: number }> {
    if (!input.assignedToFilteredClassrooms) {
      const direction = input.sortDirection === 'desc' ? 'DESC' : 'ASC';
      const orderBy = input.sortBy === 'status' ? 'membership.membership_status' : 'display_name';
      const offset = (input.page - 1) * input.limit;
      const countResult = await queryDataSource<{ total_count: number; active_count: number }>(
        this.dataSource,
        `
          SELECT
            COUNT(*)::int AS total_count,
            COUNT(*) FILTER (WHERE membership_status = 'ACTIVE')::int AS active_count
          FROM school_teacher_memberships
          WHERE school_id = $1 AND deleted_at IS NULL
        `,
        [input.schoolId],
      );
      const result = await queryDataSource<SchoolTeacherMembershipRow>(
        this.dataSource,
        `
          SELECT
            membership.id::text,
            membership.school_id,
            membership.teacher_id::text AS teacher_id,
            TRIM(teacher_person.first_name || ' ' || teacher_person.last_name) AS display_name,
            membership.membership_status,
            membership.started_on::text,
            membership.ended_on::text
          FROM school_teacher_memberships membership
          JOIN teachers teacher_person ON teacher_person.id = membership.teacher_id
          AND teacher_person.deleted_at IS NULL
          WHERE membership.school_id = $1 AND membership.deleted_at IS NULL
          ORDER BY ${orderBy} ${direction}, membership.id ${direction}
          LIMIT $2 OFFSET $3
        `,
        [input.schoolId, input.limit, offset],
      );
      return {
        rows: result.rows,
        totalCount: countResult.rows[0]?.total_count ?? 0,
        activeCount: countResult.rows[0]?.active_count ?? 0,
      };
    }
    const params: unknown[] = [input.schoolId];
    const classroomConditions = ['classroom.school_id = $1', 'classroom.deleted_at IS NULL'];
    if (input.termId) {
      params.push(input.termId);
      classroomConditions.push(`classroom.school_term_id = $${params.length}`);
    }
    if (input.gradeLevelId) {
      params.push(input.gradeLevelId);
      classroomConditions.push(`classroom.grade_level_id = $${params.length}`);
    }
    if (input.classroomId) {
      params.push(input.classroomId);
      classroomConditions.push(`classroom.id = $${params.length}`);
    }
    const filteredMembershipsSql = `
      SELECT DISTINCT ON (membership.teacher_id) membership.id
      FROM school_teacher_memberships membership
      JOIN teachers teacher_person
        ON teacher_person.id = membership.teacher_id
       AND teacher_person.teacher_status = 'ACTIVE'
       AND teacher_person.deleted_at IS NULL
      JOIN classroom_teacher_assignments assignment
        ON assignment.teacher_membership_id = membership.id
       AND assignment.school_id = membership.school_id
       AND assignment.assignment_status = 'ACTIVE'
       AND assignment.deleted_at IS NULL
      JOIN school_classrooms classroom
        ON classroom.id = assignment.classroom_id
       AND classroom.school_id = assignment.school_id
      WHERE membership.school_id = $1
        AND membership.membership_status = 'ACTIVE'
        AND membership.deleted_at IS NULL
        AND ${classroomConditions.join(' AND ')}
      ORDER BY membership.teacher_id, membership.id
    `;
    const direction = input.sortDirection === 'desc' ? 'DESC' : 'ASC';
    const orderBy = input.sortBy === 'status' ? 'membership.membership_status' : 'display_name';
    const offset = (input.page - 1) * input.limit;
    const countResult = await queryDataSource<{ total_count: number; active_count: number }>(
      this.dataSource,
      `
        WITH filtered_memberships AS (${filteredMembershipsSql})
        SELECT COUNT(*)::int AS total_count, COUNT(*)::int AS active_count
        FROM filtered_memberships
      `,
      params,
    );
    const result = await queryDataSource<SchoolTeacherMembershipRow>(
      this.dataSource,
      `
        WITH filtered_memberships AS (${filteredMembershipsSql})
        SELECT
          membership.id::text,
          membership.school_id,
          membership.teacher_id::text AS teacher_id,
          TRIM(teacher_person.first_name || ' ' || teacher_person.last_name) AS display_name,
          membership.membership_status,
          membership.started_on::text,
          membership.ended_on::text
        FROM filtered_memberships filtered
        JOIN school_teacher_memberships membership ON membership.id = filtered.id
        JOIN teachers teacher_person ON teacher_person.id = membership.teacher_id
          AND teacher_person.deleted_at IS NULL
        ORDER BY ${orderBy} ${direction}, membership.id ${direction}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, input.limit, offset],
    );
    return {
      rows: result.rows,
      totalCount: countResult.rows[0]?.total_count ?? 0,
      activeCount: countResult.rows[0]?.active_count ?? 0,
    };
  }

  async listTeacherCandidates(
    schoolId: number,
    searchTerm?: string,
  ): Promise<SchoolTeacherCandidateRow[]> {
    const params: unknown[] = [schoolId];
    const search = searchTerm?.trim();
    const searchClause = search
      ? `AND (
          teacher_person.first_name ILIKE $${params.push(`%${search}%`)}
          OR teacher_person.last_name ILIKE $${params.length}
        )`
      : '';
    const result = await queryDataSource<SchoolTeacherCandidateRow>(
      this.dataSource,
      `
        SELECT
          teacher_person.id::text,
          TRIM(teacher_person.first_name || ' ' || teacher_person.last_name) AS display_name
        FROM teachers teacher_person
        WHERE teacher_person.teacher_status = 'ACTIVE'
          AND teacher_person.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM school_teacher_memberships membership
            WHERE membership.school_id = $1::int
              AND membership.teacher_id = teacher_person.id
              AND membership.membership_status = 'ACTIVE'
              AND membership.deleted_at IS NULL
          )
          ${searchClause}
        ORDER BY display_name, teacher_person.id
        LIMIT 100
      `,
      params,
    );
    return result.rows;
  }

  async listTeacherOptions(
    schoolId: number,
    searchTerm?: string,
  ): Promise<SchoolTeacherMembershipRow[]> {
    const params: unknown[] = [schoolId];
    const search = searchTerm?.trim();
    const searchClause = search
      ? `AND (
          teacher_person.first_name ILIKE $${params.push(`%${search}%`)}
          OR teacher_person.last_name ILIKE $${params.length}
        )`
      : '';
    const result = await queryDataSource<SchoolTeacherMembershipRow>(
      this.dataSource,
      `
        SELECT
          membership.id::text,
          membership.school_id,
          membership.teacher_id::text AS teacher_id,
          TRIM(teacher_person.first_name || ' ' || teacher_person.last_name) AS display_name,
          membership.membership_status,
          membership.started_on::text,
          membership.ended_on::text
        FROM school_teacher_memberships membership
        JOIN teachers teacher_person ON teacher_person.id = membership.teacher_id
          AND teacher_person.deleted_at IS NULL
        WHERE membership.school_id = $1
          AND membership.membership_status = 'ACTIVE'
          AND membership.deleted_at IS NULL
          AND teacher_person.teacher_status = 'ACTIVE'
          ${searchClause}
        ORDER BY display_name, membership.id
        LIMIT 100
      `,
      params,
    );
    return result.rows;
  }

  async findMembershipById(
    membershipId: number,
    queryRunner?: QueryRunner,
  ): Promise<SchoolTeacherMembershipRow | null> {
    const sql = `
      SELECT
        membership.id::text,
        membership.school_id,
        membership.teacher_id::text AS teacher_id,
        TRIM(teacher_person.first_name || ' ' || teacher_person.last_name) AS display_name,
        membership.membership_status,
        membership.started_on::text,
        membership.ended_on::text
      FROM school_teacher_memberships membership
      JOIN teachers teacher_person ON teacher_person.id = membership.teacher_id
          AND teacher_person.deleted_at IS NULL
      WHERE membership.id = $1 AND membership.deleted_at IS NULL
      ${queryRunner ? 'FOR UPDATE OF membership' : ''}
    `;
    const result = queryRunner
      ? await createSqlQueryExecutor(queryRunner).query<SchoolTeacherMembershipRow>(sql, [
          membershipId,
        ])
      : await queryDataSource<SchoolTeacherMembershipRow>(this.dataSource, sql, [membershipId]);
    return result.rows[0] ?? null;
  }

  async isTeacherEligible(
    teacherId: number,
    schoolId: number,
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    const result = await createSqlQueryExecutor(queryRunner).query(
      `
        SELECT 1
        FROM teachers teacher_person
        WHERE teacher_person.id = $1
          AND teacher_person.teacher_status = 'ACTIVE'
          AND teacher_person.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM school_teacher_memberships membership
            WHERE membership.school_id = $2::int
              AND membership.teacher_id = teacher_person.id
              AND membership.membership_status = 'ACTIVE'
              AND membership.deleted_at IS NULL
          )
        LIMIT 1
      `,
      [teacherId, schoolId],
    );
    return result.rows.length > 0;
  }

  async createTeacherMembership(
    input: {
      schoolId: number;
      teacherId: number;
      startedOn: string | null;
      actorId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<SchoolTeacherMembershipRow> {
    const result = await createSqlQueryExecutor(queryRunner).query<{ id: string }>(
      `
        INSERT INTO school_teacher_memberships (
          school_id, teacher_id, started_on, created_by, updated_by
        )
        VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $4)
        RETURNING id::text
      `,
      [input.schoolId, input.teacherId, input.startedOn, input.actorId],
    );
    return (await this.findMembershipById(Number(result.rows[0].id), queryRunner))!;
  }

  async updateTeacherMembership(
    membershipId: number,
    status: StructureStatus,
    endedOn: string | null,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<SchoolTeacherMembershipRow> {
    if (status === 'INACTIVE') {
      await queryRunner.query(
        `
          UPDATE classroom_teacher_assignments
          SET assignment_status = 'INACTIVE', updated_by = $2
          WHERE teacher_membership_id = $1
            AND assignment_status = 'ACTIVE'
            AND deleted_at IS NULL
        `,
        [membershipId, actorId],
      );
    }
    await queryRunner.query(
      `
        UPDATE school_teacher_memberships
        SET membership_status = $2,
            ended_on = CASE WHEN $2 = 'INACTIVE' THEN $3::date ELSE NULL END,
            updated_by = $4
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [membershipId, status, endedOn, actorId],
    );
    return (await this.findMembershipById(membershipId, queryRunner))!;
  }

  async listAssignments(classroomId: number): Promise<ClassroomTeacherAssignmentRow[]> {
    const result = await queryDataSource<ClassroomTeacherAssignmentRow>(
      this.dataSource,
      `
        SELECT
          assignment.id::text,
          assignment.school_id,
          assignment.classroom_id::text,
          assignment.teacher_membership_id::text,
          membership.teacher_id::text AS teacher_id,
          TRIM(teacher_person.first_name || ' ' || teacher_person.last_name) AS teacher_name,
          assignment.subject_id,
          subject.code AS subject_code,
          subject.name_th AS subject_name,
          assignment.assignment_kind,
          assignment.assignment_status,
          assignment.effective_on::text,
          assignment.effective_until::text
        FROM classroom_teacher_assignments assignment
        JOIN school_teacher_memberships membership
          ON membership.id = assignment.teacher_membership_id
        JOIN teachers teacher_person ON teacher_person.id = membership.teacher_id
          AND teacher_person.deleted_at IS NULL
        LEFT JOIN subjects subject ON subject.id = assignment.subject_id
        WHERE assignment.classroom_id = $1 AND assignment.deleted_at IS NULL
        ORDER BY assignment.assignment_kind, teacher_name, assignment.id
      `,
      [classroomId],
    );
    return result.rows;
  }

  /**
   * Ends the classroom's current homeroom assignment so a replacement can be
   * inserted. A classroom may hold only one ACTIVE homeroom assignment
   * (`uq_classroom_teacher_assignments_homeroom`); the previous row is kept as
   * history rather than deleted.
   */
  async deactivateHomeroomAssignments(
    classroomId: number,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await createSqlQueryExecutor(queryRunner).query(
      `
        UPDATE classroom_teacher_assignments
        SET assignment_status = 'INACTIVE', updated_by = $2
        WHERE classroom_id = $1
          AND assignment_kind = 'HOMEROOM'
          AND assignment_status = 'ACTIVE'
          AND deleted_at IS NULL
      `,
      [classroomId, actorId],
    );
  }

  async createAssignment(
    input: {
      schoolId: number;
      classroomId: number;
      teacherMembershipId: number;
      subjectId: number | null;
      assignmentKind: TeacherAssignmentKind;
      effectiveOn: string | null;
      effectiveUntil: string | null;
      actorId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<ClassroomTeacherAssignmentRow> {
    const result = await createSqlQueryExecutor(queryRunner).query<{ id: string }>(
      `
        INSERT INTO classroom_teacher_assignments (
          school_id, classroom_id, teacher_membership_id, subject_id,
          assignment_kind, effective_on, effective_until, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $8)
        RETURNING id::text
      `,
      [
        input.schoolId,
        input.classroomId,
        input.teacherMembershipId,
        input.subjectId,
        input.assignmentKind,
        input.effectiveOn,
        input.effectiveUntil,
        input.actorId,
      ],
    );
    const assignments = await createSqlQueryExecutor(
      queryRunner,
    ).query<ClassroomTeacherAssignmentRow>(
      `
        SELECT
          assignment.id::text,
          assignment.school_id,
          assignment.classroom_id::text,
          assignment.teacher_membership_id::text,
          membership.teacher_id::text AS teacher_id,
          TRIM(teacher_person.first_name || ' ' || teacher_person.last_name) AS teacher_name,
          assignment.subject_id,
          subject.code AS subject_code,
          subject.name_th AS subject_name,
          assignment.assignment_kind,
          assignment.assignment_status,
          assignment.effective_on::text,
          assignment.effective_until::text
        FROM classroom_teacher_assignments assignment
        JOIN school_teacher_memberships membership
          ON membership.id = assignment.teacher_membership_id
        JOIN teachers teacher_person ON teacher_person.id = membership.teacher_id
          AND teacher_person.deleted_at IS NULL
        LEFT JOIN subjects subject ON subject.id = assignment.subject_id
        WHERE assignment.id = $1
      `,
      [result.rows[0].id],
    );
    return assignments.rows[0];
  }

  async listRoster(input: {
    search?: string;
    riskTier?: 'HIGH' | 'WATCH' | 'NORMAL';
    schoolId?: number;
    termId?: number;
    gradeLevelId?: number;
    classroomId?: number;
    sortBy: 'studentNumber' | 'name' | 'comment' | 'status';
    sortDirection: 'asc' | 'desc';
    page: number;
    limit: number;
  }): Promise<{ rows: ClassroomRosterRow[]; totalCount: number }> {
    const params: unknown[] = [];
    const conditions = ['enrollment.deleted_at IS NULL', 'classroom.deleted_at IS NULL'];
    if (input.schoolId) {
      params.push(input.schoolId);
      conditions.push(`classroom.school_id = $${params.length}`);
    }
    if (input.termId) {
      params.push(input.termId);
      conditions.push(`classroom.school_term_id = $${params.length}`);
    }
    if (input.gradeLevelId) {
      params.push(input.gradeLevelId);
      conditions.push(`classroom.grade_level_id = $${params.length}`);
    }
    if (input.classroomId) {
      params.push(input.classroomId);
      conditions.push(`classroom.id = $${params.length}`);
    }
    if (input.search) {
      params.push(`%${escapeLikePattern(input.search)}%`);
      conditions.push(enrolledStudentSearchCondition(params.length));
    }
    if (input.riskTier) {
      params.push(input.riskTier);
      conditions.push(`COALESCE(profile.risk_tier, 'NORMAL') = $${params.length}`);
    }
    const direction = input.sortDirection === 'desc' ? 'DESC' : 'ASC';
    const orderBy = {
      studentNumber: `enrollment.student_number`,
      name: `enrollment."FirstName_Onec"`,
      comment: `latest_comment.problem_description`,
      status: `COALESCE(profile.risk_severity, 0)`,
    }[input.sortBy];
    const offset = (input.page - 1) * input.limit;
    const countResult = await queryDataSource<{ total_count: number }>(
      this.dataSource,
      `
        SELECT COUNT(DISTINCT enrollment.student_uuid)::int AS total_count
        FROM student_term enrollment
        JOIN school_classrooms classroom ON classroom.id = enrollment.classroom_id
        LEFT JOIN student_risk_profiles profile ON profile.student_uuid = enrollment.student_uuid
        WHERE ${conditions.join(' AND ')}
      `,
      params,
    );
    const result = await queryDataSource<ClassroomRosterRow>(
      this.dataSource,
      `
        SELECT
          enrollment.student_uuid::text,
          enrollment.student_number,
          person.photo_storage_key,
          person.updated_at AS photo_updated_at,
          profile.risk_tier,
          profile.risk_severity,
          latest_comment.problem_description AS teacher_comment,
          enrollment."FirstName_Onec" AS first_name,
          enrollment."LastName_Onec" AS last_name,
          enrollment.student_status_code,
          status.label_th AS student_status_label,
          status.badge_variant AS student_status_badge_variant,
          classroom.id::text AS classroom_id,
          grade.label AS grade_label,
          classroom.room_code
        FROM student_term enrollment
        JOIN school_classrooms classroom ON classroom.id = enrollment.classroom_id
        LEFT JOIN student_person person ON person.person_uuid = enrollment.person_uuid
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        LEFT JOIN student_status status ON status.code = enrollment.student_status_code
        LEFT JOIN student_risk_profiles profile ON profile.student_uuid = enrollment.student_uuid
        LEFT JOIN LATERAL (
          SELECT comment.problem_description
          FROM classroom_student_comments comment
          WHERE comment.classroom_id = classroom.id
            AND comment.person_uuid = enrollment.person_uuid
          ORDER BY comment.created_at DESC, comment.id DESC
          LIMIT 1
        ) latest_comment ON TRUE
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${orderBy} ${direction}, enrollment."LastName_Onec" ${direction}, enrollment.student_uuid ${direction}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, input.limit, offset],
    );
    return { rows: result.rows, totalCount: countResult.rows[0]?.total_count ?? 0 };
  }

  async createStudentComment(
    classroomId: number,
    studentUuid: string,
    problemCategory: string,
    problemDescription: string,
    authoredByUserId: number,
    queryRunner: QueryRunner,
  ): Promise<{
    id: string;
    problem_category_code: string;
    problem_category_label: string;
    problem_category_guidance: string | null;
    problem_description: string;
    created_at: Date;
  } | null> {
    const result = await createSqlQueryExecutor(queryRunner).query<{
      id: string;
      problem_category_code: string;
      problem_category_label: string;
      problem_category_guidance: string | null;
      problem_description: string;
      created_at: Date;
    }>(
      `
        WITH inserted AS (
          INSERT INTO classroom_student_comments (
            classroom_id,
            person_uuid,
            problem_category_code,
            problem_description,
            authored_by_user_id
          )
          SELECT $1, enrollment.person_uuid, $3, $4, $5
          FROM student_term enrollment
          WHERE enrollment.student_uuid = $2
            AND enrollment.classroom_id = $1
            AND enrollment.deleted_at IS NULL
            AND enrollment.person_uuid IS NOT NULL
          RETURNING id, problem_category_code, problem_description, created_at
        )
        SELECT
          inserted.id::text,
          inserted.problem_category_code,
          category.label_th AS problem_category_label,
          category.guidance_th AS problem_category_guidance,
          inserted.problem_description,
          inserted.created_at
        FROM inserted
        JOIN classroom_student_problem_categories category
          ON category.code = inserted.problem_category_code
      `,
      [classroomId, studentUuid, problemCategory, problemDescription, authoredByUserId],
    );
    return result.rows[0] ?? null;
  }

  async listClassroomDailyAttendance(input: {
    classroomId: number;
    subjectId?: number | null;
    date?: string;
    search?: string;
    sortBy: 'date' | 'recordedBy' | 'present' | 'late' | 'leave' | 'absent';
    sortDirection: 'asc' | 'desc';
    page: number;
    limit: number;
  }): Promise<{ rows: ClassroomDailyAttendanceRow[]; totalCount: number }> {
    const params: unknown[] = [input.classroomId];
    // `= ANY(ARRAY(...))` rather than a join: the array is an InitPlan, so the
    // filter reaches the view's grouping column instead of running after the
    // whole view is aggregated.
    const conditions = [
      `attendance.student_uuid = ANY(ARRAY(
        SELECT enrolled.student_uuid FROM student_term enrolled
        WHERE enrolled.classroom_id = $1 AND enrolled.deleted_at IS NULL
      ))`,
    ];
    // One subject reads the same day verdict as the whole day, only narrowed —
    // which is exactly what that subject's teacher sees through their link.
    const source = input.subjectId ? 'attendance_subject_day' : 'attendance_day';
    if (input.subjectId) {
      params.push(input.subjectId);
      conditions.push(`attendance.subject_id = $${params.length}`);
    }
    if (input.date) {
      params.push(input.date);
      conditions.push(`attendance."AttendanceDate" = $${params.length}`);
    }
    if (input.search) {
      params.push(`%${escapeLikePattern(input.search)}%`);
      conditions.push(recorderSearchCondition(params.length));
    }
    const where = conditions.join(' AND ');
    const direction = input.sortDirection === 'desc' ? 'DESC' : 'ASC';
    const orderBy = {
      date: 'attendance_date',
      recordedBy: 'recorded_by',
      present: 'present_count',
      late: 'late_count',
      leave: 'leave_count',
      absent: 'absent_count',
    }[input.sortBy];
    const offset = (input.page - 1) * input.limit;
    const count = await queryDataSource<{ total_count: number }>(
      this.dataSource,
      `
        SELECT COUNT(DISTINCT attendance."AttendanceDate")::int AS total_count
        FROM ${source} attendance
        WHERE ${where}
      `,
      params,
    );
    const rows = await queryDataSource<ClassroomDailyAttendanceRow>(
      this.dataSource,
      `
        SELECT
          attendance."AttendanceDate"::text AS attendance_date,
          STRING_AGG(
            DISTINCT COALESCE(
              NULLIF(BTRIM(CONCAT_WS(' ', recorder.first_name, recorder.last_name)), ''),
              NULLIF(BTRIM(CONCAT_WS(' ', recorder_user."FirstName", recorder_user."LastName")), ''),
              CASE
                WHEN attendance."RecordedBy" LIKE '%@%' THEN NULL
                ELSE NULLIF(attendance."RecordedBy", '')
              END,
              '-'
            ),
            ', '
          ) AS recorded_by,
          COUNT(*) FILTER (WHERE attendance."AttendanceStatus" = ${ATTENDANCE_STATUS_CODE.P_PRESENT})::int AS present_count,
          COUNT(*) FILTER (WHERE attendance."AttendanceStatus" = ${ATTENDANCE_STATUS_CODE.P_LATE})::int AS late_count,
          COUNT(*) FILTER (WHERE attendance."AttendanceStatus" = ${ATTENDANCE_STATUS_CODE.P_LEAVE})::int AS leave_count,
          COUNT(*) FILTER (WHERE attendance."AttendanceStatus" = ${ATTENDANCE_STATUS_CODE.P_ABSENT})::int AS absent_count
        FROM ${source} attendance
        LEFT JOIN teachers recorder ON recorder.id = attendance.recorded_by_teacher_id
        LEFT JOIN users recorder_user ON recorder_user.username = attendance."RecordedBy"
        WHERE ${where}
        GROUP BY attendance."AttendanceDate"
        ORDER BY ${orderBy} ${direction}, attendance."AttendanceDate" DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, input.limit, offset],
    );
    return { rows: rows.rows, totalCount: count.rows[0]?.total_count ?? 0 };
  }

  async listClassroomStudentAttendance(input: {
    classroomId: number;
    subjectId?: number | null;
    date?: string;
    search?: string;
    sortBy: 'studentNumber' | 'name' | 'status' | 'present' | 'late' | 'leave' | 'absent';
    sortDirection: 'asc' | 'desc';
    page: number;
    limit: number;
  }): Promise<{ rows: ClassroomStudentAttendanceSummaryRow[]; totalCount: number }> {
    const params: unknown[] = [input.classroomId];
    const conditions = ['enrollment.classroom_id = $1', 'enrollment.deleted_at IS NULL'];
    if (input.search) {
      params.push(`%${escapeLikePattern(input.search)}%`);
      conditions.push(enrolledStudentSearchCondition(params.length));
    }
    const attendanceJoinParams: unknown[] = [];
    let attendanceSubjectCondition = '';
    if (input.subjectId) {
      attendanceJoinParams.push(input.subjectId);
      attendanceSubjectCondition = ` AND attendance.subject_id = $${params.length + attendanceJoinParams.length}`;
    }
    let attendanceDateCondition = '';
    if (input.date) {
      attendanceJoinParams.push(input.date);
      attendanceDateCondition = ` AND attendance."AttendanceDate" = $${params.length + attendanceJoinParams.length}`;
    }
    const allParams = [...params, ...attendanceJoinParams];
    const where = conditions.join(' AND ');
    const direction = input.sortDirection === 'desc' ? 'DESC' : 'ASC';
    const orderBy = {
      studentNumber: 'enrollment.student_number',
      name: `enrollment."FirstName_Onec"`,
      status: `COALESCE(MAX(attendance."AttendanceStatus"), 0)`,
      present: 'present_count',
      late: 'late_count',
      leave: 'leave_count',
      absent: 'absent_count',
    }[input.sortBy];
    const offset = (input.page - 1) * input.limit;
    const count = await queryDataSource<{ total_count: number }>(
      this.dataSource,
      `SELECT COUNT(*)::int AS total_count FROM student_term enrollment WHERE ${where}`,
      params,
    );
    const rows = await queryDataSource<ClassroomStudentAttendanceSummaryRow>(
      this.dataSource,
      `
        SELECT
          enrollment.student_uuid::text,
          enrollment.student_number,
          person.photo_storage_key,
          person.updated_at AS photo_updated_at,
          enrollment."FirstName_Onec" AS first_name,
          enrollment."LastName_Onec" AS last_name,
          COUNT(attendance."AttendanceID") FILTER (WHERE attendance."AttendanceStatus" = ${ATTENDANCE_STATUS_CODE.P_PRESENT})::int AS present_count,
          COUNT(attendance."AttendanceID") FILTER (WHERE attendance."AttendanceStatus" = ${ATTENDANCE_STATUS_CODE.P_LATE})::int AS late_count,
          COUNT(attendance."AttendanceID") FILTER (WHERE attendance."AttendanceStatus" = ${ATTENDANCE_STATUS_CODE.P_LEAVE})::int AS leave_count,
          COUNT(attendance."AttendanceID") FILTER (WHERE attendance."AttendanceStatus" = ${ATTENDANCE_STATUS_CODE.P_ABSENT})::int AS absent_count
        FROM student_term enrollment
        LEFT JOIN student_person person ON person.person_uuid = enrollment.person_uuid
        LEFT JOIN ${input.subjectId ? 'attendance_subject_day' : 'attendance_day'} attendance
          ON attendance.student_uuid = enrollment.student_uuid
         ${attendanceSubjectCondition}
         ${attendanceDateCondition}
        WHERE ${where}
        GROUP BY enrollment.student_uuid, person.photo_storage_key, person.updated_at
        ORDER BY ${orderBy} ${direction}, enrollment."LastName_Onec" ${direction}, enrollment.student_uuid ${direction}
        LIMIT $${allParams.length + 1} OFFSET $${allParams.length + 2}
      `,
      [...allParams, input.limit, offset],
    );
    return { rows: rows.rows, totalCount: count.rows[0]?.total_count ?? 0 };
  }

  async listStudentAttendanceDays(input: {
    classroomId: number;
    studentUuid: string;
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    sortBy: 'date' | 'time' | 'recordedBy' | 'status';
    sortDirection: 'asc' | 'desc';
    page: number;
    limit: number;
  }): Promise<{ rows: ClassroomStudentAttendanceDayRow[]; totalCount: number }> {
    const params: unknown[] = [input.classroomId, input.studentUuid];
    const conditions = [
      'enrollment.classroom_id = $1',
      'enrollment.student_uuid = $2',
      'enrollment.deleted_at IS NULL',
    ];
    if (input.date) {
      params.push(input.date);
      conditions.push(`attendance."AttendanceDate" = $${params.length}`);
    }
    if (input.dateFrom) {
      params.push(input.dateFrom);
      conditions.push(`attendance."AttendanceDate" >= $${params.length}`);
    }
    if (input.dateTo) {
      params.push(input.dateTo);
      conditions.push(`attendance."AttendanceDate" <= $${params.length}`);
    }
    if (input.search) {
      params.push(`%${escapeLikePattern(input.search)}%`);
      conditions.push(recorderSearchCondition(params.length));
    }
    const where = conditions.join(' AND ');
    const direction = input.sortDirection === 'desc' ? 'DESC' : 'ASC';
    const orderBy = {
      date: `attendance."AttendanceDate"`,
      time: `attendance."RecordedAt"`,
      recordedBy: 'recorded_by',
      status: `attendance."AttendanceStatus"`,
    }[input.sortBy];
    const offset = (input.page - 1) * input.limit;
    const count = await queryDataSource<{ total_count: number }>(
      this.dataSource,
      `
        SELECT COUNT(*)::int AS total_count
        FROM attendance_day attendance
        JOIN student_term enrollment ON enrollment.student_uuid = attendance.student_uuid
        WHERE ${where}
      `,
      params,
    );
    const rows = await queryDataSource<ClassroomStudentAttendanceDayRow>(
      this.dataSource,
      `
        SELECT
          attendance."AttendanceID"::text AS attendance_id,
          attendance."AttendanceDate"::text AS attendance_date,
          TO_CHAR(attendance."RecordedAt" AT TIME ZONE 'Asia/Bangkok', 'HH24:MI:SS') AS recorded_time,
          COALESCE(
            NULLIF(BTRIM(CONCAT_WS(' ', recorder.first_name, recorder.last_name)), ''),
            NULLIF(BTRIM(CONCAT_WS(' ', recorder_user."FirstName", recorder_user."LastName")), ''),
            CASE
              WHEN attendance."RecordedBy" LIKE '%@%' THEN NULL
              ELSE NULLIF(attendance."RecordedBy", '')
            END,
            '-'
          ) AS recorded_by,
          attendance."AttendanceStatus"::int AS attendance_status
        FROM attendance_day attendance
        JOIN student_term enrollment ON enrollment.student_uuid = attendance.student_uuid
        LEFT JOIN teachers recorder ON recorder.id = attendance.recorded_by_teacher_id
        LEFT JOIN users recorder_user ON recorder_user.username = attendance."RecordedBy"
        WHERE ${where}
        ORDER BY ${orderBy} ${direction}, attendance."AttendanceID" ${direction}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, input.limit, offset],
    );
    return { rows: rows.rows, totalCount: count.rows[0]?.total_count ?? 0 };
  }

  async listStudentProblemCategories(): Promise<ClassroomStudentProblemCategoryOption[]> {
    const result = await queryDataSource<{
      code: ClassroomStudentProblemCategoryOption['code'];
      label: string;
      guidance: string | null;
    }>(
      this.dataSource,
      `SELECT code, label_th AS label, guidance_th AS guidance
       FROM classroom_student_problem_categories
       WHERE is_active = TRUE
       ORDER BY sort_order, code`,
    );
    return result.rows;
  }
}
