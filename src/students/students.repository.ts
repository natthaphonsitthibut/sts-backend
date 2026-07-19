import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildDataScopeQuery, type DataScope } from '../common/utils/authorization';
import { queryDataSource } from '../database/sql-query';
import type {
  PiiAccessEventInput,
  StudentAttendanceRow,
  StudentCaseRow,
  StudentDetailRow,
  StudentAccountSummaryRow,
  StudentFilterOptions,
  StudentGuardianRow,
  StudentListFilters,
  StudentListResult,
  StudentListRow,
  StudentsQueryResult,
  StudentPersonContactRow,
} from './students.types';
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
          COALESCE(ss.category, 'UNMAPPED') as student_status_category,
          COALESCE(ss.badge_variant, 'warning') as student_status_badge_variant
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
        gl.label as grade,
        s."RoomID_Onec"::text as room,
        sc.name as school_name,
        COALESCE(ss.label_th, 'ยังไม่ได้จับคู่') as student_status_label,
        COALESCE(ss.category, 'UNMAPPED') as student_status_category,
        COALESCE(ss.badge_variant, 'warning') as student_status_badge_variant,
        -- Latest home-visit case pin wins (most recent on-the-ground
        -- observation); falls back to the student's own confirmed profile
        -- coordinate (student_term.address_latitude/longitude, set via the
        -- edit form) — mirrors field-monitor-map.repository.ts's priority.
        COALESCE(latest_case.student_lat, s.address_latitude) AS resolved_home_lat,
        COALESCE(latest_case.student_lng, s.address_longitude) AS resolved_home_lng
      FROM student_term s
      LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
      LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
      LEFT JOIN student_status ss
        ON ss.code = COALESCE(s.student_status_code, s."StudentStatusID_Onec")
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
    delete (row as Record<string, unknown>).student_status_code;
    return row;
  }

  /**
   * Resolve the canonical person that owns an enrollment snapshot. Used by
   * own-access checks so a student reaches every enrollment of their own person,
   * not only the current-term snapshot they logged in with. Returns null if the
   * snapshot is unknown or not yet linked (person_uuid is nullable until B2
   * CONTRACT).
   */
  async findPersonUuidByStudentUuid(studentUuid: string): Promise<string | null> {
    const result = await this.query<{ person_uuid: string | null }>(
      `SELECT person_uuid FROM student_term WHERE student_uuid = $1 LIMIT 1`,
      [studentUuid],
    );
    return result.rows[0]?.person_uuid ?? null;
  }

  async updateStudentByUuid(
    studentUuid: string,
    data: Omit<UpdateStudentDto, 'contact' | 'guardians'>,
  ): Promise<void> {
    const columnByField: Record<keyof Omit<UpdateStudentDto, 'contact' | 'guardians'>, string> = {
      FirstName_Onec: '"FirstName_Onec"',
      MiddleName_Onec: '"MiddleName_Onec"',
      LastName_Onec: '"LastName_Onec"',
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
    await this.query(
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

  /** Current account when present; otherwise the most recently created historical account. */
  async findStudentAccountByPersonUuid(
    personUuid: string,
  ): Promise<StudentAccountSummaryRow | null> {
    const result = await this.query<StudentAccountSummaryRow>(
      `
        SELECT id AS user_id, username, status, must_change_password,
          CASE
            WHEN status <> 'ACTIVE' THEN 'DISABLED'
            WHEN must_change_password IS TRUE
              AND temporary_password_expires_at IS NOT NULL
              AND temporary_password_expires_at <= NOW()
              THEN 'TEMP_PASSWORD_EXPIRED'
            WHEN must_change_password IS TRUE THEN 'PENDING_FIRST_LOGIN'
            ELSE 'ACTIVE'
          END AS lifecycle_status
        FROM users
        WHERE person_uuid = $1 AND role = 'STUDENT'
        ORDER BY (status = 'ACTIVE') DESC, created_at DESC, id DESC
        LIMIT 1
      `,
      [personUuid],
    );
    return result.rows[0] ?? null;
  }

  /** Live guardians of a person, primary first, then บิดา → มารดา → ผปค. */
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

  /**
   * Replace the person's guardian list in one transaction. Existing live rows
   * are soft-deleted (history stays queryable) and the submitted set is
   * inserted fresh — the form always sends the whole list.
   */
  async updateStudentPersonContacts(
    personUuid: string,
    contact: StudentContactDto | undefined,
    guardians: StudentGuardianInputDto[] | undefined,
    actorUserId: number | null,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
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

        // Expand/contract compatibility: keep a linked student account mirror
        // current while all downstream consumers move to person-level contact.
        await manager.query(
          `
            UPDATE users
            SET phone = CASE WHEN $5 THEN $2 ELSE phone END,
                email = CASE WHEN $6 THEN $3 ELSE email END,
                line_id = CASE WHEN $7 THEN $4 ELSE line_id END,
                updated_by = $8
            WHERE person_uuid = $1 AND role = 'STUDENT' AND status = 'ACTIVE'
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

  async findCasesByStudentName(name: string): Promise<StudentCaseRow[]> {
    const result = await this.query<StudentCaseRow>(
      `
        SELECT *
        FROM cases
        WHERE student_name = $1
          AND deleted_at IS NULL
      `,
      [name],
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
      JOIN attendance a ON a.student_uuid = s.student_uuid
      LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
      WHERE s.student_uuid = $1
        AND a.session_kind = 'DAILY'
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
}
