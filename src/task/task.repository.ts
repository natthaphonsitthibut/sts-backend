import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type { QueryExecutor, QueryResultLike, QueryResultRow, RoleDefinition } from './task.types';

interface CreateCaseInput {
  studentName: string;
  studentSchool: string | null;
  studentAddress: string | null;
  studentLat: number | null;
  studentLng: number | null;
  reasonFlagged: string | null;
  studentId: string | null;
  createdBy: number | null;
}

interface CreateTaskInput {
  taskId: string;
  caseId: number | null;
  taskType: string;
  targetGrade: string | null;
  targetRoom: string | null;
  targetSchoolId: number | null;
  createdBy: number | null;
}

interface CreateTaskLinkInput {
  linkId: string;
  taskId: string;
  parentLinkId: string | null;
  tokenHash: string;
  magicLink: string;
  delegationDepth: number;
  assignedToName: string;
  assignedToPhone: string | null;
  assignedToEmail: string | null;
  expiresAt: string;
  subject: string | null;
  otpVerified: number;
  createdBy: number | null;
  loginRole: string | null;
  loginPermissions: string[];
  loginDataScope: Record<string, unknown>;
}

interface TaskStudentFilters {
  targetGrade?: string | null;
  targetRoom?: string | null;
  targetSchoolId?: number | null;
}

interface TaskSubmissionInput {
  linkId: string;
  visitLat: number | null;
  visitLng: number | null;
  causeCategory: string | null;
  causeDetail: string | null;
  recommendation: string | null;
  photoPaths: string | null;
  addressChanged: boolean;
  updatedStudentAddress: string | null;
  updatedLat: number | null;
  updatedLng: number | null;
}

interface AttendanceReplaceInput {
  studentId: string;
  attendanceDate: string;
  attendanceStatus: number;
  recordedBy: string;
  schoolId: number;
  gradeLevelId: number;
  roomId: number;
  semester: number;
  academicYear: number;
}

interface CaseSubmissionUpdateInput {
  caseId: number;
  nextSummary: string;
  updatedStudentAddress: string | null;
  updatedLat: number | null;
  updatedLng: number | null;
}

interface TaskLinkOtpInput {
  linkId: string;
  otpCode: string;
  otpExpiresAt: string;
}

interface AdminLockUpdateInput {
  linkId: string;
  locked: boolean;
  reason?: string;
  lockedAt?: string | null;
}

interface CaseReviewInput {
  reviewId: string;
  caseId: number;
  reviewAction: string;
  reviewNote: string | null;
  reviewedBy: string;
}

interface CountRow extends QueryResultRow {
  count: number | string;
}

interface SettingValueRow extends QueryResultRow {
  setting_value?: unknown;
}

@Injectable()
export class TaskRepository {
  constructor(private readonly dataSource: DataSource) {}

  private normalizeScalar(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }

