import type { MigrationInterface, QueryRunner } from 'typeorm';

const SCHOOL_NAME = 'โรงเรียนเทพศิรินทร์ราชดำริ';
const DEMO_REASON = 'ข้อมูลสาธิตสำหรับการนำเสนอวงจรติดตามนักเรียน';
const SCENARIOS = [
  ['OPEN', null, 'รอมอบหมาย: รอจัดครูติดตาม'],
  ['IN_PROGRESS', null, 'รอติดตาม: ครูรับงานและกำลังประสานผู้ปกครอง'],
  ['PENDING_REVIEW', null, 'รอพิจารณา: ครูส่งรายงานติดตามแล้ว'],
  ['STUDENT_NOT_FOUND', null, 'ไม่พบนักเรียน: ลงพื้นที่แล้วไม่พบตามที่อยู่'],
  ['RESOLVED', 'CLOSED', 'เสร็จสิ้น: ปิดเคส'],
  ['RESOLVED', 'REFERRED_AGENCY', 'เสร็จสิ้น: ส่งต่อหน่วยงาน'],
] as const;

/** One-time, idempotent showcase cases for the Thepsirin demo school. */
export class SeedThepsirinCaseShowcase20260807130000 implements MigrationInterface {
  name = 'SeedThepsirinCaseShowcase20260807130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const schools = (await queryRunner.query(
      `SELECT id, name FROM schools WHERE name = $1 LIMIT 1`,
      [SCHOOL_NAME],
    )) as Array<{ id: number; name: string }>;
    const school = schools[0];
    if (!school) return;

    const students = (await queryRunner.query(
      `SELECT student_uuid::text, trim(concat_ws(' ', "FirstName_Onec", "LastName_Onec")) AS student_name,
              "AcademicYear_Onec" AS academic_year, "Semester_Onec" AS semester,
              "GradeLevelID_Onec" AS grade_level_id, "RoomID_Onec" AS room_id,
              school_term_id
       FROM student_term
       WHERE "SchoolID_Onec" = $1 AND deleted_at IS NULL
       ORDER BY "FirstName_Onec", "LastName_Onec", student_uuid
       LIMIT 6`,
      [school.id],
    )) as Array<Record<string, string | number>>;
    const actors = (await queryRunner.query(
      `SELECT account.id,
              trim(concat_ws(' ', account."FirstName", account."LastName")) AS display_name,
              account.email
       FROM users account
       JOIN school_teacher_memberships membership
         ON membership.teacher_user_id = account.id
        AND membership.school_id = $1
        AND membership.membership_status = 'ACTIVE'
        AND membership.deleted_at IS NULL
       WHERE account.status = 'ACTIVE'
       ORDER BY account.id
       LIMIT 1`,
      [school.id],
    )) as Array<{ id: number; display_name: string; email: string | null }>;
    const actor = actors[0];
    if (students.length < SCENARIOS.length || !actor) return;

    for (const [index, [status, completionOutcome, summary]] of SCENARIOS.entries()) {
      const student = students[index];
      await queryRunner.query(
        `WITH candidate_days AS (
           SELECT day_value::date AS attendance_date
           FROM school_terms term
           CROSS JOIN LATERAL generate_series(
             GREATEST(term.starts_on, current_date - interval '30 days'),
             LEAST(term.ends_on, current_date - interval '1 day'),
             interval '1 day'
           ) day_value
           WHERE term.id = $7
             AND EXTRACT(ISODOW FROM day_value) BETWEEN 1 AND 5
             AND NOT EXISTS (
               SELECT 1 FROM school_calendar_days blocked_day
               WHERE blocked_day.school_term_id = term.id
                 AND blocked_day.calendar_date = day_value::date
                 AND blocked_day.day_type <> 'SCHOOL_DAY'
                 AND blocked_day.deleted_at IS NULL
             )
           ORDER BY day_value DESC
           LIMIT 3
         )
         INSERT INTO attendance (
           student_uuid, "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
           "AcademicYear_Onec", "Semester_Onec", "AttendanceDate", "Period",
           session_kind, "AttendanceStatus", "RecordedAt", "RecordedBy"
         )
         SELECT $1::uuid, $2, $3, $4, $5, $6, attendance_date, 1,
                'DAILY', 2, now(), 'SYSTEM:THEPSIRIN_SHOWCASE'
         FROM candidate_days
         ON CONFLICT (student_uuid, "AttendanceDate")
           WHERE session_kind = 'DAILY'
         DO NOTHING`,
        [
          student.student_uuid,
          school.id,
          student.grade_level_id,
          student.room_id,
          student.academic_year,
          student.semester,
          student.school_term_id,
        ],
      );
      const existing = (await queryRunner.query(
        `SELECT id FROM cases WHERE student_uuid = $1::uuid AND result_summary = $2 AND deleted_at IS NULL LIMIT 1`,
        [student.student_uuid, summary],
      )) as Array<{ id: number }>;
      const caseId =
        existing[0]?.id ??
        (
          (await queryRunner.query(
            `INSERT INTO cases (student_uuid, student_name, student_school, school_id, reason_flagged, status, result_summary, completion_outcome_code)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
            [
              student.student_uuid,
              student.student_name,
              school.name,
              school.id,
              DEMO_REASON,
              status,
              summary,
              completionOutcome,
            ],
          )) as Array<{ id: number }>
        )[0].id;

      // Leave the unassigned showcase case untouched; every other status has a real task and link.
      if (status === 'OPEN') continue;
      const tasks = (await queryRunner.query(
        `SELECT id FROM tasks WHERE case_id = $1 AND task_type = 'VISIT' AND deleted_at IS NULL LIMIT 1`,
        [caseId],
      )) as Array<{ id: string }>;
      const taskId =
        tasks[0]?.id ??
        (
          (await queryRunner.query(
            `INSERT INTO tasks (case_id, status, max_delegation_depth, task_type, target_school_id, created_by, updated_by)
         VALUES ($1, $2, 2, 'VISIT', $3, $4, $4) RETURNING id`,
            [caseId, status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'COMPLETED', school.id, actor.id],
          )) as Array<{ id: string }>
        )[0].id;
      const links = (await queryRunner.query(
        `SELECT id FROM task_links WHERE task_id = $1 LIMIT 1`,
        [taskId],
      )) as Array<{ id: string }>;
      const linkId =
        links[0]?.id ??
        (
          (await queryRunner.query(
            `INSERT INTO task_links (task_id, token_hash, delegation_depth, assigned_to_name, assigned_to_email, subject, status, expires_at, created_by, updated_by)
         VALUES ($1, encode(digest($2, 'sha256'), 'hex'), 0, $3, $4, 'ติดตามนักเรียน', $5, now() + interval '30 days', $6, $6) RETURNING id`,
            [
              taskId,
              `thepsirin-showcase-${caseId}`,
              actor.display_name,
              actor.email,
              status === 'IN_PROGRESS' ? 'ACTIVE' : 'COMPLETED',
              actor.id,
            ],
          )) as Array<{ id: string }>
        )[0].id;
      if (status !== 'IN_PROGRESS')
        await queryRunner.query(
          `INSERT INTO task_submissions (
             task_link_id, cause_category, cause_detail, recommendation,
             case_follow_up_decision, home_visit_exception_code,
             submitted_at, created_by, updated_by
           )
         SELECT $1, 'FAMILY', $2, $3, 'REQUEST_REVIEW',
                CASE WHEN $5 = 'STUDENT_NOT_FOUND' THEN 'STUDENT_NOT_FOUND' ELSE NULL END,
                now() - interval '1 day', $4, $4
         WHERE NOT EXISTS (SELECT 1 FROM task_submissions WHERE task_link_id = $1)`,
          [
            linkId,
            'ข้อมูลสาธิตจากการติดตามนักเรียน',
            'ประสานครูและผู้ปกครองเพื่อติดตามต่อเนื่อง',
            actor.id,
            status,
          ],
        );
      if (status === 'RESOLVED')
        await queryRunner.query(
          `INSERT INTO case_reviews (
             case_id, review_action, review_note, review_summary,
             reviewed_by, reviewed_at, source_actor_user_id
           )
           SELECT $1, $2, 'ตรวจสอบข้อมูลการติดตามครบถ้วน',
                  $3, $4, now(), $5
           WHERE NOT EXISTS (
             SELECT 1 FROM case_reviews
             WHERE case_id = $1 AND review_action = $2
           )`,
          [
            caseId,
            completionOutcome === 'REFERRED_AGENCY' ? 'REFER_AGENCY' : 'CLOSE',
            completionOutcome === 'REFERRED_AGENCY'
              ? 'ส่งต่อหน่วยงานที่เกี่ยวข้องเพื่อดูแลต่อ'
              : 'ติดตามครบถ้วนและปิดเคส',
            actor.display_name,
            actor.id,
          ],
        );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM attendance WHERE "RecordedBy" = 'SYSTEM:THEPSIRIN_SHOWCASE'`,
    );
    await queryRunner.query(
      `DELETE FROM task_submissions submission
       USING task_links link, tasks task, cases tracked_case
       WHERE submission.task_link_id = link.id
         AND link.task_id = task.id
         AND task.case_id = tracked_case.id
         AND tracked_case.reason_flagged = $1
         AND tracked_case.student_school = $2`,
      [DEMO_REASON, SCHOOL_NAME],
    );
    await queryRunner.query(
      `DELETE FROM task_links link
       USING tasks task, cases tracked_case
       WHERE link.task_id = task.id
         AND task.case_id = tracked_case.id
         AND tracked_case.reason_flagged = $1
         AND tracked_case.student_school = $2`,
      [DEMO_REASON, SCHOOL_NAME],
    );
    await queryRunner.query(
      `DELETE FROM tasks task
       USING cases tracked_case
       WHERE task.case_id = tracked_case.id
         AND tracked_case.reason_flagged = $1
         AND tracked_case.student_school = $2`,
      [DEMO_REASON, SCHOOL_NAME],
    );
    await queryRunner.query(`DELETE FROM cases WHERE reason_flagged = $1 AND student_school = $2`, [
      DEMO_REASON,
      SCHOOL_NAME,
    ]);
  }
}
