import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type {
  RoomSubjectRow,
  SchoolPeriodTimeRow,
  TimetableSlotRow,
  TimetableTeacherCandidateRow,
} from './timetable.types';

export interface GeneratedPeriodTime {
  period: number;
  startsAt: string;
  endsAt: string;
}

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

  async listTeacherCandidatesForSchool(
    schoolId: number,
    searchTerm?: string,
  ): Promise<TimetableTeacherCandidateRow[]> {
    const params: unknown[] = [schoolId];
    const conditions = [
      `u.status = 'ACTIVE'`,
      `COALESCE(u.role, '') <> 'STUDENT'`,
      `(
        u.data_scope ->> 'global' = 'true'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(u.data_scope -> 'school_ids', '[]'::jsonb)) AS scope_school(id)
          WHERE scope_school.id = sc.id::text
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(u.data_scope -> 'provinces', '[]'::jsonb)) AS scope_province(name)
          WHERE scope_province.name = sc.province
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(u.data_scope -> 'districts', '[]'::jsonb)) AS scope_district(name)
          WHERE scope_district.name = sc.district
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(u.data_scope -> 'sub_districts', '[]'::jsonb)) AS scope_sub_district(name)
          WHERE scope_sub_district.name = sc.sub_district
        )
      )`,
    ];
    const trimmedSearch = searchTerm?.trim();
    if (trimmedSearch) {
      params.push(`%${trimmedSearch}%`);
      conditions.push(`
        (
          COALESCE(u."FirstName", '') ILIKE $${params.length}
          OR COALESCE(u."LastName", '') ILIKE $${params.length}
          OR COALESCE(u.username, '') ILIKE $${params.length}
        )
      `);
    }

    const result = await queryDataSource<TimetableTeacherCandidateRow>(
      this.dataSource,
      `
        SELECT
          u.id,
          COALESCE(NULLIF(TRIM(COALESCE(u."FirstName", '') || ' ' || COALESCE(u."LastName", '')), ''), u.username) AS display_name
        FROM users u
        JOIN schools sc ON sc.id = $1
        WHERE ${conditions.join(' AND ')}
        ORDER BY display_name ASC, u.id ASC
        LIMIT 100
      `,
      params,
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

  async findById(id: string, queryRunner?: QueryRunner): Promise<TimetableSlotRow | null> {
    const sql = `SELECT ${SELECT_COLUMNS} ${FROM_JOIN} WHERE ts.id = $1 AND ts.deleted_at IS NULL`;
    if (queryRunner) {
      const result = await createSqlQueryExecutor(queryRunner).query<TimetableSlotRow>(sql, [id]);
      return result.rows[0] ?? null;
    }

    const result = await queryDataSource<TimetableSlotRow>(this.dataSource, sql, [id]);
    return result.rows[0] ?? null;
  }

  async create(input: CreateSlotInput, queryRunner: QueryRunner): Promise<{ id: string } | null> {
    const result = await createSqlQueryExecutor(queryRunner).query<{ id: string }>(
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
    );
    return result.rows[0] ?? null;
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

  async listPeriodTimesForSchool(schoolId: number): Promise<SchoolPeriodTimeRow[]> {
    const result = await queryDataSource<SchoolPeriodTimeRow>(
      this.dataSource,
      `
        SELECT id, school_id, day_of_week, period, starts_at, ends_at, source, created_at, updated_at
        FROM school_period_times
        WHERE school_id = $1 AND deleted_at IS NULL
        ORDER BY day_of_week ASC, period ASC
      `,
      [schoolId],
    );
    return result.rows;
  }

  /** Distinct days the school currently has an active bell schedule for. */
  async listDaysWithPeriodTimes(schoolId: number): Promise<number[]> {
    const result = await queryDataSource<{ day_of_week: number }>(
      this.dataSource,
      `
        SELECT DISTINCT day_of_week
        FROM school_period_times
        WHERE school_id = $1 AND deleted_at IS NULL
      `,
      [schoolId],
    );
    return result.rows.map((row) => row.day_of_week);
  }

  /**
   * Count subject assignments (`timetable_slots`, any room) that would be
   * orphaned if the bell schedule for these days were replaced with only
   * `periodNumbers` — i.e. a period a room still teaches that wouldn't exist
   * in the new schedule. Pass an empty `periodNumbers` to count every
   * assignment on these days regardless of period (used when a day is being
   * dropped from the schedule entirely). The service layer blocks the
   * regenerate when this is non-zero instead of silently leaving those
   * assignments referencing a period/day the bell schedule no longer covers.
   */
  async countSlotsOutsidePeriods(
    schoolId: number,
    days: number[],
    periodNumbers: number[],
  ): Promise<number> {
    const result = await queryDataSource<{ count: number }>(
      this.dataSource,
      `
        SELECT COUNT(*)::int AS count
        FROM timetable_slots
        WHERE school_id = $1
          AND day_of_week = ANY($2::smallint[])
          AND period <> ALL($3::smallint[])
          AND deleted_at IS NULL
      `,
      [schoolId, days, periodNumbers],
    );
    return result.rows[0]?.count ?? 0;
  }

  /**
   * Full replace for the given days — soft-deletes every existing period
   * (regardless of source, including prior MANUAL overrides) for
   * (schoolId, day) then inserts the freshly computed schedule as GENERATED.
   * The service layer is responsible for warning the caller before this runs
   * if MANUAL rows would be overwritten.
   */
  async replacePeriodTimesForDays(
    schoolId: number,
    days: number[],
    periods: GeneratedPeriodTime[],
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      `
        UPDATE school_period_times
        SET deleted_at = now(), deleted_by = $3
        WHERE school_id = $1 AND day_of_week = ANY($2::smallint[]) AND deleted_at IS NULL
      `,
      [schoolId, days, actorId],
    );

    for (const day of days) {
      for (const p of periods) {
        await queryRunner.query(
          `
            INSERT INTO school_period_times (
              school_id, day_of_week, period, starts_at, ends_at, source, created_by, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, 'GENERATED', $6, $6)
          `,
          [schoolId, day, p.period, p.startsAt, p.endsAt, actorId],
        );
      }
    }
  }

  async upsertPeriodTimeOverride(
    schoolId: number,
    dayOfWeek: number,
    period: number,
    startsAt: string,
    endsAt: string,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      `
        INSERT INTO school_period_times (
          school_id, day_of_week, period, starts_at, ends_at, source, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, 'MANUAL', $6, $6)
        ON CONFLICT (school_id, day_of_week, period) WHERE deleted_at IS NULL
        DO UPDATE SET starts_at = $4, ends_at = $5, source = 'MANUAL', updated_by = $6
      `,
      [schoolId, dayOfWeek, period, startsAt, endsAt, actorId],
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
