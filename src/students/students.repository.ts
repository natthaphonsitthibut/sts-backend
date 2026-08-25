import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { buildDataScopeQuery, type DataScope } from '../common/utils/authorization';
import { queryDataSource } from '../database/sql-query';
import type {
  PiiAccessEventInput,
  StudentAttendanceRow,
  StudentAttendanceCalendarRow,
  StudentProfileSummaryRow,
  StudentCareConsiderationRow,
  StudentSubjectAttendanceRow,
  StudentCaseRow,
  StudentDetailRow,
  StudentFilterOptions,
  StudentGuardianRow,
  StudentListFilters,
  StudentListResult,
  StudentListRow,
  StudentsQueryResult,
  StudentPersonContactRow,
  StudentManagementClassroomOption,
} from './students.types';
import type { CreateStudentDto } from './dto/create-student.dto';
import type {
  StudentContactDto,
  StudentGuardianInputDto,
  UpdateStudentDto,
} from './dto/update-student.dto';

const DEFAULT_PAGE_SIZE = 20;

/** Scope-column aliases for the student_term + schools join — shared by every
 * student query so scope enforcement stays identical across them. */
const STUDENT_SCOPE_ALIASES = {
  school_id: `s."SchoolID_Onec"`,
  grade: `s."GradeLevelID_Onec"`,
  room: `s."RoomID_Onec"::text`,
  province: 'sc.province',
  district: 'sc.district',
  sub_district: 'sc.sub_district',
} as const;

function pushParams(target: unknown[], values: unknown[]): void {
  values.forEach((value) => {
    target.push(value);
  });
}

@Injectable()
export class StudentsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private async query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<StudentsQueryResult<T>> {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  /**
   * Build the shared FROM/JOIN + WHERE for the student list, with its bound
   * params. The same clause feeds both the COUNT and the paginated SELECT so the
   * total can never drift from the rows it counts.
   */
  private buildStudentListFromWhere(
    filters: StudentListFilters,
    userScope?: DataScope,
  ): { fromWhere: string; params: unknown[] } {
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (userScope) {
      const scopeResult = buildDataScopeQuery(userScope, STUDENT_SCOPE_ALIASES, params.length + 1);

      if (scopeResult.sql) {
        conditions.push(`(${scopeResult.sql})`);
        pushParams(params, scopeResult.params);
      }
    }

    if (filters.grade) {
      params.push(filters.grade);
      conditions.push(`gl.label = $${params.length}`);
    }

    if (typeof filters.room === 'number') {
      params.push(filters.room);
      conditions.push(`s."RoomID_Onec" = $${params.length}`);
    }

    if (typeof filters.schoolId === 'number') {
      params.push(filters.schoolId);
      conditions.push(`s."SchoolID_Onec" = $${params.length}`);
    }

    if (filters.province) {
      params.push(filters.province);
      conditions.push(`sc.province = $${params.length}`);
    }

    if (filters.district) {
      params.push(filters.district);
      conditions.push(`sc.district = $${params.length}`);
    }

    if (filters.subDistrict) {
      params.push(filters.subDistrict);
      conditions.push(`sc.sub_district = $${params.length}`);
    }

    if (filters.searchTerm) {
      // Match name OR student code, preserving the previous client-side filter
      // which searched both the full name and the PersonID_Onec ("รหัส").
      params.push(`%${filters.searchTerm}%`);
      conditions.push(
        `((s."FirstName_Onec" || ' ' || s."LastName_Onec") ILIKE $${params.length} OR s."PersonID_Onec" ILIKE $${params.length})`,
      );
    }

    if (typeof filters.studentStatusCode === 'number') {
      params.push(filters.studentStatusCode);
      conditions.push(
        `COALESCE(s.student_status_code, s."StudentStatusID_Onec") = $${params.length}`,
      );
    }

    if (filters.riskTier === 'AT_RISK') {
      conditions.push(`COALESCE(risk.risk_tier, 'NORMAL') != 'NORMAL'`);
    } else if (filters.riskTier) {
      params.push(filters.riskTier);
      conditions.push(`COALESCE(risk.risk_tier, 'NORMAL') = $${params.length}`);
    }

    const currentEnrollmentJoin =
      filters.enrollmentState === 'all'
        ? ''
        : `
      JOIN student_current_enrollment_resolution current_enrollment
        ON current_enrollment.person_uuid = s.person_uuid
       AND current_enrollment.selected_student_uuid = s.student_uuid
       AND current_enrollment.resolution_state = 'ACTIVE'
    `;

    const fromWhere = `
      FROM student_term s
      ${currentEnrollmentJoin}
      LEFT JOIN student_person person ON person.person_uuid = s.person_uuid
      LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
      LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
      LEFT JOIN student_status ss
        ON ss.code = COALESCE(s.student_status_code, s."StudentStatusID_Onec")
      LEFT JOIN student_risk_profiles risk ON risk.student_uuid = s.student_uuid
      ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
    `;

    return { fromWhere, params };
  }

