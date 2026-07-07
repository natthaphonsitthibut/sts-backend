import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { queryDataSource } from '../database/sql-query';
import type { RoomSubjectRow, TimetableSlotRow } from './timetable.types';

const SELECT_COLUMNS = `
  ts.id,
  ts.school_term_id,
  ts.school_id,
  ts.grade_level_id,
  ts.room_no,
  ts.day_of_week,
  ts.period,
  ts.subject_id,
  sub.code AS subject_code,
  sub.name_th AS subject_name_th,
  ts.teacher_user_id,
  NULLIF(TRIM(COALESCE(teacher."FirstName", '') || ' ' || COALESCE(teacher."LastName", '')), '') AS teacher_name,
  ts.created_at,
  ts.updated_at
`;

const FROM_JOIN = `
  FROM timetable_slots ts
  JOIN subjects sub ON sub.id = ts.subject_id
  LEFT JOIN users teacher ON teacher.id = ts.teacher_user_id
`;

interface CreateSlotInput {
  schoolTermId: number;
  schoolId: number;
  gradeLevelId: number;
  roomNo: number;
  dayOfWeek: number;
  period: number;
  subjectId: number;
  teacherUserId: number | null;
  actorId: number | null;
}

@Injectable()
export class TimetableRepository {
  constructor(private readonly dataSource: DataSource) {}

  async isSchoolInScope(schoolId: number, scope?: DataScope): Promise<boolean> {
    if (scope?.global === true) {
      const result = await queryDataSource(
        this.dataSource,
        `SELECT 1 FROM schools sc WHERE sc.id = $1`,
        [schoolId],
      );
      return result.rows.length > 0;
    }

    const params: unknown[] = [schoolId];
    const conditions = ['sc.id = $1'];
    const scopeConditions: string[] = [];
    if (scope?.school_ids?.length) {
      params.push(scope.school_ids);
      scopeConditions.push(`sc.id = ANY($${params.length}::int[])`);
    }
    if (scope?.provinces?.length) {
      params.push(scope.provinces);
      scopeConditions.push(`sc.province = ANY($${params.length}::text[])`);
    }
    if (scope?.districts?.length) {
      params.push(scope.districts);
      scopeConditions.push(`sc.district = ANY($${params.length}::text[])`);
    }
    if (scope?.sub_districts?.length) {
      params.push(scope.sub_districts);
      scopeConditions.push(`sc.sub_district = ANY($${params.length}::text[])`);
    }
    if (scopeConditions.length === 0) {
      // Non-global actor with no area/school scope at all — fail closed.
      return false;
    }
    conditions.push(`(${scopeConditions.join(' OR ')})`);

    const result = await queryDataSource(
      this.dataSource,
      `SELECT 1 FROM schools sc WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return result.rows.length > 0;
  }

  async resolveActiveTermId(schoolId: number): Promise<number | null> {
    const result = await queryDataSource<{ id: number }>(
      this.dataSource,
      `SELECT id FROM school_terms WHERE school_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL LIMIT 1`,
      [schoolId],
    );
    return result.rows[0]?.id ?? null;
  }

  async listForRoom(
    schoolId: number,
    gradeLevelId: number,
    roomNo: number,
  ): Promise<TimetableSlotRow[]> {
    const result = await queryDataSource<TimetableSlotRow>(
      this.dataSource,
      `
        SELECT ${SELECT_COLUMNS}
        ${FROM_JOIN}
        WHERE ts.school_id = $1 AND ts.grade_level_id = $2 AND ts.room_no = $3 AND ts.deleted_at IS NULL
        ORDER BY ts.day_of_week ASC, ts.period ASC
      `,
      [schoolId, gradeLevelId, roomNo],
    );
    return result.rows;
  }

  async listForTeacher(teacherUserId: number): Promise<TimetableSlotRow[]> {
    const result = await queryDataSource<TimetableSlotRow>(
      this.dataSource,
      `
        SELECT ${SELECT_COLUMNS}
        ${FROM_JOIN}
        WHERE ts.teacher_user_id = $1 AND ts.deleted_at IS NULL
        ORDER BY ts.day_of_week ASC, ts.period ASC
      `,
      [teacherUserId],
    );
    return result.rows;
  }

  async listDistinctSubjectsForRoom(
    schoolId: number,
    gradeLevelId: number,
    roomNo: number,
  ): Promise<RoomSubjectRow[]> {
    const result = await queryDataSource<RoomSubjectRow>(
      this.dataSource,
      `
        SELECT DISTINCT sub.id AS subject_id, sub.code, sub.name_th
        FROM timetable_slots ts
        JOIN subjects sub ON sub.id = ts.subject_id
        WHERE ts.school_id = $1 AND ts.grade_level_id = $2 AND ts.room_no = $3
          AND ts.deleted_at IS NULL AND sub.is_active = TRUE
        ORDER BY sub.name_th ASC
      `,
      [schoolId, gradeLevelId, roomNo],
    );
    return result.rows;
  }

  async resolveStudentRoom(
    studentUuid: string,
  ): Promise<{ school_id: number; grade_level_id: number; room_no: number } | null> {
    const result = await queryDataSource<{
      school_id: number;
      grade_level_id: number;
      room_no: number;
    }>(
      this.dataSource,
      `
        SELECT s."SchoolID_Onec" AS school_id, s."GradeLevelID_Onec" AS grade_level_id, s."RoomID_Onec" AS room_no
        FROM student_term s
        WHERE s.student_uuid = $1
      `,
      [studentUuid],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<TimetableSlotRow | null> {
    const result = await queryDataSource<TimetableSlotRow>(
      this.dataSource,
      `SELECT ${SELECT_COLUMNS} ${FROM_JOIN} WHERE ts.id = $1 AND ts.deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async create(input: CreateSlotInput, queryRunner: QueryRunner): Promise<{ id: string }> {
    const rows = (await queryRunner.query(
      `
        INSERT INTO timetable_slots (
          school_term_id, school_id, grade_level_id, room_no, day_of_week, period,
          subject_id, teacher_user_id, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        RETURNING id
      `,
      [
        input.schoolTermId,
        input.schoolId,
        input.gradeLevelId,
        input.roomNo,
        input.dayOfWeek,
        input.period,
        input.subjectId,
        input.teacherUserId,
        input.actorId,
      ],
    )) as Array<{ id: string }>;
    return rows[0];
  }

  async update(
    id: string,
    values: { subjectId?: number; teacherUserId?: number | null },
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      `
        UPDATE timetable_slots
        SET subject_id = COALESCE($2, subject_id),
            teacher_user_id = CASE WHEN $3 THEN $4 ELSE teacher_user_id END,
            updated_by = $5
        WHERE id = $1
      `,
      [
        id,
        values.subjectId ?? null,
        'teacherUserId' in values,
        values.teacherUserId ?? null,
        actorId,
      ],
    );
  }

  async softDelete(id: string, actorId: number | null, queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE timetable_slots SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
      [id, actorId],
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
