import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type {
  ClassroomRosterRow,
  ClassroomTeacherAssignmentRow,
  SchoolClassroomRow,
  SchoolTeacherMembershipRow,
  ScopedSchoolRow,
  StructureStatus,
  TeacherAssignmentKind,
} from './school-structure.types';

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

  async listClassrooms(schoolId: number, termId?: number): Promise<SchoolClassroomRow[]> {
    const params: unknown[] = [schoolId];
    const termClause = termId ? `AND classroom.school_term_id = $${params.push(termId)}` : '';
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
          COUNT(enrollment.student_uuid)::int AS student_count
        FROM school_classrooms classroom
        JOIN school_terms term ON term.id = classroom.school_term_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        LEFT JOIN student_term enrollment
          ON enrollment.classroom_id = classroom.id AND enrollment.deleted_at IS NULL
        WHERE classroom.school_id = $1
          AND classroom.deleted_at IS NULL
          ${termClause}
        GROUP BY classroom.id, term.academic_year, term.semester, grade.label
        ORDER BY term.academic_year DESC, term.semester DESC,
                 classroom.grade_level_id, classroom.room_code
      `,
      params,
    );
    return result.rows;
  }

  async findClassroomById(
    classroomId: number,
    queryRunner?: QueryRunner,
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
        (SELECT COUNT(*)::int FROM student_term enrollment
          WHERE enrollment.classroom_id = classroom.id AND enrollment.deleted_at IS NULL
        ) AS student_count
      FROM school_classrooms classroom
      JOIN school_terms term ON term.id = classroom.school_term_id
      JOIN grade_levels grade ON grade.id = classroom.grade_level_id
      WHERE classroom.id = $1 AND classroom.deleted_at IS NULL
      ${queryRunner ? 'FOR UPDATE OF classroom' : ''}
    `;
    const result = queryRunner
      ? await createSqlQueryExecutor(queryRunner).query<SchoolClassroomRow>(sql, [classroomId])
      : await queryDataSource<SchoolClassroomRow>(this.dataSource, sql, [classroomId]);
    return result.rows[0] ?? null;
  }

  async createClassroom(
    input: {
      schoolTermId: number;
      schoolId: number;
      gradeLevelId: number;
      legacyRoomNumber: number | null;
      roomCode: string;
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
        input.legacyRoomNumber,
        input.roomCode,
        input.roomName,
        input.actorId,
      ],
    );
    return (await this.findClassroomById(Number(result.rows[0].id), queryRunner))!;
  }

  async updateClassroom(
    classroomId: number,
    roomName: string | null | undefined,
    classroomStatus: StructureStatus | undefined,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<SchoolClassroomRow> {
    await queryRunner.query(
      `
        UPDATE school_classrooms
        SET room_name = CASE WHEN $2 THEN $3 ELSE room_name END,
            classroom_status = COALESCE($4, classroom_status),
            updated_by = $5
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [classroomId, roomName !== undefined, roomName ?? null, classroomStatus ?? null, actorId],
    );
    return (await this.findClassroomById(classroomId, queryRunner))!;
  }

  async listTeachers(schoolId: number): Promise<SchoolTeacherMembershipRow[]> {
    const result = await queryDataSource<SchoolTeacherMembershipRow>(
      this.dataSource,
      `
        SELECT
          membership.id::text,
          membership.school_id,
          membership.teacher_user_id,
          teacher.username,
          COALESCE(
            NULLIF(TRIM(COALESCE(teacher."FirstName", '') || ' ' || COALESCE(teacher."LastName", '')), ''),
            teacher.username
          ) AS display_name,
          membership.membership_status,
          membership.started_on::text,
          membership.ended_on::text
        FROM school_teacher_memberships membership
        JOIN users teacher ON teacher.id = membership.teacher_user_id
        WHERE membership.school_id = $1 AND membership.deleted_at IS NULL
        ORDER BY membership.membership_status, display_name, membership.id
      `,
      [schoolId],
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
        membership.teacher_user_id,
        teacher.username,
        COALESCE(
          NULLIF(TRIM(COALESCE(teacher."FirstName", '') || ' ' || COALESCE(teacher."LastName", '')), ''),
          teacher.username
        ) AS display_name,
        membership.membership_status,
        membership.started_on::text,
        membership.ended_on::text
      FROM school_teacher_memberships membership
      JOIN users teacher ON teacher.id = membership.teacher_user_id
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

  async isTeacherEligible(teacherUserId: number, queryRunner: QueryRunner): Promise<boolean> {
    const result = await createSqlQueryExecutor(queryRunner).query(
      `
        SELECT 1
        FROM users teacher
        LEFT JOIN roles role_definition ON role_definition.name = teacher.role
        WHERE teacher.id = $1
          AND teacher.status = 'ACTIVE'
          AND (
            COALESCE(teacher.permissions, '[]'::jsonb) ? 'attendance'
            OR COALESCE(role_definition.default_permissions, '[]'::jsonb) ? 'attendance'
          )
        LIMIT 1
      `,
      [teacherUserId],
    );
    return result.rows.length > 0;
  }

  async createTeacherMembership(
    input: {
      schoolId: number;
      teacherUserId: number;
      startedOn: string | null;
      actorId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<SchoolTeacherMembershipRow> {
    const result = await createSqlQueryExecutor(queryRunner).query<{ id: string }>(
      `
        INSERT INTO school_teacher_memberships (
          school_id, teacher_user_id, started_on, created_by, updated_by
        )
        VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $4)
        RETURNING id::text
      `,
      [input.schoolId, input.teacherUserId, input.startedOn, input.actorId],
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
          membership.teacher_user_id,
          COALESCE(
            NULLIF(TRIM(COALESCE(teacher."FirstName", '') || ' ' || COALESCE(teacher."LastName", '')), ''),
            teacher.username
          ) AS teacher_name,
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
        JOIN users teacher ON teacher.id = membership.teacher_user_id
        LEFT JOIN subjects subject ON subject.id = assignment.subject_id
        WHERE assignment.classroom_id = $1 AND assignment.deleted_at IS NULL
        ORDER BY assignment.assignment_kind, teacher_name, assignment.id
      `,
      [classroomId],
    );
    return result.rows;
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
          membership.teacher_user_id,
          COALESCE(
            NULLIF(TRIM(COALESCE(teacher."FirstName", '') || ' ' || COALESCE(teacher."LastName", '')), ''),
            teacher.username
          ) AS teacher_name,
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
        JOIN users teacher ON teacher.id = membership.teacher_user_id
        LEFT JOIN subjects subject ON subject.id = assignment.subject_id
        WHERE assignment.id = $1
      `,
      [result.rows[0].id],
    );
    return assignments.rows[0];
  }

  async listRoster(classroomId: number): Promise<ClassroomRosterRow[]> {
    const result = await queryDataSource<ClassroomRosterRow>(
      this.dataSource,
      `
        SELECT
          enrollment.student_uuid::text,
          enrollment."FirstName_Onec" AS first_name,
          enrollment."LastName_Onec" AS last_name,
          enrollment.student_status_code,
          status.label_th AS student_status_label
        FROM student_term enrollment
        LEFT JOIN student_status status ON status.code = enrollment.student_status_code
        WHERE enrollment.classroom_id = $1 AND enrollment.deleted_at IS NULL
        ORDER BY enrollment."FirstName_Onec", enrollment."LastName_Onec", enrollment.student_uuid
      `,
      [classroomId],
    );
    return result.rows;
  }
}