  async listStudents(
    filters: StudentListFilters,
    userScope?: DataScope,
  ): Promise<StudentListResult> {
    const { fromWhere, params } = this.buildStudentListFromWhere(filters, userScope);

    const countResult = await this.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total ${fromWhere}`,
      params,
    );
    const totalCount = countResult.rows[0]?.total ?? 0;

    const limit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_PAGE_SIZE;
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const offset = (page - 1) * limit;

    const selectParams = [...params];
    selectParams.push(limit);
    const limitPlaceholder = selectParams.length;
    selectParams.push(offset);
    const offsetPlaceholder = selectParams.length;

    const result = await this.query<StudentListRow>(
      `
        SELECT
          s.student_uuid as id,
          (s."FirstName_Onec" || ' ' || s."LastName_Onec") as name,
          COALESCE(gl.label, 'ไม่ทราบ') as grade,
          s."RoomID_Onec"::text as room,
          sc.name as school_name,
          sc.id as school_id,
          COALESCE(ss.label_th, 'ยังไม่ได้จับคู่') as student_status_label,
          COALESCE(ss.category, 'UNMATCHED') as student_status_category,
          COALESCE(ss.badge_variant, 'warning') as student_status_badge_variant,
          person.photo_storage_key,
          person.updated_at AS photo_updated_at
        ${fromWhere}
        ORDER BY s."SchoolID_Onec" ASC, s."GradeLevelID_Onec" ASC, s."RoomID_Onec" ASC, s."PersonID_Onec" ASC
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      selectParams,
    );

