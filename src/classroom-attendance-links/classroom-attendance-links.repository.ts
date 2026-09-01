import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type {
  ClassroomLinkLineDeliveryFailureCode,
  ClassroomLinkListRow,
  ClassroomLinkRow,
  ExternalTeacherRow,
} from './classroom-attendance-links.types';

/**
 * Advisory-lock namespace for "one usable assignment link per lesson". Any
 * distinct constant works; it only has to differ from other advisory locks.
 */
const CLASSROOM_ASSIGNMENT_LOCK_NAMESPACE = 4210;

@Injectable()
export class ClassroomAttendanceLinksRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The signed-in link teacher's own photo. Scoped by the school the link
   * belongs to so a session can only ever ask for the teacher it signed in as.
   */
  async findTeacherPhotoStorageKey(teacherId: string, schoolId: number): Promise<string | null> {
    const result = await queryDataSource<{ photo_storage_key: string | null }>(
      this.dataSource,
      `
        SELECT teacher.photo_storage_key
        FROM teachers teacher
        JOIN school_teacher_memberships membership
          ON membership.teacher_id = teacher.id
         AND membership.school_id = $2
         AND membership.membership_status = 'ACTIVE'
         AND membership.deleted_at IS NULL
        WHERE teacher.id = $1
        LIMIT 1
      `,
      [teacherId, schoolId],
    );
    return result.rows[0]?.photo_storage_key ?? null;
  }

  async withTransaction<T>(work: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const result = await work(runner);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  private linkSelect(): string {
    return `
      SELECT link.id::text, link.school_id, school.name AS school_name,
             link.school_term_id::text, term.academic_year, term.semester,
             term.status AS term_status,
             link.token_hash, link.token_encrypted,
             link.link_status, link.issued_at, link.rotated_at, link.last_used_at,
             link.teacher_membership_id::text,
             TRIM(teacher.first_name || ' ' || teacher.last_name) AS teacher_name,
             link.assigned_classroom_id::text,
             link.assigned_classroom_subject_id::text,
             link.issued_by_teacher_membership_id::text,
             link.source_teacher_link_id::text,
             link.created_by,
             link.opens_at, link.expires_at, link.assignment_note,
             assigned_grade.label || '/' || assigned_classroom.room_code AS assigned_classroom_label,
             assigned_subject.name_th AS assigned_subject_name,
             -- How many rooms the link opens onto, from the subjects this
             -- teacher was assigned. Counted here so a row never costs a query.
             COALESCE(taught.classroom_count, 0)::int AS classroom_count,
             line_account.provider_user_id AS line_provider_user_id,
             line_account.friend_state AS line_friend_state,
             link.line_delivery_teacher_membership_id::text,
             link.line_delivery_status, link.line_delivery_failure_code,
             link.line_delivery_attempt_count, link.line_delivery_request_id::text,
             link.line_delivery_last_attempted_at, link.line_delivered_at
      FROM classroom_attendance_links link
      JOIN schools school ON school.id = link.school_id
      JOIN school_terms term
        ON term.id = link.school_term_id AND term.school_id = link.school_id
      LEFT JOIN school_teacher_memberships membership
        ON membership.id = link.teacher_membership_id
       AND membership.school_id = link.school_id
      LEFT JOIN school_classrooms assigned_classroom
        ON assigned_classroom.id = link.assigned_classroom_id
       AND assigned_classroom.school_id = link.school_id
      LEFT JOIN grade_levels assigned_grade
        ON assigned_grade.id = assigned_classroom.grade_level_id
      LEFT JOIN classroom_subjects assigned_offering
        ON assigned_offering.id = link.assigned_classroom_subject_id
      LEFT JOIN school_subjects assigned_school_subject
        ON assigned_school_subject.id = assigned_offering.school_subject_id
      LEFT JOIN subjects assigned_subject
        ON assigned_subject.id = assigned_school_subject.subject_id
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT assignment.classroom_id) AS classroom_count
        FROM classroom_subject_teachers assignment
        JOIN school_classrooms classroom
          ON classroom.id = assignment.classroom_id
         AND classroom.school_id = assignment.school_id
        WHERE assignment.teacher_membership_id = link.teacher_membership_id
          AND classroom.school_term_id = link.school_term_id
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.deleted_at IS NULL
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
      ) taught ON TRUE
      LEFT JOIN teachers teacher
        ON teacher.id = membership.teacher_id
       AND teacher.teacher_status = 'ACTIVE'
       AND teacher.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT account.provider_user_id, account.friend_state
        FROM teacher_messaging_accounts account
        WHERE account.teacher_id = teacher.id
          AND account.provider = 'LINE'
          AND account.unlinked_at IS NULL
          AND account.deleted_at IS NULL
        ORDER BY account.verified_at DESC, account.id DESC
        LIMIT 1
      ) line_account ON TRUE
    `;
  }

  async findActiveSchoolInScope(
    schoolId: number,
    scope: DataScope,
  ): Promise<{ id: number; name: string } | null> {
    const scopeQuery = buildDataScopeQuery(
      scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'classroom.grade_level_id',
        room: 'classroom.legacy_room_number',
      },
      2,
    );
    const result = await queryDataSource<{ id: number; name: string }>(
      this.dataSource,
      `SELECT school.id, school.name
       FROM schools school
       WHERE school.id = $1
         AND school.school_status = 'ACTIVE'
         AND ${scopeQuery.sql || 'TRUE'}
       LIMIT 1`,
      [schoolId, ...scopeQuery.params],
    );
    return result.rows[0] ?? null;
  }

  /**
   * One row per teacher who teaches in this term, with their link if it exists.
   *
   * The listing is teacher-first because the link is: a room no longer has one
   * of its own. Teachers with no subject assignment are left out rather than
   * shown link-less — they have nothing to check, so a link for them would open
   * onto an empty page.
   */
  async list(input: {
    schoolId: number;
    schoolTermId: number;
    search?: string;
    gradeLevelId?: number;
    linkStatus?: 'ACTIVE' | 'INACTIVE' | 'NOT_CREATED';
    page: number;
    limit: number;
    scope: DataScope;
  }): Promise<{ rows: ClassroomLinkListRow[]; total: number }> {
    const params: unknown[] = [input.schoolId, input.schoolTermId];
    const conditions = [
      'membership.school_id = $1',
      "membership.membership_status = 'ACTIVE'",
      'membership.deleted_at IS NULL',
      'term.id = $2',
      'term.deleted_at IS NULL',
      // Teaching something in this term is what makes a teacher listable.
      `EXISTS (
        SELECT 1
        FROM classroom_subject_teachers assignment
        JOIN school_classrooms classroom
          ON classroom.id = assignment.classroom_id
         AND classroom.school_id = assignment.school_id
        WHERE assignment.teacher_membership_id = membership.id
          AND classroom.school_term_id = term.id
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.deleted_at IS NULL
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
      )`,
    ];
    const scope = buildDataScopeQuery(
      input.scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'classroom.grade_level_id',
        room: 'classroom.legacy_room_number',
      },
      params.length + 1,
    );
    conditions.push(scope.sql || 'TRUE');
    params.push(...scope.params);
    if (input.gradeLevelId) {
      params.push(input.gradeLevelId);
      // A grade filter narrows to teachers who teach that grade, not to rows.
      conditions.push(`EXISTS (
        SELECT 1
        FROM classroom_subject_teachers grade_assignment
        JOIN school_classrooms grade_classroom
          ON grade_classroom.id = grade_assignment.classroom_id
         AND grade_classroom.school_id = grade_assignment.school_id
        WHERE grade_assignment.teacher_membership_id = membership.id
          AND grade_classroom.school_term_id = term.id
          AND grade_classroom.grade_level_id = $${params.length}
          AND grade_assignment.assignment_status = 'ACTIVE'
          AND grade_assignment.deleted_at IS NULL
      )`);
    }
    if (input.linkStatus) {
      if (input.linkStatus === 'NOT_CREATED') {
        conditions.push('link.id IS NULL');
      } else if (input.linkStatus === 'ACTIVE') {
        conditions.push(`(
          link.link_status = 'ACTIVE'
          AND school.school_status = 'ACTIVE'
          AND term.status = 'ACTIVE'
        )`);
      } else {
        conditions.push(`(
          link.id IS NOT NULL
          AND NOT (
            link.link_status = 'ACTIVE'
            AND school.school_status = 'ACTIVE'
            AND term.status = 'ACTIVE'
          )
        )`);
      }
    }
    if (input.search) {
      params.push(`%${input.search.replace(/[\\%_]/g, (value) => `\\${value}`)}%`);
      conditions.push(
        `TRIM(teacher.first_name || ' ' || teacher.last_name) ILIKE $${params.length} ESCAPE '\\'`,
      );
    }
    params.push(input.limit, (input.page - 1) * input.limit);
    const listFrom = `
      FROM school_teacher_memberships membership
      JOIN schools school ON school.id = membership.school_id
      JOIN school_terms term ON term.school_id = membership.school_id
      JOIN teachers teacher
        ON teacher.id = membership.teacher_id
       AND teacher.teacher_status = 'ACTIVE'
       AND teacher.deleted_at IS NULL
      LEFT JOIN classroom_attendance_links link
        ON link.teacher_membership_id = membership.id
       AND link.school_term_id = term.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(DISTINCT assignment.classroom_id)::int AS classroom_count,
          COALESCE(
            jsonb_agg(DISTINCT jsonb_build_object(
              'classroomId', classroom.id::text,
              'label', grade.label || '/' || classroom.room_code
            )), '[]'::jsonb
          ) AS classrooms
        FROM classroom_subject_teachers assignment
        JOIN school_classrooms classroom
          ON classroom.id = assignment.classroom_id
         AND classroom.school_id = assignment.school_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        WHERE assignment.teacher_membership_id = membership.id
          AND classroom.school_term_id = term.id
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.deleted_at IS NULL
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
      ) taught ON TRUE
      LEFT JOIN LATERAL (
        SELECT account.provider_user_id, account.friend_state
        FROM teacher_messaging_accounts account
        WHERE account.teacher_id = teacher.id
          AND account.provider = 'LINE'
          AND account.unlinked_at IS NULL
          AND account.deleted_at IS NULL
        ORDER BY account.verified_at DESC, account.id DESC
        LIMIT 1
      ) line_account ON TRUE`;
    const result = await queryDataSource<ClassroomLinkListRow>(
      this.dataSource,
      `SELECT link.id::text, membership.school_id, school.name AS school_name,
              school.school_status,
              term.id::text AS school_term_id, term.academic_year, term.semester,
              term.status AS term_status,
              membership.id::text AS teacher_membership_id,
              teacher.id::text AS teacher_id,
              TRIM(teacher.first_name || ' ' || teacher.last_name) AS teacher_name,
              (teacher.photo_storage_key IS NOT NULL) AS teacher_has_photo,
              COALESCE(taught.classroom_count, 0) AS classroom_count,
              COALESCE(taught.classrooms, '[]'::jsonb) AS classrooms,
              link.token_hash, link.token_encrypted,
              link.link_status, link.issued_at, link.rotated_at, link.last_used_at,
              line_account.provider_user_id AS line_provider_user_id,
              line_account.friend_state AS line_friend_state,
              link.line_delivery_teacher_membership_id::text,
              COALESCE(link.line_delivery_status, 'NOT_READY') AS line_delivery_status,
              link.line_delivery_failure_code,
              COALESCE(link.line_delivery_attempt_count, 0) AS line_delivery_attempt_count,
              link.line_delivery_request_id::text,
              link.line_delivery_last_attempted_at, link.line_delivered_at
       ${listFrom}
       WHERE ${conditions.join(' AND ')}
       ORDER BY teacher.first_name, teacher.last_name, membership.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const count = await queryDataSource<{ count: number | string }>(
      this.dataSource,
      `SELECT count(*) AS count
       ${listFrom}
       WHERE ${conditions.join(' AND ')}`,
      params.slice(0, -2),
    );
    return {
      rows: result.rows,
      total: Number.parseInt(String(count.rows[0]?.count ?? '0'), 10),
    };
  }

  /**
   * Teachers a link may be issued to, locked for the write.
   *
   * A teacher qualifies by teaching something: at least one live subject
   * assignment in a classroom of this term. That is the same fact the link's
   * "ห้องเรียนของฉัน" reads, so a link can never be issued to someone who would
   * open it onto an empty list.
   */
  async lockEligibleTeachers(
    input: {
      schoolId: number;
      schoolTermId: number;
      teacherMembershipIds?: number[];
      scope: DataScope;
    },
    runner: QueryRunner,
  ): Promise<Array<{ teacher_membership_id: string }>> {
    const params: unknown[] = [input.schoolId, input.schoolTermId];
    const conditions = [
      "school.school_status = 'ACTIVE'",
      "term.status = 'ACTIVE'",
      "classroom.classroom_status = 'ACTIVE'",
      "membership.membership_status = 'ACTIVE'",
      "assignment.assignment_status = 'ACTIVE'",
      'term.deleted_at IS NULL',
      'classroom.deleted_at IS NULL',
      'membership.deleted_at IS NULL',
      'assignment.deleted_at IS NULL',
    ];
    if (input.teacherMembershipIds) {
      params.push(input.teacherMembershipIds);
      conditions.push(`membership.id = ANY($${params.length}::bigint[])`);
    }
    const scope = buildDataScopeQuery(
      input.scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'classroom.grade_level_id',
        room: 'classroom.legacy_room_number',
      },
      params.length + 1,
    );
    params.push(...scope.params);
    // The scope names classroom columns (grade, room), which only exist inside
    // the EXISTS — leaving it outside made Postgres reject the whole statement.
    const insideExists = [
      ...conditions.filter(
        (condition) => condition.startsWith('classroom.') || condition.startsWith('assignment.'),
      ),
      scope.sql || 'TRUE',
    ];
    const outsideExists = conditions.filter(
      (condition) => !condition.startsWith('classroom.') && !condition.startsWith('assignment.'),
    );
    const result = await createSqlQueryExecutor(runner).query<{
      teacher_membership_id: string;
    }>(
      // Selected from the memberships themselves with EXISTS rather than
      // DISTINCT over a join: Postgres refuses FOR UPDATE alongside DISTINCT,
      // and the lock is the point — two admins issuing links at once must not
      // both pass the "already has one?" check.
      `SELECT membership.id::text AS teacher_membership_id
       FROM school_teacher_memberships membership
       JOIN schools school ON school.id = membership.school_id
       JOIN school_terms term
         ON term.school_id = membership.school_id AND term.id = $2
       WHERE membership.school_id = $1
         AND EXISTS (
           SELECT 1
           FROM classroom_subject_teachers assignment
           JOIN school_classrooms classroom
             ON classroom.id = assignment.classroom_id
            AND classroom.school_id = assignment.school_id
           WHERE assignment.teacher_membership_id = membership.id
             AND classroom.school_term_id = term.id
             AND ${insideExists.join(' AND ')}
         )
         AND ${outsideExists.join(' AND ')}
       ORDER BY membership.id
       LIMIT 501
       FOR UPDATE OF membership`,
      params,
    );
    return result.rows;
  }

  async upsertLinks(
    inputs: Array<{
      schoolId: number;
      schoolTermId: number;
      teacherMembershipId: number;
      tokenHash: string;
      tokenEncrypted: string;
      actorId: number;
    }>,
    runner: QueryRunner,
  ): Promise<ClassroomLinkRow[]> {
    if (inputs.length === 0) return [];
    await createSqlQueryExecutor(runner).query(
      `INSERT INTO classroom_attendance_links (
         school_id, school_term_id, teacher_membership_id, token_hash, token_encrypted,
         link_status, issued_at, rotated_at, created_by, updated_by
       )
       SELECT input.school_id, input.school_term_id, input.teacher_membership_id,
              input.token_hash, input.token_encrypted,
              'ACTIVE', now(), NULL, input.actor_id, input.actor_id
       FROM jsonb_to_recordset($1::jsonb) AS input(
         school_id integer,
         school_term_id bigint,
         teacher_membership_id bigint,
         token_hash text,
         token_encrypted text,
         actor_id bigint
       )
       -- Re-issuing a teacher's link for the term rotates the token in place
       -- rather than adding a second live link beside it.
       -- The predicate has to match the partial index exactly, including the
       -- NOT NULL that keeps assignments out of it.
       ON CONFLICT (school_term_id, teacher_membership_id)
       WHERE link_status = 'ACTIVE' AND teacher_membership_id IS NOT NULL
       DO UPDATE
       SET token_hash = EXCLUDED.token_hash,
           token_encrypted = EXCLUDED.token_encrypted,
           link_status = 'ACTIVE',
           issued_at = now(), rotated_at = now(), last_used_at = NULL,
           line_delivery_teacher_membership_id = NULL,
           line_delivery_status = 'NOT_READY',
           line_delivery_failure_code = NULL,
           line_delivery_attempt_count = 0,
           line_delivery_request_id = NULL,
           line_delivery_last_attempted_at = NULL,
           line_delivered_at = NULL,
           updated_by = EXCLUDED.updated_by`,
      [
        JSON.stringify(
          inputs.map((input) => ({
            school_id: input.schoolId,
            school_term_id: input.schoolTermId,
            teacher_membership_id: input.teacherMembershipId,
            token_hash: input.tokenHash,
            token_encrypted: input.tokenEncrypted,
            actor_id: input.actorId,
          })),
        ),
      ],
    );
    const rows = await createSqlQueryExecutor(runner).query<ClassroomLinkRow>(
      `${this.linkSelect()} WHERE link.teacher_membership_id = ANY($1::bigint[])
         AND link.school_term_id = $2
       ORDER BY link.teacher_membership_id`,
      [inputs.map((input) => input.teacherMembershipId), inputs[0]?.schoolTermId],
    );
    return rows.rows;
  }

  /**
   * The classroom a student sits in, but only when the teacher teaches it.
   *
   * The link used to name one classroom, so "is this student mine" was a
   * roster check against it. A teacher link names none, so the classroom is
   * derived from the student and then proven to be one this teacher reaches —
   * a student in the same school but another teacher's room resolves to
   * nothing.
   */
  async findAuthorizedClassroomForStudent(input: {
    studentUuid: string;
    teacherMembershipId: number;
    schoolTermId: number;
  }): Promise<number | null> {
    const result = await queryDataSource<{ classroom_id: string }>(
      this.dataSource,
      `SELECT DISTINCT classroom.id::text AS classroom_id
       FROM student_term student
       JOIN school_classrooms classroom
         ON classroom.id = student.classroom_id
       JOIN classroom_subject_teachers assignment
         ON assignment.classroom_id = classroom.id
        AND assignment.school_id = classroom.school_id
       WHERE student.student_uuid = $1
         AND assignment.teacher_membership_id = $2
         AND classroom.school_term_id = $3
         AND assignment.assignment_status = 'ACTIVE'
         AND assignment.deleted_at IS NULL
         AND classroom.classroom_status = 'ACTIVE'
         AND classroom.deleted_at IS NULL
       LIMIT 1`,
      [input.studentUuid, input.teacherMembershipId, input.schoolTermId],
    );
    const row = result.rows[0];
    return row ? Number(row.classroom_id) : null;
  }

  /** Classrooms a teacher reaches this term through their subject assignments. */
  /**
   * Classrooms a teacher reaches this term through their subject assignments.
   *
   * Returned in the shape the app's ห้องเรียนทั้งหมด cards already use, so the
   * link's "ห้องเรียนของฉัน" is that page rather than a lookalike. The
   * personalisation columns come back at their defaults: a link has no account
   * to have favourited a room or uploaded a cover.
   */
  /**
   * The one room an assignment covers, in the same card shape a teacher link
   * uses — so the link surface renders one page, not two.
   *
   * The subtitle here is the assigned subject alone: whoever picked this up was
   * asked to cover one lesson, and listing the room's other subjects would read
   * as an invitation to take those too.
   */
  async findAssignmentClassroom(
    classroomSubjectId: number,
  ): Promise<Record<string, unknown> | null> {
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `SELECT
         classroom.id::text AS classroom_id,
         offering.id::text AS classroom_subject_id,
         classroom.school_id,
         classroom.school_term_id::text AS school_term_id,
         term.academic_year, term.semester,
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
         classroom.updated_at AS cover_updated_at,
         grade.label || '/' || classroom.room_code AS label,
         COALESCE(roster.student_count, 0)::int AS student_count,
         subject.name_th AS subject_names,
         subject.code AS subject_code
       FROM classroom_subjects offering
       JOIN school_classrooms classroom
         ON classroom.id = offering.classroom_id
        AND classroom.school_id = offering.school_id
       JOIN grade_levels grade ON grade.id = classroom.grade_level_id
       JOIN school_terms term
         ON term.id = classroom.school_term_id AND term.school_id = classroom.school_id
       JOIN school_subjects school_subject ON school_subject.id = offering.school_subject_id
       JOIN subjects subject ON subject.id = school_subject.subject_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS student_count
         FROM student_term student
         WHERE student.classroom_id = classroom.id
       ) roster ON TRUE
       WHERE offering.id = $1
         AND classroom.deleted_at IS NULL`,
      [classroomSubjectId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Everyone who has opened one link, newest first.
   *
   * Read from the audit log rather than a table of its own: opening a link is an
   * access event, and the audit log is already where this system records those —
   * append-only, and never rewritten when the link is rotated or closed.
   */
  async listLinkOpens(linkId: string): Promise<Array<Record<string, unknown>>> {
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `SELECT
         log.created_at AS opened_at,
         log.actor_label AS teacher_name,
         log.metadata ->> 'authMethod' AS auth_method
       FROM audit_log log
       WHERE log.action = 'CLASSROOM_ATTENDANCE_LINK_OPEN'
         AND log.target_type = 'classroom_attendance_links'
         AND log.target_id = $1
       ORDER BY log.created_at DESC
       LIMIT 200`,
      [linkId],
    );
    return result.rows;
  }

  /** Every register taken through one link, newest first. */
  async listLinkAttendanceSessions(linkId: string): Promise<Array<Record<string, unknown>>> {
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `SELECT
         session.id::text AS session_id,
         session.school_id,
         session.classroom_id,
         session.classroom_subject_id,
         session.attendance_date::text AS attendance_date,
         session.checking_started_at AS started_at,
         session.submitted_at,
         session.status,
         session.expected_roster_count,
         session.exception_count,
         classroom.grade_level_id,
         grade.label || '/' || classroom.room_code AS classroom_label,
         subject.name_th AS subject_name,
         TRIM(BOTH ' ' FROM COALESCE(started.first_name, '') || ' ' ||
              COALESCE(started.last_name, '')) AS started_by_name,
         TRIM(BOTH ' ' FROM COALESCE(submitted.first_name, '') || ' ' ||
              COALESCE(submitted.last_name, '')) AS submitted_by_name
       FROM attendance_sessions session
       JOIN school_classrooms classroom ON classroom.id = session.classroom_id
       JOIN grade_levels grade ON grade.id = classroom.grade_level_id
       JOIN classroom_subjects offering ON offering.id = session.classroom_subject_id
       JOIN school_subjects school_subject ON school_subject.id = offering.school_subject_id
       JOIN subjects subject ON subject.id = school_subject.subject_id
       LEFT JOIN school_teacher_memberships started_membership
         ON started_membership.id = session.started_by_teacher_membership_id
       LEFT JOIN teachers started ON started.id = started_membership.teacher_id
       LEFT JOIN school_teacher_memberships submitted_membership
         ON submitted_membership.id = session.submitted_by_teacher_membership_id
       LEFT JOIN teachers submitted ON submitted.id = submitted_membership.teacher_id
       WHERE session.classroom_attendance_link_id = $1
         AND session.deleted_at IS NULL
       ORDER BY session.checking_started_at DESC
       LIMIT 200`,
      [linkId],
    );
    return result.rows;
  }

  /**
   * The links themselves, both kinds, newest first.
   *
   * `list()` above starts from teachers and answers "who has a link" — the right
   * question for handing links out, and the wrong one for reviewing what was
   * issued: an assignment belongs to nobody, so it never appears there. This
   * starts from the links, so it can show both.
   */
  async listIssuedLinks(input: {
    schoolId: number;
    schoolTermId: number;
    kind?: 'TEACHER' | 'ASSIGNMENT';
    search?: string;
    page: number;
    limit: number;
    scope: DataScope;
  }): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
    const params: unknown[] = [input.schoolId, input.schoolTermId];
    const conditions = ['link.school_id = $1', 'link.school_term_id = $2'];
    const scope = buildDataScopeQuery(
      input.scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'classroom.grade_level_id',
        room: 'classroom.legacy_room_number',
      },
      params.length + 1,
    );
    conditions.push(scope.sql || 'TRUE');
    params.push(...scope.params);
    if (input.kind === 'TEACHER') conditions.push('link.teacher_membership_id IS NOT NULL');
    if (input.kind === 'ASSIGNMENT')
      conditions.push('link.assigned_classroom_subject_id IS NOT NULL');
    if (input.search) {
      params.push(`%${input.search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`);
      conditions.push(`(
        TRIM(COALESCE(teacher.first_name, '') || ' ' || COALESCE(teacher.last_name, ''))
          ILIKE $${params.length} ESCAPE '\\'
        OR COALESCE(subject.name_th, '') ILIKE $${params.length} ESCAPE '\\'
        OR COALESCE(grade.label || '/' || classroom.room_code, '') ILIKE $${params.length} ESCAPE '\\'
      )`);
    }
    const from = `
      FROM classroom_attendance_links link
      JOIN schools school ON school.id = link.school_id
      LEFT JOIN school_teacher_memberships membership ON membership.id = link.teacher_membership_id
      LEFT JOIN teachers teacher ON teacher.id = membership.teacher_id
      LEFT JOIN school_classrooms classroom ON classroom.id = link.assigned_classroom_id
      LEFT JOIN grade_levels grade ON grade.id = classroom.grade_level_id
      LEFT JOIN classroom_subjects offering ON offering.id = link.assigned_classroom_subject_id
      LEFT JOIN school_subjects school_subject ON school_subject.id = offering.school_subject_id
      LEFT JOIN subjects subject ON subject.id = school_subject.subject_id
      WHERE ${conditions.join(' AND ')}`;
    params.push(input.limit, (input.page - 1) * input.limit);
    const [rows, total] = await Promise.all([
      queryDataSource<Record<string, unknown>>(
        this.dataSource,
        `SELECT
           link.id::text AS link_id,
           link.link_status,
           link.issued_at,
           link.last_used_at,
           link.opens_at,
           link.expires_at,
           CASE WHEN link.assigned_classroom_subject_id IS NOT NULL
                THEN 'ASSIGNMENT' ELSE 'TEACHER' END AS link_kind,
           TRIM(BOTH ' ' FROM COALESCE(teacher.first_name, '') || ' ' ||
                COALESCE(teacher.last_name, '')) AS teacher_name,
           grade.label || '/' || classroom.room_code AS classroom_label,
           subject.name_th AS subject_name,
           (SELECT COUNT(*)::int FROM audit_log log
             WHERE log.action = 'CLASSROOM_ATTENDANCE_LINK_OPEN'
               AND log.target_type = 'classroom_attendance_links'
               AND log.target_id = link.id::text) AS open_count,
           (SELECT COUNT(*)::int FROM attendance_sessions session
             WHERE session.classroom_attendance_link_id = link.id
               AND session.deleted_at IS NULL) AS session_count
         ${from}
         ORDER BY link.issued_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
      queryDataSource<{ count: string }>(
        this.dataSource,
        `SELECT COUNT(*)::text AS count ${from}`,
        params.slice(0, params.length - 2),
      ),
    ]);
    return { rows: rows.rows, total: Number(total.rows[0]?.count ?? 0) };
  }

  /**
   * The assignments one person issued, newest first.
   *
   * "One person" is the point: this backs the screen where a teacher manages
   * what *they* handed on, not an audit of the school. Whoever issued it holds
   * an account (the admin screen) or a membership (their own link), so the
   * caller says which, and neither can read the other's.
   *
   * `classroomSubjectId` narrows it to the lesson the caller came in from; left
   * off, the answer is every lesson they issued for this term, which is what
   * the "ทุกวิชาของฉัน" filter asks for.
   */
  async listIssuedAssignments(input: {
    schoolTermId: number;
    issuedByUserId?: number;
    issuedByTeacherMembershipId?: number;
    classroomSubjectId?: number;
  }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [input.schoolTermId];
    const conditions = [
      'link.school_term_id = $1',
      'link.assigned_classroom_subject_id IS NOT NULL',
    ];
    if (input.issuedByUserId !== undefined) {
      params.push(input.issuedByUserId);
      conditions.push(`link.created_by = $${params.length}`);
    } else if (input.issuedByTeacherMembershipId !== undefined) {
      params.push(input.issuedByTeacherMembershipId);
      conditions.push(`link.issued_by_teacher_membership_id = $${params.length}`);
    } else {
      // No owner is not "everyone" — it is a caller that forgot to say who it
      // is, and answering it would hand one teacher another's links.
      throw new Error('listIssuedAssignments needs an issuer');
    }
    if (input.classroomSubjectId !== undefined) {
      params.push(input.classroomSubjectId);
      conditions.push(`link.assigned_classroom_subject_id = $${params.length}`);
    }
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `SELECT
         link.id::text AS link_id,
         link.link_status,
         link.issued_at,
         link.opens_at,
         link.expires_at,
         link.last_used_at,
         classroom.id::text AS classroom_id,
         grade.label || '/' || classroom.room_code AS classroom_label,
         offering.id::text AS classroom_subject_id,
         subject.name_th AS subject_name,
         subject.code AS subject_code,
         (SELECT COUNT(*)::int FROM audit_log log
           WHERE log.action = 'CLASSROOM_ATTENDANCE_LINK_OPEN'
             AND log.target_type = 'classroom_attendance_links'
             AND log.target_id = link.id::text) AS open_count,
         (SELECT COUNT(*)::int FROM attendance_sessions session
           WHERE session.classroom_attendance_link_id = link.id
             AND session.deleted_at IS NULL) AS session_count
       FROM classroom_attendance_links link
       JOIN school_classrooms classroom ON classroom.id = link.assigned_classroom_id
       JOIN grade_levels grade ON grade.id = classroom.grade_level_id
       JOIN classroom_subjects offering ON offering.id = link.assigned_classroom_subject_id
       JOIN school_subjects school_subject ON school_subject.id = offering.school_subject_id
       JOIN subjects subject ON subject.id = school_subject.subject_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY link.issued_at DESC`,
      params,
    );
    return result.rows;
  }

  /**
   * One card per lesson this teacher teaches, not per room.
   *
   * A teacher can hold two subjects in the same room, so a card per room would
   * still have to ask which one on the way in — and the link already knows: the
   * card was the answer. The room repeats across cards on purpose.
   *
   * `subject_code` rides along because two offerings in one room can carry the
   * same subject name (two maths sets, say); the code is what tells them apart,
   * and the page shows it only when the name alone is ambiguous.
   */
  async listTeacherClassrooms(input: {
    teacherMembershipId: number;
    schoolTermId: number;
  }): Promise<Array<Record<string, unknown>>> {
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `SELECT
         classroom.id::text AS classroom_id,
         offering.id::text AS classroom_subject_id,
         classroom.school_id,
         classroom.school_term_id::text AS school_term_id,
         term.academic_year, term.semester,
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
         classroom.updated_at AS cover_updated_at,
         grade.label || '/' || classroom.room_code AS label,
         COALESCE(roster.student_count, 0)::int AS student_count,
         subject.name_th AS subject_names,
         subject.code AS subject_code
       FROM classroom_subject_teachers assignment
       JOIN classroom_subjects offering
         ON offering.id = assignment.classroom_subject_id
       JOIN school_classrooms classroom
         ON classroom.id = assignment.classroom_id
        AND classroom.school_id = assignment.school_id
       JOIN grade_levels grade ON grade.id = classroom.grade_level_id
       JOIN school_terms term
         ON term.id = classroom.school_term_id AND term.school_id = classroom.school_id
       JOIN school_subjects school_subject ON school_subject.id = offering.school_subject_id
       JOIN subjects subject ON subject.id = school_subject.subject_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS student_count
         FROM student_term student
         WHERE student.classroom_id = classroom.id
       ) roster ON TRUE
       WHERE assignment.teacher_membership_id = $1
         AND classroom.school_term_id = $2
         AND assignment.assignment_status = 'ACTIVE'
         AND assignment.deleted_at IS NULL
         AND classroom.classroom_status = 'ACTIVE'
         AND classroom.deleted_at IS NULL
       ORDER BY label, subject.name_th`,
      [input.teacherMembershipId, input.schoolTermId],
    );
    return result.rows;
  }

  /** The classroom an assignment covers, checked against the actor's scope. */
  async findAssignableClassroom(
    input: { classroomId: number; schoolId: number; schoolTermId: number; scope: DataScope },
    runner: QueryRunner,
  ): Promise<{ classroom_id: string } | null> {
    const params: unknown[] = [input.classroomId, input.schoolId, input.schoolTermId];
    const scope = buildDataScopeQuery(
      input.scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'classroom.grade_level_id',
        room: 'classroom.legacy_room_number',
      },
      params.length + 1,
    );
    params.push(...scope.params);
    const result = await createSqlQueryExecutor(runner).query<{ classroom_id: string }>(
      `SELECT classroom.id::text AS classroom_id
       FROM school_classrooms classroom
       JOIN schools school ON school.id = classroom.school_id
       JOIN school_terms term
         ON term.id = classroom.school_term_id AND term.school_id = classroom.school_id
       WHERE classroom.id = $1
         AND classroom.school_id = $2
         AND classroom.school_term_id = $3
         AND classroom.classroom_status = 'ACTIVE'
         AND classroom.deleted_at IS NULL
         AND school.school_status = 'ACTIVE'
         AND term.status = 'ACTIVE'
         AND term.deleted_at IS NULL
         AND ${scope.sql || 'TRUE'}
       LIMIT 1
       FOR UPDATE OF classroom`,
      params,
    );
    return result.rows[0] ?? null;
  }

  /**
   * The offering being handed on, proved to belong to the school and, when a
   * teacher issues it from their own link, to be one they actually teach.
   */
  /**
   * The lessons this teacher may take a register for in one room.
   *
   * A room's timetable belongs to the room; what a link grants is this teacher's
   * share of it. Without this the subject picker on a link offered every subject
   * the room has, including colleagues' — and nothing downstream said no.
   */
  async listTeacherOfferingIds(input: {
    teacherMembershipId: number;
    classroomId: number;
  }): Promise<number[]> {
    const result = await queryDataSource<{ classroom_subject_id: string }>(
      this.dataSource,
      `SELECT assignment.classroom_subject_id::text AS classroom_subject_id
       FROM classroom_subject_teachers assignment
       WHERE assignment.teacher_membership_id = $1
         AND assignment.classroom_id = $2
         AND assignment.assignment_status = 'ACTIVE'
         AND assignment.deleted_at IS NULL`,
      [input.teacherMembershipId, input.classroomId],
    );
    return result.rows.map((row) => Number(row.classroom_subject_id));
  }

  async findAssignableSubject(
    input: {
      classroomSubjectId: number;
      schoolId: number;
      schoolTermId: number;
      teacherMembershipId?: number;
    },
    runner: QueryRunner,
  ): Promise<{ classroom_subject_id: string; classroom_id: string } | null> {
    const params: unknown[] = [input.classroomSubjectId, input.schoolId, input.schoolTermId];
    let taughtBy = '';
    if (input.teacherMembershipId) {
      params.push(input.teacherMembershipId);
      taughtBy = `AND EXISTS (
        SELECT 1 FROM classroom_subject_teachers assignment
        WHERE assignment.classroom_subject_id = offering.id
          AND assignment.teacher_membership_id = $${params.length}
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.deleted_at IS NULL
      )`;
    }
    const result = await createSqlQueryExecutor(runner).query<{
      classroom_subject_id: string;
      classroom_id: string;
    }>(
      `SELECT offering.id::text AS classroom_subject_id,
              offering.classroom_id::text
       FROM classroom_subjects offering
       JOIN school_classrooms classroom
         ON classroom.id = offering.classroom_id AND classroom.school_id = offering.school_id
       WHERE offering.id = $1
         AND offering.school_id = $2
         AND classroom.school_term_id = $3
         AND offering.offering_status = 'ACTIVE'
         AND offering.deleted_at IS NULL
         AND classroom.classroom_status = 'ACTIVE'
         AND classroom.deleted_at IS NULL
         ${taughtBy}
       LIMIT 1`,
      params,
    );
    return result.rows[0] ?? null;
  }

  /** Issues an assignment link — a classroom, a window, and nobody's name. */
  /**
   * The assignment link that still works for this lesson, if there is one.
   *
   * Serialises on the lesson first: two taps on มอบหมาย land in two
   * transactions that would both find nothing and both insert. The advisory
   * lock is transaction-scoped, so it releases with the commit that created the
   * link the second one then sees. A unique index cannot do this job — "still
   * works" depends on `now()`, which a partial index predicate cannot contain.
   */
  async findUsableAssignmentForSubject(
    classroomSubjectId: number,
    runner: QueryRunner,
  ): Promise<{ id: string; expires_at: Date | null } | null> {
    const executor = createSqlQueryExecutor(runner);
    await executor.query(`SELECT pg_advisory_xact_lock($1, $2)`, [
      CLASSROOM_ASSIGNMENT_LOCK_NAMESPACE,
      classroomSubjectId,
    ]);
    const result = await executor.query<{ id: string; expires_at: Date | null }>(
      `SELECT id::text, expires_at
         FROM classroom_attendance_links
        WHERE assigned_classroom_subject_id = $1
          AND link_status = 'ACTIVE'
          AND (expires_at IS NULL OR expires_at > now())
        LIMIT 1`,
      [classroomSubjectId],
    );
    return result.rows[0] ?? null;
  }

  async insertAssignmentLink(
    input: {
      schoolId: number;
      schoolTermId: number;
      classroomId: number;
      classroomSubjectId: number;
      opensAt: string | null;
      expiresAt: string;
      note: string | null;
      tokenHash: string;
      tokenEncrypted: string;
      /** Null when a link issued it: there is no account behind a link. */
      actorId: number | null;
      /**
       * Set when a teacher issued this from inside their own link, where there
       * is no account for `actorId` to hold. Exactly one of the two is set.
       */
      issuedByTeacherMembershipId?: number | null;
      /** Null for assignments created by an authenticated system user. */
      sourceTeacherLinkId?: string | null;
    },
    runner: QueryRunner,
  ): Promise<ClassroomLinkRow> {
    const inserted = await createSqlQueryExecutor(runner).query<{ id: string }>(
      `INSERT INTO classroom_attendance_links (
         school_id, school_term_id, assigned_classroom_id, assigned_classroom_subject_id,
         opens_at, expires_at, assignment_note,
         token_hash, token_encrypted, link_status, issued_at, created_by, updated_by,
         issued_by_teacher_membership_id, source_teacher_link_id
       ) VALUES ($1, $2, $3, $10, $4, $5, $6, $7, $8, 'ACTIVE', now(), $9, $9, $11, $12)
       RETURNING id::text`,
      [
        input.schoolId,
        input.schoolTermId,
        input.classroomId,
        input.opensAt,
        input.expiresAt,
        input.note,
        input.tokenHash,
        input.tokenEncrypted,
        input.actorId,
        input.classroomSubjectId,
        input.issuedByTeacherMembershipId ?? null,
        input.sourceTeacherLinkId ?? null,
      ],
    );
    const id = inserted.rows[0]?.id;
    const rows = await createSqlQueryExecutor(runner).query<ClassroomLinkRow>(
      `${this.linkSelect()} WHERE link.id = $1`,
      [id],
    );
    const row = rows.rows[0];
    if (!row) throw new Error('assignment link disappeared after insert');
    return row;
  }

  async findById(id: string, runner?: QueryRunner, lock = false): Promise<ClassroomLinkRow | null> {
    const executor = runner
      ? createSqlQueryExecutor(runner)
      : {
          query: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
            queryDataSource<T>(this.dataSource, sql, params),
        };
    const result = await executor.query<ClassroomLinkRow>(
      `${this.linkSelect()} WHERE link.id = $1 ${lock ? 'FOR UPDATE OF link' : ''}`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findActiveAssignmentsBySourceTeacherLink(
    sourceTeacherLinkId: string,
    runner: QueryRunner,
  ): Promise<ClassroomLinkRow[]> {
    const result = await createSqlQueryExecutor(runner).query<ClassroomLinkRow>(
      `${this.linkSelect()}
       WHERE link.source_teacher_link_id = $1
         AND link.link_status = 'ACTIVE'
       ORDER BY link.issued_at ASC, link.id ASC
       FOR UPDATE OF link`,
      [sourceTeacherLinkId],
    );
    return result.rows;
  }

  async findUsableByTokenHash(tokenHash: string): Promise<ClassroomLinkRow | null> {
    const result = await queryDataSource<ClassroomLinkRow>(
      this.dataSource,
      `${this.linkSelect()}
       WHERE link.token_hash = $1
         AND link.link_status = 'ACTIVE'
         AND school.school_status = 'ACTIVE'
         AND term.status = 'ACTIVE' AND term.deleted_at IS NULL
         -- An assignment is only a key between its dates; a standing link has
         -- no window and is usable for the whole term.
         AND (link.opens_at IS NULL OR link.opens_at <= now())
         AND (link.expires_at IS NULL OR link.expires_at > now())
       LIMIT 1`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async findUsableById(id: string): Promise<ClassroomLinkRow | null> {
    const result = await queryDataSource<ClassroomLinkRow>(
      this.dataSource,
      `${this.linkSelect()}
       WHERE link.id = $1
         AND link.link_status = 'ACTIVE'
         AND school.school_status = 'ACTIVE'
         AND term.status = 'ACTIVE' AND term.deleted_at IS NULL
         -- An assignment is only a key between its dates; a standing link has
         -- no window and is usable for the whole term.
         AND (link.opens_at IS NULL OR link.opens_at <= now())
         AND (link.expires_at IS NULL OR link.expires_at > now())
       LIMIT 1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async isLinkInScope(id: string, scope: DataScope): Promise<boolean> {
    const scopeQuery = buildDataScopeQuery(
      scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'classroom.grade_level_id',
        room: 'classroom.legacy_room_number',
      },
      2,
    );
    const result = await queryDataSource(
      this.dataSource,
      `SELECT 1
       FROM classroom_attendance_links link
       JOIN schools school ON school.id = link.school_id
       LEFT JOIN school_classrooms classroom
         ON classroom.id = link.assigned_classroom_id
        AND classroom.school_id = link.school_id
       WHERE link.id = $1 AND ${scopeQuery.sql || 'TRUE'}
       LIMIT 1`,
      [id, ...scopeQuery.params],
    );
    return result.rows.length > 0;
  }

  async updateToken(
    id: string,
    tokenHash: string,
    tokenEncrypted: string,
    /** Null when a link session did it: there is no account behind one. */
    actorId: number | null,
    runner: QueryRunner,
  ): Promise<void> {
    await createSqlQueryExecutor(runner).query(
      `UPDATE classroom_attendance_links
       SET token_hash = $2, token_encrypted = $3, link_status = 'ACTIVE',
           rotated_at = now(), last_used_at = NULL,
           line_delivery_status = CASE
             WHEN line_delivery_status = 'SENT' THEN 'NEEDS_RESEND'
             ELSE 'NOT_READY'
           END,
           line_delivery_failure_code = NULL,
           line_delivery_request_id = NULL,
           line_delivered_at = NULL,
           updated_by = $4
       WHERE id = $1`,
      [id, tokenHash, tokenEncrypted, actorId],
    );
  }

  /** `actorId` is null when a link session closed it: no account behind one. */
  async deactivate(id: string, actorId: number | null, runner: QueryRunner): Promise<void> {
    await createSqlQueryExecutor(runner).query(
      `UPDATE classroom_attendance_links
       SET link_status = 'INACTIVE', updated_by = $2
       WHERE id = $1`,
      [id, actorId],
    );
  }

  async recordLineDeliveryNotReady(
    id: string,
    teacherMembershipId: string | null,
    failureCode: Extract<
      ClassroomLinkLineDeliveryFailureCode,
      | 'HOMEROOM_UNAVAILABLE'
      | 'MESSAGING_DISABLED'
      | 'ACCOUNT_NOT_VERIFIED'
      | 'ACCOUNT_NOT_REACHABLE'
    >,
    actorId: number,
  ): Promise<ClassroomLinkRow | null> {
    await queryDataSource(
      this.dataSource,
      `UPDATE classroom_attendance_links
       SET line_delivery_teacher_membership_id = $2,
           line_delivery_status = 'NOT_READY',
           line_delivery_failure_code = $3,
           line_delivery_request_id = NULL,
           line_delivered_at = NULL,
           updated_by = $4
       WHERE id = $1 AND link_status = 'ACTIVE'`,
      [id, teacherMembershipId, failureCode, actorId],
    );
    return await this.findById(id);
  }

  async claimLineDelivery(
    id: string,
    teacherMembershipId: string,
    deliveryRequestId: string,
    actorId: number,
  ): Promise<ClassroomLinkRow | null> {
    const result = await queryDataSource<{ id: string }>(
      this.dataSource,
      `UPDATE classroom_attendance_links
       SET line_delivery_teacher_membership_id = $2,
           line_delivery_status = 'SENDING',
           line_delivery_failure_code = NULL,
           line_delivery_attempt_count = line_delivery_attempt_count + 1,
           line_delivery_request_id = $3::uuid,
           line_delivery_last_attempted_at = now(),
           line_delivered_at = NULL,
           updated_by = $4
       WHERE id = $1
         AND link_status = 'ACTIVE'
         -- A link belongs to a teacher, so the delivery target is the teacher it
         -- belongs to. This used to read the homeroom of the link's classroom,
         -- from when a link belonged to a room; that column is gone and the
         -- query raised on every send.
         AND teacher_membership_id = $2
         AND EXISTS (
           SELECT 1
           FROM school_teacher_memberships membership
           JOIN teachers teacher
             ON teacher.id = membership.teacher_id
            AND teacher.teacher_status = 'ACTIVE'
            AND teacher.deleted_at IS NULL
           WHERE membership.id = $2
             AND membership.school_id = classroom_attendance_links.school_id
             AND membership.membership_status = 'ACTIVE'
             AND membership.deleted_at IS NULL
         )
         AND (
           line_delivery_status <> 'SENDING'
           OR line_delivery_last_attempted_at < now() - interval '5 minutes'
         )
         AND NOT (
           line_delivery_status = 'SENT'
           AND line_delivery_request_id = $3::uuid
           AND line_delivery_teacher_membership_id = $2
         )
       RETURNING id::text`,
      [id, teacherMembershipId, deliveryRequestId, actorId],
    );
    return result.rows[0] ? await this.findById(id) : null;
  }

  async finishLineDelivery(
    id: string,
    deliveryRequestId: string,
    delivered: boolean,
    failureCode: Extract<
      ClassroomLinkLineDeliveryFailureCode,
      'PROVIDER_REJECTED' | 'PROVIDER_UNAVAILABLE'
    > | null,
    actorId: number,
  ): Promise<ClassroomLinkRow | null> {
    await queryDataSource(
      this.dataSource,
      `UPDATE classroom_attendance_links
       SET line_delivery_status = CASE WHEN $3::boolean THEN 'SENT' ELSE 'FAILED' END,
           line_delivery_failure_code = $4,
           line_delivered_at = CASE WHEN $3::boolean THEN now() ELSE NULL END,
           updated_by = $5
       WHERE id = $1
         AND line_delivery_request_id = $2::uuid
         AND line_delivery_status = 'SENDING'`,
      [id, deliveryRequestId, delivered, failureCode, actorId],
    );
    return await this.findById(id);
  }

  async findTeacherByEmail(email: string, schoolId: number): Promise<ExternalTeacherRow | null> {
    return await this.findTeacher(`lower(btrim(teacher.email)) = $1`, [email, schoolId]);
  }

  async findTeacherByCitizenId(
    citizenId: string,
    schoolId: number,
  ): Promise<ExternalTeacherRow | null> {
    return await this.findTeacher(`teacher.citizen_id = $1`, [citizenId, schoolId]);
  }

  async findActiveMembership(
    membershipId: string,
    schoolId: number,
  ): Promise<ExternalTeacherRow | null> {
    const result = await queryDataSource<ExternalTeacherRow>(
      this.dataSource,
      `SELECT teacher.id::text AS teacher_id, membership.id::text AS teacher_membership_id,
              membership.school_id,
              TRIM(teacher.first_name || ' ' || teacher.last_name) AS teacher_display_name,
              lower(btrim(teacher.email)) AS normalized_email, teacher.citizen_id,
              teacher.teacher_status, membership.membership_status,
              (teacher.photo_storage_key IS NOT NULL) AS teacher_has_photo,
              teacher.updated_at AS teacher_photo_updated_at,
              teacher.deleted_at AS teacher_deleted_at,
              membership.deleted_at AS membership_deleted_at
       FROM school_teacher_memberships membership
       JOIN teachers teacher ON teacher.id = membership.teacher_id
       WHERE membership.id = $1 AND membership.school_id = $2
       LIMIT 1`,
      [membershipId, schoolId],
    );
    return result.rows[0] ?? null;
  }

  private async findTeacher(
    condition: string,
    params: unknown[],
  ): Promise<ExternalTeacherRow | null> {
    const result = await queryDataSource<ExternalTeacherRow>(
      this.dataSource,
      `SELECT teacher.id::text AS teacher_id, membership.id::text AS teacher_membership_id,
              membership.school_id,
              TRIM(teacher.first_name || ' ' || teacher.last_name) AS teacher_display_name,
              lower(btrim(teacher.email)) AS normalized_email, teacher.citizen_id,
              teacher.teacher_status, membership.membership_status,
              (teacher.photo_storage_key IS NOT NULL) AS teacher_has_photo,
              teacher.updated_at AS teacher_photo_updated_at,
              teacher.deleted_at AS teacher_deleted_at,
              membership.deleted_at AS membership_deleted_at
       FROM teachers teacher
       JOIN school_teacher_memberships membership ON membership.teacher_id = teacher.id
       WHERE ${condition} AND membership.school_id = $2
       LIMIT 2`,
      params,
    );
    return result.rows.length === 1 ? result.rows[0] : null;
  }

  async bindExternalIdentity(
    input: {
      teacherId: string;
      provider: 'GOOGLE' | 'THAID';
      providerSubject: string;
      normalizedEmail: string | null;
    },
    runner: QueryRunner,
  ): Promise<void> {
    await createSqlQueryExecutor(runner).query(
      `INSERT INTO teacher_external_identities (
         teacher_id, provider, provider_subject, normalized_email,
         verified_at, last_authenticated_at
       ) VALUES ($1, $2, $3, $4, now(), now())
       ON CONFLICT (teacher_id, provider) DO UPDATE
       SET provider_subject = CASE
             WHEN teacher_external_identities.provider_subject = EXCLUDED.provider_subject
             THEN EXCLUDED.provider_subject
             ELSE teacher_external_identities.provider_subject
           END,
           normalized_email = EXCLUDED.normalized_email,
           last_authenticated_at = now(), deleted_at = NULL, deleted_by = NULL
       RETURNING id`,
      [input.teacherId, input.provider, input.providerSubject, input.normalizedEmail],
    );
    const identity = await createSqlQueryExecutor(runner).query<{ teacher_id: string }>(
      `SELECT teacher_id::text
       FROM teacher_external_identities
       WHERE provider = $1 AND provider_subject = $2 AND deleted_at IS NULL`,
      [input.provider, input.providerSubject],
    );
    if (identity.rows[0]?.teacher_id !== input.teacherId) {
      throw new Error('EXTERNAL_IDENTITY_CONFLICT');
    }
  }

  async touchLinkUsed(id: string): Promise<void> {
    await queryDataSource(
      this.dataSource,
      `UPDATE classroom_attendance_links SET last_used_at = now() WHERE id = $1 AND link_status = 'ACTIVE'`,
      [id],
    );
  }
}