    return '';
  }

  private async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>> {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  async withTransaction<T>(callback: (executor: QueryExecutor) => Promise<T>): Promise<T> {
    return await withDataSourceTransaction(this.dataSource, async (executor) => {
      return await callback(executor);
    });
  }

  async getRoleDefinitions(): Promise<RoleDefinition[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT
        id,
        name,
        label,
        rank,
        default_permissions,
        scope_mode,
        is_system
      FROM roles
      ORDER BY rank DESC, name ASC
    `);

    return result.rows.map((row: QueryResultRow) => ({
      id: Number(row.id),
      name: this.normalizeScalar(row.name),
      label: this.normalizeScalar(row.label),
      rank: Number(row.rank) || 0,
      default_permissions: Array.isArray(row.default_permissions)
        ? row.default_permissions.filter(
            (permission: unknown): permission is string =>
              typeof permission === 'string' && permission.trim().length > 0,
          )
        : [],
      scope_mode: typeof row.scope_mode === 'string' ? row.scope_mode : 'flexible',
      is_system: row.is_system === true,
    }));
  }

  async findCaseById(caseId: number, executor?: QueryExecutor): Promise<QueryResultRow | null> {
    const result = await this.getExecutor(executor).query(
      `SELECT id FROM cases WHERE id = $1 LIMIT 1`,
      [caseId],
    );
    return result.rows[0] || null;
  }

  async createCase(data: CreateCaseInput, executor?: QueryExecutor): Promise<number> {
    const result = await this.getExecutor(executor).query(
      `
      INSERT INTO cases (
        student_name,
        student_school,
        student_address,
        student_lat,
        student_lng,
        reason_flagged,
        student_id,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      RETURNING id
    `,
      [
        data.studentName,
        data.studentSchool,
        data.studentAddress,
        data.studentLat,
        data.studentLng,
        data.reasonFlagged,
        data.studentId,
        data.createdBy,
      ],
    );

    return Number(result.rows[0]?.id);
  }

  async updateCaseStatus(caseId: number, status: string, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(`UPDATE cases SET status = $1 WHERE id = $2`, [
      status,
      caseId,
    ]);
  }

  async createTask(data: CreateTaskInput, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `
      INSERT INTO tasks (
        id,
        case_id,
        task_type,
        target_grade,
        target_room,
        status,
        target_school_id,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', $6, $7, $7)
    `,
      [
        data.taskId,
        data.caseId,
        data.taskType,
        data.targetGrade,
        data.targetRoom,
        data.targetSchoolId,
        data.createdBy,
      ],
    );
  }

  async createTaskLink(data: CreateTaskLinkInput, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `
      INSERT INTO task_links (
        id,
        task_id,
        parent_link_id,
        token_hash,
        magic_link,
        delegation_depth,
        assigned_to_name,
        assigned_to_phone,
        assigned_to_email,
        expires_at,
        subject,
        otp_verified,
        created_by,
        updated_by,
        login_role,
        login_permissions,
        login_data_scope
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $13,
        $14,
        $15,
        $16
      )
    `,
      [
        data.linkId,
        data.taskId,
        data.parentLinkId,
        data.tokenHash,
        data.magicLink,
        data.delegationDepth,
        data.assignedToName,
        data.assignedToPhone,
        data.assignedToEmail,
        data.expiresAt,
        data.subject,
        data.otpVerified,
        data.createdBy,
        data.loginRole,
        JSON.stringify(data.loginPermissions),
        JSON.stringify(data.loginDataScope),
      ],
    );
  }

  async findTaskLinkByTokenHash(tokenHash: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.*,
        t.task_type,
        t.target_grade,
        t.target_room,
        t.target_school_id,
        t.status AS task_status,
        t.max_delegation_depth,
        s.name AS school_name
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      LEFT JOIN schools s ON s.id = t.target_school_id
      WHERE tl.token_hash = $1
    `,
      [tokenHash],
    );

    return result.rows[0] || null;
  }

  async findCaseByTaskId(taskId: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT c.*
      FROM cases c
      JOIN tasks t ON t.case_id = c.id
      WHERE t.id = $1
    `,
      [taskId],
    );

    return result.rows[0] || null;
  }

  async listLoginLinks(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT
        tl.id,
        tl.task_id,
        tl.assigned_to_name,
        tl.assigned_to_email,
        tl.expires_at,
        tl.status,
        tl.magic_link,
        tl.admin_locked,
        tl.login_role,
        tl.login_permissions,
        tl.login_data_scope,
        tl.created_by,
        r.label AS login_role_label,
        t.created_at
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      LEFT JOIN roles r ON r.name = tl.login_role
      WHERE t.task_type = 'LOGIN'
      ORDER BY t.created_at DESC
    `);

    return result.rows;
  }

  async deleteTask(taskId: string): Promise<QueryResultLike> {
    return await this.query(`DELETE FROM tasks WHERE id = $1`, [taskId]);
  }

  async listTaskStudents(filters: TaskStudentFilters): Promise<QueryResultRow[]> {
    let query = `
      SELECT DISTINCT ON (s."PersonID_Onec")
        s."PersonID_Onec" AS id,
        (s."FirstName_Onec" || ' ' || s."LastName_Onec") AS name,
        COALESCE(gl.label, 'ไม่ทราบ') AS grade,
        s."RoomID_Onec"::text AS room
      FROM student_term s
      LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
    `;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (filters.targetGrade) {
      params.push(filters.targetGrade);
      conditions.push(`gl.label = $${params.length}`);
    }

    if (filters.targetRoom) {
      params.push(Number.parseInt(filters.targetRoom, 10));
      conditions.push(`s."RoomID_Onec" = $${params.length}`);
    }

    if (filters.targetSchoolId) {
      params.push(filters.targetSchoolId);
      conditions.push(`s."SchoolID_Onec" = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY s."PersonID_Onec" ASC`;

    const result = await this.query<QueryResultRow>(query, params);
    return result.rows;
  }

  async listTaskHistory(
    date: string,
    targetGrade: string | null,
    targetRoom: string | null,
    targetSchoolId: number | null,
  ): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT DISTINCT ON (a."PersonID_Onec")
        a."PersonID_Onec" AS student_id,
        (s."FirstName_Onec" || ' ' || s."LastName_Onec") AS student_name,
        a."AttendanceStatus" AS status
      FROM attendance a
      JOIN student_term s ON s."PersonID_Onec" = a."PersonID_Onec"
      WHERE a."AttendanceDate" = $1
        AND s."GradeLevelID_Onec" = (SELECT id FROM grade_levels WHERE label = $2)
        AND s."RoomID_Onec" = $3
        AND a."Period" = 1
        AND s."SchoolID_Onec" = $4
      ORDER BY a."PersonID_Onec" ASC
    `,
      [date, targetGrade, Number.parseInt(targetRoom || '0', 10), targetSchoolId],
    );

    return result.rows;
  }

  async findTaskChainTask(taskId: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        t.*,
        c.student_name,
        c.student_school,
        c.student_address,
        c.reason_flagged,
        c.status AS case_status,
        c.result_summary
      FROM tasks t
      LEFT JOIN cases c ON c.id = t.case_id
      WHERE t.id = $1
    `,
      [taskId],
    );

    return result.rows[0] || null;
  }

  async listTaskLinksByTaskId(taskId: string): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT tl.*
      FROM task_links tl
      WHERE tl.task_id = $1
      ORDER BY tl.delegation_depth ASC
    `,
      [taskId],
    );

    return result.rows;
  }

  async findTaskSubmissionByLinkId(linkId: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `SELECT * FROM task_submissions WHERE task_link_id = $1`,
      [linkId],
    );

    return result.rows[0] || null;
  }

  async findTaskSubmissionContextByTokenHash(tokenHash: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.id AS link_id,
        t.id AS task_id,
        t.case_id,
        t.task_type
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      WHERE tl.token_hash = $1
    `,
      [tokenHash],
    );

    return result.rows[0] || null;
  }

  async insertTaskSubmission(data: TaskSubmissionInput, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `
      INSERT INTO task_submissions (
        task_link_id,
        visit_lat,
        visit_lng,
        cause_category,
        cause_detail,
        recommendation,
        photo_paths,
        address_changed,
        updated_student_address,
        updated_lat,
        updated_lng
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
      [
        data.linkId,
        data.visitLat,
        data.visitLng,
        data.causeCategory,
        data.causeDetail,
        data.recommendation,
        data.photoPaths,
        data.addressChanged,
        data.updatedStudentAddress,
        data.updatedLat,
        data.updatedLng,
      ],
    );
  }

  async updateCaseAfterSubmission(
    data: CaseSubmissionUpdateInput,
    executor?: QueryExecutor,
  ): Promise<void> {
    if (data.updatedStudentAddress) {
      await this.getExecutor(executor).query(
        `
        UPDATE cases
        SET
          status = $1,
          result_summary = $2,
          student_address = $3,
          student_lat = COALESCE($4, student_lat),
          student_lng = COALESCE($5, student_lng)
        WHERE id = $6
      `,
        [
          'PENDING_REVIEW',
          data.nextSummary,
          data.updatedStudentAddress,
          data.updatedLat,
          data.updatedLng,
          data.caseId,
        ],
      );
      return;
    }

    await this.getExecutor(executor).query(
      `UPDATE cases SET status = $1, result_summary = $2 WHERE id = $3`,
      ['PENDING_REVIEW', data.nextSummary, data.caseId],
    );
  }

  async updateTaskStatus(taskId: string, status: string, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(`UPDATE tasks SET status = $1 WHERE id = $2`, [
      status,
      taskId,
    ]);
  }

  async updateTaskLinkStatus(
    linkId: string,
    status: string,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.getExecutor(executor).query(`UPDATE task_links SET status = $1 WHERE id = $2`, [
      status,
      linkId,
    ]);
  }

  async findStudentTermMetadata(
    studentId: string,
    executor?: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    const result = await this.getExecutor(executor).query(
      `
      SELECT
        "SchoolID_Onec",
        "GradeLevelID_Onec",
        "RoomID_Onec",
        "Semester_Onec",
        "AcademicYear_Onec"
      FROM student_term
      WHERE "PersonID_Onec" = $1
    `,
      [studentId],
    );

    return result.rows[0] || null;
  }

  async replaceAttendanceRecord(
    data: AttendanceReplaceInput,
    executor?: QueryExecutor,
  ): Promise<void> {
    const queryExecutor = this.getExecutor(executor);

    await queryExecutor.query(
      `
      DELETE FROM attendance
      WHERE "AttendanceDate" = $1 AND "PersonID_Onec" = $2
    `,
      [data.attendanceDate, data.studentId],
    );

    await queryExecutor.query(
      `
      INSERT INTO attendance (
        "PersonID_Onec",
        "SchoolID_Onec",
        "GradeLevelID_Onec",
        "RoomID_Onec",
        "AttendanceDate",
        "Semester_Onec",
        "AcademicYear_Onec",
        "AttendanceStatus",
        "Period",
        "RecordedBy"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
      [
        data.studentId,
        data.schoolId,
        data.gradeLevelId,
        data.roomId,
        data.attendanceDate,
        data.semester,
        data.academicYear,
        data.attendanceStatus,
        1,
        data.recordedBy,
      ],
    );
  }

  async getSystemSettingValue(settingKey: string): Promise<string | null> {
    const result = await this.query<SettingValueRow>(
      `SELECT setting_value FROM system_settings WHERE setting_key = $1`,
      [settingKey],
    );

    if (!result.rowCount || result.rowCount <= 0) {
      return null;
    }

    const value = result.rows[0]?.setting_value;
    return this.normalizeScalar(value) || null;
  }

  async findOtpLinkByTokenHash(tokenHash: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        id,
        assigned_to_email,
        otp_code,
        otp_expires_at
      FROM task_links
      WHERE token_hash = $1
    `,
      [tokenHash],
    );

    return result.rows[0] || null;
  }

  async updateLinkOtp(data: TaskLinkOtpInput, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `
      UPDATE task_links
      SET otp_code = $1, otp_expires_at = $2, otp_verified = 0
      WHERE id = $3
    `,
      [data.otpCode, data.otpExpiresAt, data.linkId],
    );
  }

  async findTaskLinkById(linkId: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.*,
        t.task_type,
        t.target_grade,
        t.target_room,
        t.target_school_id
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      WHERE tl.id = $1
    `,
      [linkId],
    );

    return result.rows[0] || null;
  }

  async updateAdminLockState(data: AdminLockUpdateInput, executor?: QueryExecutor): Promise<void> {
    if (data.locked) {
      await this.getExecutor(executor).query(
        `
        UPDATE task_links
        SET admin_locked = 1, admin_lock_reason = $1, admin_lock_at = $2
        WHERE id = $3
      `,
        [data.reason || null, data.lockedAt || null, data.linkId],
      );
      return;
    }

    await this.getExecutor(executor).query(
      `
      UPDATE task_links
      SET admin_locked = 0, admin_lock_reason = NULL, admin_lock_at = NULL
      WHERE id = $1
    `,
      [data.linkId],
    );
  }

  async listCasesWithActiveLinks(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT
        c.*,
        student_match.student_id,
        t.id AS task_id,
        tl.id AS active_link_id,
        tl.magic_link AS active_link,
        tl.admin_locked AS active_link_locked,
        tl.admin_lock_reason AS active_link_lock_reason,
        tl.expires_at AS active_link_expires_at,
        tl.assigned_to_name AS active_link_assigned_to,
        tl.delegation_depth AS active_link_depth,
        COALESCE(link_state_snapshot.link_state, 'NONE') AS link_state
      FROM cases c
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN COUNT(*) = 1 THEN MAX(candidate."PersonID_Onec")
            ELSE NULL
          END AS student_id
        FROM (
          SELECT DISTINCT s."PersonID_Onec"
          FROM student_term s
          LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
          WHERE LOWER(TRIM(CONCAT_WS(' ', s."FirstName_Onec", s."LastName_Onec"))) = LOWER(TRIM(c.student_name))
            AND (
              NULLIF(TRIM(COALESCE(c.student_school, '')), '') IS NULL
              OR LOWER(COALESCE(sc.name, '')) = LOWER(COALESCE(c.student_school, ''))
            )
        ) candidate
      ) student_match ON true
      LEFT JOIN tasks t ON t.case_id = c.id
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN latest_active_link.admin_locked = 1 THEN 'LOCKED'
            WHEN latest_active_link.expires_at <= NOW() THEN 'EXPIRED'
            ELSE 'ACTIVE'
          END AS link_state
        FROM task_links latest_active_link
        WHERE latest_active_link.task_id = t.id
          AND latest_active_link.status = 'ACTIVE'
        ORDER BY latest_active_link.delegation_depth DESC, latest_active_link.created_at DESC
        LIMIT 1
      ) link_state_snapshot ON true
      LEFT JOIN LATERAL (
        SELECT *
        FROM task_links
        WHERE task_id = t.id
          AND status = 'ACTIVE'
          AND expires_at > NOW()
        ORDER BY delegation_depth DESC
        LIMIT 1
      ) tl ON true
      ORDER BY c.created_at DESC
    `);

    return result.rows;
  }

  async countCases(status?: string): Promise<number> {
    const result = status
      ? await this.query<CountRow>(`SELECT count(*) FROM cases WHERE status = $1`, [status])
      : await this.query<CountRow>(`SELECT count(*) FROM cases`);

    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async countCasesCreatedOn(date: string): Promise<number> {
    const result = await this.query<CountRow>(
      `SELECT count(*) FROM cases WHERE created_at::date = $1`,
      [date],
    );
    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async countActiveTaskLinks(): Promise<number> {
    const result = await this.query<CountRow>(
      `SELECT count(*) FROM task_links WHERE status = 'ACTIVE' AND expires_at > NOW()`,
    );
    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async countStudents(): Promise<number> {
    const result = await this.query<CountRow>(`SELECT count(*) FROM student_term`);
    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async countStudentDropouts(): Promise<number> {
    const result = await this.query<CountRow>(`SELECT count(*) FROM student_dropouts`);
    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async findDelegationLinkByTokenHash(tokenHash: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.*,
        t.max_delegation_depth
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      WHERE tl.token_hash = $1
    `,
      [tokenHash],
    );

    return result.rows[0] || null;
  }

  async createDelegatedTaskLink(
    data: CreateTaskLinkInput,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.createTaskLink(data, executor);
  }

  async insertCaseReview(data: CaseReviewInput, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `
      INSERT INTO case_reviews (id, case_id, review_action, review_note, reviewed_by)
      VALUES ($1, $2, $3, $4, $5)
    `,
      [data.reviewId, data.caseId, data.reviewAction, data.reviewNote, data.reviewedBy],
    );
  }

  async findCaseReviewById(reviewId: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT *
      FROM case_reviews
      WHERE id = $1
      LIMIT 1
    `,
      [reviewId],
    );

    return result.rows[0] || null;
  }

  async listTasksByCase(caseId: number): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        t.id AS task_id,
        t.created_at,
        tl.assigned_to_name AS initial_assignee,
        (SELECT COUNT(*) FROM task_links WHERE task_id = t.id) AS link_count,
        EXISTS(
          SELECT 1
          FROM task_links tl2
          JOIN task_submissions ts ON ts.task_link_id = tl2.id
          WHERE tl2.task_id = t.id
        ) AS has_submission
      FROM tasks t
      LEFT JOIN task_links tl ON tl.task_id = t.id AND tl.delegation_depth = 0
      WHERE t.case_id = $1
      ORDER BY t.created_at ASC
    `,
      [caseId],
    );

    return result.rows;
  }

  async listCaseReviews(caseId: number): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT *
      FROM case_reviews
      WHERE case_id = $1
      ORDER BY reviewed_at DESC
    `,
      [caseId],
    );

    return result.rows;
  }

  private getExecutor(executor?: QueryExecutor): QueryExecutor {
    if (executor) {
      return executor;
    }

    return {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => {
        return await this.query<T>(sql, params);
      },
    };
  }
}