    return { rows: result.rows, totalCount };
  }

  /**
   * Scoped distinct grade/room options for the student-list filter dropdowns.
   * Grades respect scope + school; rooms additionally narrow by the selected
   * grade so the two dropdowns can cascade. Both stay within the actor's scope.
   */
  async getStudentFilterOptions(
    filters: {
      schoolId?: number;
      province?: string;
      district?: string;
      subDistrict?: string;
      grade?: string;
      studentStatusCode?: StudentListFilters['studentStatusCode'];
      enrollmentState?: StudentListFilters['enrollmentState'];
    },
    userScope?: DataScope,
  ): Promise<StudentFilterOptions> {
    const currentEnrollmentJoin =
      filters.enrollmentState === 'all'
        ? ''
        : `
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
      `;

    const buildConditions = (params: unknown[], withGrade: boolean): string => {
      const conditions: string[] = [];

      if (userScope) {
        const scopeResult = buildDataScopeQuery(
          userScope,
          STUDENT_SCOPE_ALIASES,
          params.length + 1,
        );
        if (scopeResult.sql) {
          conditions.push(`(${scopeResult.sql})`);
          pushParams(params, scopeResult.params);
        }
      }

      if (typeof filters.schoolId === 'number') {
        params.push(filters.schoolId);
        conditions.push(`s."SchoolID_Onec" = $${params.length}`);
      }

      if (filters.province) {
        params.push(filters.province);
        conditions.push(`sc.province = $${params.length}`);
      }

      if (filters.district) {
        params.push(filters.district);
        conditions.push(`sc.district = $${params.length}`);
      }

      if (filters.subDistrict) {
        params.push(filters.subDistrict);
        conditions.push(`sc.sub_district = $${params.length}`);
      }

      if (withGrade && filters.grade) {
        params.push(filters.grade);
        conditions.push(`gl.label = $${params.length}`);
      }

      if (typeof filters.studentStatusCode === 'number') {
        params.push(filters.studentStatusCode);
        conditions.push(
          `COALESCE(s.student_status_code, s."StudentStatusID_Onec") = $${params.length}`,
        );
      }

      return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    };

    const gradeParams: unknown[] = [];
    const gradeWhere = buildConditions(gradeParams, false);
    const gradesResult = await this.query<{ grade: string | null; grade_id: number | null }>(
      `
        SELECT DISTINCT COALESCE(gl.label, 'ไม่ทราบ') AS grade, gl.id AS grade_id
        FROM student_term s
        ${currentEnrollmentJoin}
        LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
        LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
        ${gradeWhere}
        ORDER BY grade_id ASC NULLS LAST
      `,
      gradeParams,
    );

    const roomParams: unknown[] = [];
    const roomWhere = buildConditions(roomParams, true);
    const roomsResult = await this.query<{ room: number | null }>(
      `
        SELECT DISTINCT s."RoomID_Onec" AS room
        FROM student_term s
        ${currentEnrollmentJoin}
        LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
        LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
        ${roomWhere}
        ORDER BY room ASC NULLS LAST
      `,
      roomParams,
    );

    const grades = gradesResult.rows
      .map((row) => (typeof row.grade === 'string' ? row.grade.trim() : ''))
      .filter((grade) => grade.length > 0);

    const rooms = roomsResult.rows
      .map((row) => (row.room === null || row.room === undefined ? '' : String(row.room)))
      .filter((room) => room.length > 0 && room !== '0');

    return { grades, rooms };
  }

  async findStudentById(id: string, userScope?: DataScope): Promise<StudentDetailRow | null> {
    let query = `
      SELECT
        s.*,
        s.student_uuid::text AS id,
        person.photo_storage_key,
        person.updated_at AS photo_updated_at,
        gl.label as grade,
        s."RoomID_Onec"::text as room,
        sc.name as school_name,
        COALESCE(risk.risk_tier, 'NORMAL') as risk_tier,
        COALESCE(ss.label_th, 'ยังไม่ได้จับคู่') as student_status_label,
        COALESCE(ss.category, 'UNMATCHED') as student_status_category,
        COALESCE(ss.badge_variant, 'warning') as student_status_badge_variant,
        homeroom.homeroom_teacher_name,
        -- Latest home-visit case pin wins (most recent on-the-ground
        -- observation); falls back to the student's own confirmed profile
        -- coordinate (student_term.address_latitude/longitude, set via the
        -- edit form).
        COALESCE(latest_case.student_lat, s.address_latitude) AS resolved_home_lat,
        COALESCE(latest_case.student_lng, s.address_longitude) AS resolved_home_lng
      FROM student_term s
      LEFT JOIN student_person person ON person.person_uuid = s.person_uuid
      LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
      LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
      LEFT JOIN student_status ss
        ON ss.code = COALESCE(s.student_status_code, s."StudentStatusID_Onec")
      LEFT JOIN student_risk_profiles risk ON risk.student_uuid = s.student_uuid
      LEFT JOIN LATERAL (
        SELECT TRIM(teacher.first_name || ' ' || teacher.last_name) AS homeroom_teacher_name
        FROM classroom_homeroom_teachers assignment
        JOIN school_teacher_memberships membership
          ON membership.id = assignment.teacher_membership_id
         AND membership.school_id = assignment.school_id
         AND membership.membership_status = 'ACTIVE'
         AND membership.deleted_at IS NULL
        JOIN teachers teacher
          ON teacher.id = membership.teacher_id
         AND teacher.deleted_at IS NULL
        WHERE assignment.classroom_id = s.classroom_id
          AND assignment.school_id = s."SchoolID_Onec"
        LIMIT 1
      ) homeroom ON true
      LEFT JOIN LATERAL (
        SELECT c.student_lat, c.student_lng
        FROM cases c
        WHERE c.student_uuid = s.student_uuid
          AND c.student_lat IS NOT NULL
          AND c.student_lng IS NOT NULL
          AND c.deleted_at IS NULL
        ORDER BY c.created_at DESC
        LIMIT 1
      ) latest_case ON true
      WHERE s.student_uuid = $1
    `;
    const params: unknown[] = [id];

    if (userScope) {
      const scopeResult = buildDataScopeQuery(
        userScope,
        {
          school_id: `s."SchoolID_Onec"`,
          grade: `s."GradeLevelID_Onec"`,
          room: `s."RoomID_Onec"::text`,
          province: 'sc.province',
          district: 'sc.district',
          sub_district: 'sc.sub_district',
        },
        params.length + 1,
      );

      if (scopeResult.sql) {
        query += ` AND (${scopeResult.sql})`;
        pushParams(params, scopeResult.params);
      }
    }

    const result = await this.query<StudentDetailRow>(query, params);
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    // `SELECT s.*` would surface the canonical person_uuid to the client. That
    // cross-enrollment linkage id must stay server-side (same principle as the
    // national id) — strip it from the wire shape; internal callers resolve it
    // via findPersonUuidByStudentUuid instead.
    delete (row as Record<string, unknown>).person_uuid;
    return row;
  }

  /**
   * Resolve the canonical person that owns an enrollment snapshot. Used by
   * own-access checks so a student reaches every enrollment of their own person,
   * not only the current-term snapshot they logged in with. Returns null if the
   * snapshot is unknown or not yet linked (person_uuid is nullable until B2
   * CONTRACT).
   */
  /** Photo lives on the person, so it survives re-imports of `student_term`. */
  async findPersonPhotoStorageKey(personUuid: string): Promise<string | null> {
    const result = await this.query<{ photo_storage_key: string | null }>(
      `SELECT photo_storage_key FROM student_person WHERE person_uuid = $1 LIMIT 1`,
      [personUuid],
    );
    return result.rows[0]?.photo_storage_key ?? null;
  }

  async updatePersonPhotoStorageKey(personUuid: string, storageKey: string | null): Promise<void> {
    await this.query(`UPDATE student_person SET photo_storage_key = $2 WHERE person_uuid = $1`, [
      personUuid,
      storageKey,
    ]);
  }

  async findPersonUuidByStudentUuid(studentUuid: string): Promise<string | null> {
    const result = await this.query<{ person_uuid: string | null }>(
      `SELECT person_uuid FROM student_term WHERE student_uuid = $1 LIMIT 1`,
      [studentUuid],
    );
    return result.rows[0]?.person_uuid ?? null;
  }

  async listManagementClassrooms(
    userScope?: DataScope,
  ): Promise<StudentManagementClassroomOption[]> {
    const params: unknown[] = [];
    let scopeSql = '';
    if (userScope) {
      const scope = buildDataScopeQuery(
        userScope,
        {
          school_id: 'classroom.school_id',
          grade: 'classroom.grade_level_id',
          room: 'classroom.legacy_room_number::text',
          province: 'school.province',
          district: 'school.district',
          sub_district: 'school.sub_district',
        },
        1,
      );
      scopeSql = scope.sql ? `AND (${scope.sql})` : '';
      pushParams(params, scope.params);
    }
    const result = await this.query<StudentManagementClassroomOption>(
      `
        SELECT classroom.id::text,
          classroom.school_id,
          school.name AS school_name,
          term.id::text AS school_term_id,
          term.academic_year,
          term.semester::int,
          classroom.grade_level_id,
          grade.label AS grade_label,
          classroom.room_code,
          classroom.room_name
        FROM school_classrooms classroom
        JOIN school_terms term
          ON term.id = classroom.school_term_id
         AND term.school_id = classroom.school_id
         AND term.deleted_at IS NULL
        JOIN schools school ON school.id = classroom.school_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        WHERE classroom.deleted_at IS NULL
          AND classroom.classroom_status = 'ACTIVE'
          AND term.status = 'ACTIVE'
          ${scopeSql}
        ORDER BY term.academic_year DESC, term.semester DESC,
                 school.name, classroom.grade_level_id, classroom.legacy_room_number
      `,
      params,
    );
    return result.rows;
  }

  async createStudent(
    data: CreateStudentDto,
    actorUserId: number | null,
    userScope?: DataScope,
  ): Promise<
    | { studentUuid: string }
    | { conflict: 'IDENTITY' | 'ENROLLMENT' }
    | { invalidStatus: true }
    | null
  > {
    return await this.dataSource.transaction(async (manager) => {
      const scopeParams: unknown[] = [data.classroom_id];
      let scopeSql = '';
      if (userScope) {
        const scope = buildDataScopeQuery(
          userScope,
          {
            school_id: 'classroom.school_id',
            grade: 'classroom.grade_level_id',
            room: 'classroom.legacy_room_number::text',
            province: 'school.province',
            district: 'school.district',
            sub_district: 'school.sub_district',
          },
          2,
        );
        scopeSql = scope.sql ? `AND (${scope.sql})` : '';
        pushParams(scopeParams, scope.params);
      }
      const classrooms = (await manager.query(
        `
          SELECT classroom.id, classroom.school_id, classroom.school_term_id,
            classroom.grade_level_id, classroom.legacy_room_number,
            term.academic_year, term.semester
          FROM school_classrooms classroom
          JOIN school_terms term
            ON term.id = classroom.school_term_id
           AND term.school_id = classroom.school_id
           AND term.deleted_at IS NULL
          JOIN schools school ON school.id = classroom.school_id
          WHERE classroom.id = $1
            AND classroom.deleted_at IS NULL
            AND classroom.classroom_status = 'ACTIVE'
            AND term.status = 'ACTIVE'
            ${scopeSql}
          FOR UPDATE OF classroom
        `,
        scopeParams,
      )) as unknown as Array<{
        id: string;
        school_id: number;
        school_term_id: string;
        grade_level_id: number;
        legacy_room_number: number;
        academic_year: number;
        semester: number;
      }>;
      const classroom = classrooms[0];
      if (!classroom) return null;

      const statuses = (await manager.query(
        `
          SELECT code
          FROM student_status
          WHERE code = $1
            AND is_enabled = TRUE
            AND category <> 'UNMATCHED'
            AND deleted_at IS NULL
          FOR SHARE
        `,
        [data.student_status_code],
      )) as unknown as Array<{ code: number }>;
      if (!statuses[0]) return { invalidStatus: true };

      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `student-national-id:${data.PersonID_Onec}`,
      ]);
      const existingIdentifiers = (await manager.query(
        `
          SELECT person_uuid
          FROM student_person_identifier
          WHERE identifier_type = 'NATIONAL_ID'
            AND identifier_normalized = $1
            AND deleted_at IS NULL
          LIMIT 2
        `,
        [data.PersonID_Onec],
      )) as unknown as Array<{ person_uuid: string }>;
      if (existingIdentifiers.length > 0) return { conflict: 'IDENTITY' };

      const people = (await manager.query(
        `
          INSERT INTO student_person (identity_status, created_by, updated_by)
          VALUES ('ACTIVE', $1, $1)
          RETURNING person_uuid
        `,
        [actorUserId],
      )) as unknown as Array<{ person_uuid: string }>;
      const personUuid = people[0]?.person_uuid;
      if (!personUuid) throw new Error('Failed to create student identity');

      await manager.query(
        `
          INSERT INTO student_person_identifier (
            person_uuid, identifier_type, identifier_value,
            identifier_normalized, source, created_by, updated_by
          )
          VALUES ($1, 'NATIONAL_ID', $2, $2, 'MANUAL', $3, $3)
        `,
        [personUuid, data.PersonID_Onec, actorUserId],
      );
      if (data.PassportNumber_Onec) {
        await manager.query(
          `
            INSERT INTO student_person_identifier (
              person_uuid, identifier_type, identifier_value,
              identifier_normalized, source, created_by, updated_by
            )
            VALUES ($1, 'PASSPORT', $2, UPPER($2), 'MANUAL', $3, $3)
          `,
          [personUuid, data.PassportNumber_Onec, actorUserId],
        );
      }

      const rows = (await manager.query(
        `
          INSERT INTO student_term (
            "AcademicYear_Onec", "Semester_Onec", "SchoolID_Onec",
            "PersonID_Onec", "PassportNumber_Onec",
            "FirstName_Onec", "MiddleName_Onec", "LastName_Onec",
            "GradeLevelID_Onec", "RoomID_Onec",
            "StudentStatusID_Onec", student_status_code,
            school_term_id, classroom_id, student_number, term_gpa,
            address_house_no, "VillageNumber_Onec", "Street_Onec",
            "Soi_Onec", "Trok_Onec", "ProvinceNameThai_Onec",
            "DistrictNameThai_Onec", "SubDistrictNameThai_Onec",
            "PostalCode_Onec", address_latitude, address_longitude,
            person_uuid, created_by, updated_by
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $11, $12, $13, $14, $15, $16, $17, $18, $19,
            $20, $21, $22, $23, $24, $25, $26, $27, $28, $28
          )
          RETURNING student_uuid::text
        `,
        [
          classroom.academic_year,
          classroom.semester,
          classroom.school_id,
          data.PersonID_Onec,
          data.PassportNumber_Onec ?? null,
          data.FirstName_Onec,
          data.MiddleName_Onec ?? null,
          data.LastName_Onec,
          classroom.grade_level_id,
          classroom.legacy_room_number,
          data.student_status_code,
          classroom.school_term_id,
          classroom.id,
          data.student_number ?? null,
          data.term_gpa ?? null,
          data.address_house_no ?? null,
          data.VillageNumber_Onec ?? null,
          data.Street_Onec ?? null,
          data.Soi_Onec ?? null,
          data.Trok_Onec ?? null,
          data.ProvinceNameThai_Onec ?? null,
          data.DistrictNameThai_Onec ?? null,
          data.SubDistrictNameThai_Onec ?? null,
          data.PostalCode_Onec ?? null,
          data.address_latitude ?? null,
          data.address_longitude ?? null,
          personUuid,
          actorUserId,
        ],
      )) as unknown as Array<{ student_uuid: string }>;
      const studentUuid = rows[0]?.student_uuid;
      if (!studentUuid) throw new Error('Failed to create student enrollment');

      if (data.contact) {
        await manager.query(
          `
            INSERT INTO student_person_contact (
              person_uuid, phone, email, line_id, created_by, updated_by
            ) VALUES ($1, $2, $3, $4, $5, $5)
          `,
          [
            personUuid,
            data.contact.phone ?? null,
            data.contact.email ?? null,
            data.contact.line_id ?? null,
            actorUserId,
          ],
        );
      }
      for (const guardian of data.guardians ?? []) {
        await manager.query(
          `
            INSERT INTO student_guardian (
              person_uuid, relation, relation_note, first_name, last_name,
              full_name, phone, email, line_id, is_primary, created_by, updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
          `,
          [
            personUuid,
            guardian.relation,
            guardian.relation === 'GUARDIAN' ? (guardian.relation_note ?? null) : null,
            guardian.first_name,
            guardian.last_name,
            guardian.full_name ?? `${guardian.first_name ?? ''} ${guardian.last_name ?? ''}`.trim(),
            guardian.phone ?? null,
            guardian.email ?? null,
            guardian.line_id ?? null,
            guardian.is_primary ?? false,
            actorUserId,
          ],
        );
      }
      return { studentUuid };
    });
  }

  private async updateStudentTermWithManager(
    manager: EntityManager,
    studentUuid: string,
    data: Omit<UpdateStudentDto, 'contact' | 'guardians'>,
  ): Promise<void> {
    const columnByField: Record<keyof Omit<UpdateStudentDto, 'contact' | 'guardians'>, string> = {
      FirstName_Onec: '"FirstName_Onec"',
      MiddleName_Onec: '"MiddleName_Onec"',
      LastName_Onec: '"LastName_Onec"',
      student_number: '"student_number"',
      student_status_code: '"student_status_code"',
      term_gpa: '"term_gpa"',
      address_house_no: '"address_house_no"',
      VillageNumber_Onec: '"VillageNumber_Onec"',
      Street_Onec: '"Street_Onec"',
      Soi_Onec: '"Soi_Onec"',
      Trok_Onec: '"Trok_Onec"',
      ProvinceNameThai_Onec: '"ProvinceNameThai_Onec"',
      DistrictNameThai_Onec: '"DistrictNameThai_Onec"',
      SubDistrictNameThai_Onec: '"SubDistrictNameThai_Onec"',
      PostalCode_Onec: '"PostalCode_Onec"',
      address_latitude: '"address_latitude"',
      address_longitude: '"address_longitude"',
    };
    // Skip undefined values: a PATCH that omits a field must never NULL it
    // (the DTO materializes every declared key, and the address-prefix
    // overrides in the service re-add keys the caller never sent).
    const entries = (
      Object.entries(data) as Array<
        [keyof Omit<UpdateStudentDto, 'contact' | 'guardians'>, unknown]
      >
    ).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      return;
    }
    const values: unknown[] = [studentUuid];
    const assignments = entries.map(([field, value]) => {
      values.push(typeof value === 'string' ? value.trim() || null : value);
      return `${columnByField[field]} = $${values.length}`;
    });
    await manager.query(
      `UPDATE student_term SET ${assignments.join(', ')} WHERE student_uuid = $1`,
      values,
    );
  }

  /** Canonical contact channels of the student person, independent of accounts. */
  async findStudentPersonContact(personUuid: string): Promise<StudentPersonContactRow | null> {
    const result = await this.query<StudentPersonContactRow>(
      `
        SELECT phone, email, line_id
        FROM student_person_contact
        WHERE person_uuid = $1
      `,
      [personUuid],
    );
    return result.rows[0] ?? null;
  }

  async listGuardiansByPersonUuid(personUuid: string): Promise<StudentGuardianRow[]> {
    const result = await this.query<StudentGuardianRow>(
      `
        SELECT id::text, relation, relation_note, full_name, first_name, last_name,
          phone, email, line_id, is_primary
        FROM student_guardian
        WHERE person_uuid = $1 AND deleted_at IS NULL
        ORDER BY is_primary DESC,
          CASE relation WHEN 'FATHER' THEN 0 WHEN 'MOTHER' THEN 1 ELSE 2 END,
          id
      `,
      [personUuid],
    );
    return result.rows;
  }

  private async updateStudentPersonContactsWithManager(
    manager: EntityManager,
    personUuid: string,
    contact: StudentContactDto | undefined,
    guardians: StudentGuardianInputDto[] | undefined,
    actorUserId: number | null,
  ): Promise<void> {
    if (contact !== undefined) {
      const hasPhone = contact.phone !== undefined;
      const hasEmail = contact.email !== undefined;
      const hasLineId = contact.line_id !== undefined;
      await manager.query(
        `
          INSERT INTO student_person_contact (
            person_uuid, phone, email, line_id, created_by, updated_by
          )
          VALUES ($1, $2, $3, $4, $8, $8)
          ON CONFLICT (person_uuid) DO UPDATE
          SET phone = CASE WHEN $5 THEN EXCLUDED.phone ELSE student_person_contact.phone END,
              email = CASE WHEN $6 THEN EXCLUDED.email ELSE student_person_contact.email END,
              line_id = CASE WHEN $7 THEN EXCLUDED.line_id ELSE student_person_contact.line_id END,
              updated_by = $8,
              deleted_at = NULL,
              deleted_by = NULL
        `,
        [
          personUuid,
          contact.phone ?? null,
          contact.email ?? null,
          contact.line_id ?? null,
          hasPhone,
          hasEmail,
          hasLineId,
          actorUserId,
        ],
      );
    }

    if (guardians !== undefined) {
      await manager.query(
        `
          UPDATE student_guardian
          SET deleted_at = now(), deleted_by = $2
          WHERE person_uuid = $1 AND deleted_at IS NULL
        `,
        [personUuid, actorUserId],
      );
      for (const guardian of guardians) {
        await manager.query(
          `
            INSERT INTO student_guardian (
              person_uuid, relation, relation_note, first_name, last_name, full_name,
              phone, email, line_id, is_primary, created_by, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
          `,
          [
            personUuid,
            guardian.relation,
            guardian.relation === 'GUARDIAN' ? (guardian.relation_note ?? null) : null,
            guardian.first_name?.trim() ?? null,
            guardian.last_name?.trim() || null,
            guardian.full_name?.trim() ?? '',
            guardian.phone ?? null,
            guardian.email ?? null,
            guardian.line_id ?? null,
            guardian.is_primary ?? false,
            actorUserId,
          ],
        );
      }
    }
  }

  /** Enrollment, contact and guardian changes commit or roll back together. */
  async updateStudent(
    studentUuid: string,
    data: Omit<UpdateStudentDto, 'contact' | 'guardians'>,
    contact: StudentContactDto | undefined,
    guardians: StudentGuardianInputDto[] | undefined,
    actorUserId: number | null,
  ): Promise<
    { updated: true } | { notFound: true } | { missingPerson: true } | { invalidStatus: true }
  > {
    return await this.dataSource.transaction(async (manager) => {
      const enrollments = (await manager.query(
        `SELECT person_uuid FROM student_term WHERE student_uuid = $1 FOR UPDATE`,
        [studentUuid],
      )) as unknown as Array<{ person_uuid: string | null }>;
      const enrollment = enrollments[0];
      if (!enrollment) return { notFound: true };

      if (data.student_status_code !== undefined) {
        const statuses = (await manager.query(
          `
            SELECT code
            FROM student_status
            WHERE code = $1
              AND is_enabled = TRUE
              AND category <> 'UNMATCHED'
              AND deleted_at IS NULL
            FOR SHARE
          `,
          [data.student_status_code],
        )) as unknown as Array<{ code: number }>;
        if (!statuses[0]) return { invalidStatus: true };
      }

      if (contact !== undefined || guardians !== undefined) {
        if (!enrollment.person_uuid) return { missingPerson: true };
        await this.updateStudentPersonContactsWithManager(
          manager,
          enrollment.person_uuid,
          contact,
          guardians,
          actorUserId,
        );
      }
      await this.updateStudentTermWithManager(manager, studentUuid, data);
      return { updated: true };
    });
  }

  /** Append one immutable PII-reveal record to the access log. */
  async insertPiiAccessEvent(event: PiiAccessEventInput): Promise<void> {
    await this.query(
      `
        INSERT INTO pii_access_events (
          actor_user_id,
          actor_roles,
          actor_kind,
          subject_student_ref,
          subject_type,
          subject_ref,
          subject_ref_key_version,
          field_group,
          reason_code,
          reason_note,
          purpose_link_id,
          request_id,
          ip,
          user_agent
        )
        VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        event.actorUserId,
        JSON.stringify(event.actorRoles ?? []),
        event.actorKind,
        event.subjectStudentRef,
        event.subjectType,
        event.subjectRef,
        event.subjectRefKeyVersion,
        event.fieldGroup,
        event.reasonCode,
        event.reasonNote,
        event.purposeLinkId,
        event.requestId,
        event.ip,
        event.userAgent,
      ],
    );
  }

  /**
   * Field groups this actor revealed for this student within the reveal window —
   * used to keep those fields unmasked (no re-prompt / no duplicate log) until
   * the window lapses.
   */
  async listActiveRevealGroups(
    actorUserId: number,
    subjectStudentRef: string,
    withinSeconds: number,
  ): Promise<string[]> {
    const result = await this.query<{ field_group: string }>(
      `
        SELECT DISTINCT field_group
        FROM pii_access_events
        WHERE actor_user_id = $1
          AND subject_student_ref = $2
          AND subject_type = 'STUDENT'
          AND created_at > now() - make_interval(secs => $3)
      `,
      [actorUserId, subjectStudentRef, withinSeconds],
    );
    return result.rows.map((row) => row.field_group);
  }

  async findCasesByStudentName(name: string, userScope?: DataScope): Promise<StudentCaseRow[]> {
    const params: unknown[] = [name];
    const scope = userScope
      ? buildDataScopeQuery(userScope, STUDENT_SCOPE_ALIASES, params.length + 1)
      : { sql: '', params: [] };
    params.push(...scope.params);
    const scopeSql = scope.sql ? ` AND (${scope.sql})` : '';
    const result = await this.query<StudentCaseRow>(
      `
        SELECT c.id, c.created_at, c.reason_flagged, c.status
        FROM cases c
        INNER JOIN student_term s ON s.student_uuid = c.student_uuid
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        WHERE c.student_name = $1
          AND c.deleted_at IS NULL${scopeSql}
        ORDER BY c.created_at DESC, c.id DESC
      `,
      params,
    );

    return result.rows;
  }

  async findCasesByStudentId(studentUuid: string): Promise<StudentCaseRow[]> {
    const result = await this.query<StudentCaseRow>(
      `
        SELECT id, created_at, reason_flagged, status
        FROM cases
        WHERE student_uuid = $1
          AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
      `,
      [studentUuid],
    );

    return result.rows;
  }

  async listAttendanceByStudentId(
    id: string,
    userScope?: DataScope,
  ): Promise<StudentAttendanceRow[]> {
    let query = `
      SELECT
        a."AttendanceDate" as date,
        a."AttendanceStatus" as status,
        a."Period" as period
      FROM student_term s
      JOIN attendance_effective_records a ON a.student_uuid = s.student_uuid
      LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
      WHERE s.student_uuid = $1
        AND a.session_kind = 'SUBJECT'
    `;
    const params: unknown[] = [id];

    if (userScope) {
      const scopeResult = buildDataScopeQuery(
        userScope,
        {
          school_id: `s."SchoolID_Onec"`,
          grade: `s."GradeLevelID_Onec"`,
          room: `s."RoomID_Onec"::text`,
          province: 'sc.province',
          district: 'sc.district',
          sub_district: 'sc.sub_district',
        },
        params.length + 1,
      );

      if (scopeResult.sql) {
        query += ` AND (${scopeResult.sql})`;
        pushParams(params, scopeResult.params);
      }
    }

    query += ' ORDER BY a."AttendanceDate" DESC';
    const result = await this.query<StudentAttendanceRow>(query, params);

    return result.rows;
  }

  async findStudentProfileSummary(id: string): Promise<StudentProfileSummaryRow | null> {
    const result = await this.query<StudentProfileSummaryRow>(
      `
        SELECT
          s."AcademicYear_Onec" AS academic_year,
          s."Semester_Onec" AS semester,
          term.starts_on::text AS starts_on,
          term.ends_on::text AS ends_on,
          s.term_gpa,
          s."GPAX_Onec" AS cumulative_gpax,
          COUNT(*) FILTER (WHERE attendance."AttendanceStatus" = 1)::int AS present_count,
          COUNT(*) FILTER (WHERE attendance."AttendanceStatus" = 2)::int AS absent_count,
          COUNT(*) FILTER (WHERE attendance."AttendanceStatus" = 3)::int AS late_count,
          COUNT(*) FILTER (WHERE attendance."AttendanceStatus" = 4)::int AS leave_count,
          COUNT(attendance."AttendanceID")::int AS total_count
        FROM student_term s
        LEFT JOIN school_terms term
          ON term.school_id = s."SchoolID_Onec"
         AND term.academic_year = s."AcademicYear_Onec"
         AND term.semester = s."Semester_Onec"
         AND term.deleted_at IS NULL
        LEFT JOIN attendance_effective_records attendance
          ON attendance.student_uuid = s.student_uuid
         AND attendance.session_kind = 'SUBJECT'
         AND attendance."AcademicYear_Onec" = s."AcademicYear_Onec"
         AND attendance."Semester_Onec" = s."Semester_Onec"
        WHERE s.student_uuid = $1
        GROUP BY
          s.student_uuid,
          s."AcademicYear_Onec",
          s."Semester_Onec",
          term.starts_on,
          term.ends_on,
          s.term_gpa,
          s."GPAX_Onec"
      `,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listStudentCareConsiderations(id: string): Promise<StudentCareConsiderationRow[]> {
    const result = await this.query<StudentCareConsiderationRow>(
      `
        SELECT 'DISADVANTAGE'::text AS care_kind, option.code, option.label_th,
          relation.recorded_at::text
        FROM student_term_disadvantages relation
        JOIN disadvantage_types option
          ON option.code = relation.disadvantage_type_code
        WHERE relation.student_uuid = $1 AND option.is_active = TRUE

        UNION ALL

        SELECT 'DISABILITY'::text AS care_kind, option.code, option.label_th,
          relation.recorded_at::text
        FROM student_disabilities relation
        JOIN disability_types option
          ON option.code = relation.disability_type_code
        WHERE relation.student_uuid = $1 AND option.is_active = TRUE

        ORDER BY care_kind, label_th, code
      `,
      [id],
    );
    return result.rows;
  }

  async listStudentAttendanceCalendar(id: string): Promise<StudentAttendanceCalendarRow[]> {
    const result = await this.query<StudentAttendanceCalendarRow>(
      `
        WITH subject_days AS (
          SELECT
            attendance."AttendanceDate"::text AS date,
            COUNT(*) FILTER (
              WHERE attendance."AttendanceStatus" <> 4
            )::int AS measured_periods,
            COUNT(*) FILTER (
              WHERE attendance."AttendanceStatus" IN (1, 3)
            )::int AS attended_periods
          FROM student_term s
          JOIN attendance_effective_records attendance
            ON attendance.student_uuid = s.student_uuid
           AND attendance.session_kind = 'SUBJECT'
           AND attendance."AcademicYear_Onec" = s."AcademicYear_Onec"
           AND attendance."Semester_Onec" = s."Semester_Onec"
          JOIN attendance_sessions attendance_session
            ON attendance_session.id = attendance.session_id
          JOIN school_calendar_days calendar_day
            ON calendar_day.school_term_id = attendance_session.school_term_id
           AND calendar_day.calendar_date = attendance_session.attendance_date
           AND calendar_day.day_type = 'SCHOOL_DAY'
           AND calendar_day.deleted_at IS NULL
          WHERE s.student_uuid = $1
          GROUP BY attendance."AttendanceDate"
        )
        SELECT
          date,
          CASE
            WHEN attended_periods = measured_periods THEN 'ALL_PERIODS'
            WHEN attended_periods = 0 THEN 'NO_PERIODS'
            ELSE 'SOME_PERIODS'
          END AS attendance_category,
          CASE
            WHEN attended_periods = measured_periods THEN 'เข้าทุกคาบ'
            WHEN attended_periods = 0 THEN 'ไม่เข้าเรียน'
            ELSE 'เข้าบางคาบ'
          END AS attendance_category_label,
          CASE
            WHEN attended_periods = measured_periods THEN 1
            WHEN attended_periods = 0 THEN 2
            ELSE 3
          END AS status_code,
          CASE
            WHEN attended_periods = measured_periods THEN 'ALL_PERIODS'
            WHEN attended_periods = 0 THEN 'NO_PERIODS'
            ELSE 'SOME_PERIODS'
          END AS status_internal_code,
          CASE
            WHEN attended_periods = measured_periods THEN 'เข้าทุกคาบ'
            WHEN attended_periods = 0 THEN 'ไม่เข้าเรียน'
            ELSE 'เข้าบางคาบ'
          END AS status_label,
          CASE
            WHEN attended_periods = measured_periods THEN 'success'
            WHEN attended_periods = 0 THEN 'danger'
            ELSE 'warning'
          END AS status_badge_variant
        FROM subject_days
        WHERE measured_periods > 0
        ORDER BY date ASC
      `,
      [id],
    );
    return result.rows;
  }

  async listStudentSubjectAttendanceByDate(
    id: string,
    date: string,
  ): Promise<StudentSubjectAttendanceRow[]> {
    const result = await this.query<StudentSubjectAttendanceRow>(
      `
        SELECT
          attendance."AttendanceDate"::text AS date,
          subject.code AS subject_code,
          subject.name_th AS subject_name,
          status.code AS status_code,
          status.internal_code AS status_internal_code,
          status.label_th AS status_label,
          status.badge_variant AS status_badge_variant,
          attendance."RecordedAt" AS recorded_at,
          attendance_session.checking_started_at,
          attendance_session.submitted_at,
          COALESCE(
            NULLIF(BTRIM(CONCAT_WS(' ', recorder.first_name, recorder.last_name)), ''),
            NULLIF(BTRIM(CONCAT_WS(' ', recorder_user."FirstName", recorder_user."LastName")), ''),
            CASE
              WHEN attendance."RecordedBy" LIKE '%@%' THEN NULL
              ELSE NULLIF(attendance."RecordedBy", '')
            END
          ) AS recorded_by
        FROM student_term s
        JOIN attendance_effective_records attendance
          ON attendance.student_uuid = s.student_uuid
         AND attendance.session_kind = 'SUBJECT'
         AND attendance."AcademicYear_Onec" = s."AcademicYear_Onec"
         AND attendance."Semester_Onec" = s."Semester_Onec"
        JOIN attendance_record_statuses status
          ON status.code = attendance."AttendanceStatus"
        JOIN attendance_sessions attendance_session
          ON attendance_session.id = attendance.session_id
        JOIN school_calendar_days calendar_day
          ON calendar_day.school_term_id = attendance_session.school_term_id
         AND calendar_day.calendar_date = attendance_session.attendance_date
         AND calendar_day.day_type = 'SCHOOL_DAY'
         AND calendar_day.deleted_at IS NULL
        LEFT JOIN subjects subject
          ON subject.id = attendance.subject_id
        LEFT JOIN teachers recorder ON recorder.id = attendance.recorded_by_teacher_id
        LEFT JOIN users recorder_user ON recorder_user.username = attendance."RecordedBy"
        WHERE s.student_uuid = $1
          AND attendance."AttendanceDate" = $2::date
        ORDER BY attendance_session.checking_started_at ASC NULLS LAST,
                 attendance_session.submitted_at ASC NULLS LAST,
                 subject.name_th ASC NULLS LAST, subject.code ASC NULLS LAST,
                 attendance."AttendanceID" ASC
      `,
      [id, date],
    );
    return result.rows;
  }
}
