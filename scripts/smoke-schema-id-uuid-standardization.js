const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { TaskService } = require('../dist/task/task.service');
const { DelegationService } = require('../dist/task/delegation.service');
const { RiskProfileService } = require('../dist/risk-profile/risk-profile.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run schema UUID smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BASE_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const MARKER = 'Schema UUID Smoke';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tokenOf(created) {
  assert(
    typeof created.magic_link === 'string' && created.magic_link.includes('/task/'),
    `createTask did not return a magic_link: ${JSON.stringify(created)}`,
  );
  return created.magic_link.split('/').pop();
}

async function getActor(dataSource) {
  const [user] = await dataSource.query(
    `SELECT id, username FROM users ORDER BY id LIMIT 1`,
  );
  assert(user, 'No user fixture was available');
  return {
    id: Number(user.id),
    username: user.username || 'schema_uuid_smoke',
    roles: ['ADMIN'],
    permissions: ['create', 'attendance-dashboard', 'dashboard', 'home', 'login-links'],
    data_scope: { global: true },
  };
}

async function getStudentFixture(dataSource) {
  const [student] = await dataSource.query(`
    SELECT
      st.student_uuid,
      st."SchoolID_Onec" AS school_id,
      st."GradeLevelID_Onec" AS grade_level_id,
      st."RoomID_Onec" AS room_id,
      gl.label AS grade_label,
      COALESCE(st."FirstName_Onec", 'Smoke') AS first_name,
      COALESCE(st."LastName_Onec", 'Student') AS last_name
    FROM student_term st
    JOIN grade_levels gl ON gl.id = st."GradeLevelID_Onec"
    WHERE st.student_uuid IS NOT NULL
      AND st."SchoolID_Onec" IS NOT NULL
      AND st."GradeLevelID_Onec" IS NOT NULL
      AND st."RoomID_Onec" IS NOT NULL
    ORDER BY st.student_uuid
    LIMIT 1
  `);
  assert(student, 'No student fixture was available');
  return student;
}

async function ensureTodayTimetableSlot(dataSource, student, actorId) {
  const day = new Date().getDay() || 7;
  const [existing] = await dataSource.query(
    `
      SELECT ts.id, ts.subject_id
      FROM timetable_slots ts
      WHERE ts.school_id = $1
        AND ts.grade_level_id = $2
        AND ts.room_no = $3
        AND ts.day_of_week = $4
        AND ts.deleted_at IS NULL
      ORDER BY ts.period ASC, ts.id ASC
      LIMIT 1
    `,
    [student.school_id, student.grade_level_id, student.room_id, day],
  );
  if (existing) {
    return { slotId: Number(existing.id), subjectId: Number(existing.subject_id), created: false };
  }

  const [term] = await dataSource.query(
    `
      SELECT id
      FROM school_terms
      WHERE school_id = $1
        AND deleted_at IS NULL
      ORDER BY
        CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
        academic_year DESC,
        semester DESC,
        id DESC
      LIMIT 1
    `,
    [student.school_id],
  );
  assert(term, `No school term fixture was available for school ${student.school_id}`);

  const [subject] = await dataSource.query(
    `
      INSERT INTO subjects (code, name_th, created_by, updated_by)
      VALUES ('SCHEMA_UUID_SMOKE', 'Schema UUID Smoke', $1, $1)
      ON CONFLICT (code) DO UPDATE SET name_th = EXCLUDED.name_th, updated_by = EXCLUDED.updated_by
      RETURNING id
    `,
    [actorId],
  );

  const [periodRow] = await dataSource.query(
    `
      SELECT COALESCE(MAX(period), 0) + 1 AS next_period
      FROM timetable_slots
      WHERE school_term_id = $1
        AND school_id = $2
        AND grade_level_id = $3
        AND room_no = $4
        AND day_of_week = $5
        AND deleted_at IS NULL
    `,
    [term.id, student.school_id, student.grade_level_id, student.room_id, day],
  );

  const [slot] = await dataSource.query(
    `
      INSERT INTO timetable_slots (
        school_term_id, school_id, grade_level_id, room_no, day_of_week, period, subject_id, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      RETURNING id, subject_id
    `,
    [
      term.id,
      student.school_id,
      student.grade_level_id,
      student.room_id,
      day,
      Number(periodRow.next_period),
      subject.id,
      actorId,
    ],
  );

  return { slotId: Number(slot.id), subjectId: Number(slot.subject_id), created: true };
}

async function cleanup(dataSource, taskIds, createdSlotId) {
  if (taskIds.length > 0) {
    const caseRows = await dataSource.query(
      `
        SELECT DISTINCT case_id
        FROM tasks
        WHERE id = ANY($1::uuid[])
          AND case_id IS NOT NULL
      `,
      [taskIds],
    );
    const caseIds = caseRows.map((row) => Number(row.case_id)).filter(Number.isFinite);

    await dataSource.query(
      `
        DELETE FROM task_submissions
        WHERE task_link_id IN (SELECT id FROM task_links WHERE task_id = ANY($1::uuid[]))
      `,
      [taskIds],
    );
    await dataSource.query(`DELETE FROM task_links WHERE task_id = ANY($1::uuid[])`, [taskIds]);
    await dataSource.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [taskIds]);
    if (caseIds.length > 0) {
      await dataSource.query(
        `DELETE FROM cases WHERE id = ANY($1::int[]) AND reason_flagged = $2`,
        [caseIds, MARKER],
      );
    }
  }
  if (createdSlotId) {
    await dataSource.query(`DELETE FROM timetable_slots WHERE id = $1`, [createdSlotId]);
  }
  await dataSource.query(
    `
      DELETE FROM subjects subject
      WHERE subject.code = 'SCHEMA_UUID_SMOKE'
        AND NOT EXISTS (
          SELECT 1 FROM timetable_slots slot WHERE slot.subject_id = subject.id
        )
    `,
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const taskService = app.get(TaskService);
  const delegationService = app.get(DelegationService);
  const riskProfiles = app.get(RiskProfileService);
  const taskIds = [];
  let createdSlotId = null;

  try {
    const actor = await getActor(dataSource);
    const student = await getStudentFixture(dataSource);
    const slot = await ensureTodayTimetableSlot(dataSource, student, actor.id);
    if (slot.created) createdSlotId = slot.slotId;

    const delegatedVisit = await taskService.createTask(
      actor,
      {
        task_type: 'VISIT',
        assigned_to_name: `${MARKER} Delegate Parent`,
        student_id: student.student_uuid,
        student_first_name: student.first_name,
        student_last_name: student.last_name,
        target_school_id: student.school_id,
        target_grade: student.grade_label,
        target_room: String(student.room_id),
        reason_flagged: MARKER,
        expires_value: '2',
        expires_unit: 'days',
      },
      BASE_URL,
    );
    taskIds.push(delegatedVisit.task_id || delegatedVisit.id);
    const delegatedToken = tokenOf(delegatedVisit);
    const delegated = await delegationService.delegateTask(
      delegatedToken,
      { new_assignee_name: `${MARKER} Child`, expires_in_hours: '24' },
      BASE_URL,
    );
    const delegatedChildToken = tokenOf(delegated);
    const childTask = await taskService.getTaskByToken(delegatedChildToken, undefined);
    assert(childTask?.task_id === taskIds[0], 'Delegated child link did not resolve to parent task');
    const [parentRow] = await dataSource.query(
      `SELECT child.parent_link_id FROM task_links child WHERE child.task_id = $1 AND child.parent_link_id IS NOT NULL`,
      [taskIds[0]],
    );
    assert(parentRow?.parent_link_id, 'Delegated link did not persist parent_link_id');

    const visit = await taskService.createTask(
      actor,
      {
        task_type: 'VISIT',
        assigned_to_name: `${MARKER} Submit`,
        student_id: student.student_uuid,
        student_first_name: student.first_name,
        student_last_name: student.last_name,
        target_school_id: student.school_id,
        target_grade: student.grade_label,
        target_room: String(student.room_id),
        reason_flagged: MARKER,
      },
      BASE_URL,
    );
    taskIds.push(visit.task_id || visit.id);
    const visitToken = tokenOf(visit);
    const visitTask = await taskService.getTaskByToken(visitToken, undefined);
    assert(visitTask?.task_id === taskIds[1], 'VISIT link did not resolve');
    await taskService.saveTaskSubmission(visitToken, {
      visit_lat: 18.79,
      visit_lng: 98.98,
      cause_category: 'FAMILY',
      cause_detail: MARKER,
      recommendation: 'Smoke recommendation',
    });
    const [submission] = await dataSource.query(
      `
        SELECT sub.id
        FROM task_submissions sub
        JOIN task_links link ON link.id = sub.task_link_id
        WHERE link.task_id = $1
      `,
      [taskIds[1]],
    );
    assert(submission, 'Visit submission did not join back to task link');

    const login = await taskService.createTask(
      actor,
      {
        task_type: 'LOGIN',
        assigned_to_name: `${MARKER} Login`,
        assigned_to_email: 'schema.uuid.login@example.test',
        role: 'TEACHER',
        permissions: ['home', 'attendance'],
        data_scope: { school_ids: [student.school_id], own_only: false },
      },
      BASE_URL,
    );
    taskIds.push(login.task_id || login.id);
    const loginVerified = await taskService.verifyMagicLogin(tokenOf(login), undefined);
    const [loginLinkRow] = await dataSource.query(
      `SELECT login_role FROM task_links WHERE task_id = $1`,
      [taskIds[3]],
    );
    assert(
      loginVerified?.otp_required === true && loginLinkRow?.login_role === 'TEACHER',
      `LOGIN link did not verify expected role: ${JSON.stringify(loginVerified)}`,
    );

    const attendance = await taskService.createTask(
      actor,
      {
        task_type: 'ATTENDANCE',
        assigned_to_name: `${MARKER} Attendance`,
        target_school_id: student.school_id,
        target_grade: student.grade_label,
        target_room: String(student.room_id),
        subject_id: slot.subjectId,
        timetable_slot_ids: [slot.slotId],
      },
      BASE_URL,
    );
    taskIds.push(attendance.task_id || attendance.id);
    const attendanceToken = tokenOf(attendance);
    const [linkedSlot] = await dataSource.query(
      `
        SELECT link_slot.id
        FROM task_link_timetable_slots link_slot
        JOIN task_links link ON link.id = link_slot.task_link_id
        WHERE link.task_id = $1
          AND link_slot.timetable_slot_id = $2
      `,
      [taskIds[4], slot.slotId],
    );
    assert(linkedSlot, 'Attendance task did not persist task_link_timetable_slots row');
    const attendanceRoster = await taskService.getTaskStudents(attendanceToken);
    const rosterRows = Array.isArray(attendanceRoster?.data) ? attendanceRoster.data : [];
    const rosterRecords = rosterRows.map((row) => ({
      student_id: String(row.id),
      status: 'P_PRESENT',
    }));
    assert(rosterRecords.length > 0, 'Attendance link did not return a roster');
    const attendanceTask = await taskService.getTaskByToken(attendanceToken, undefined);
    assert(attendanceTask?.task_id === taskIds[4], 'ATTENDANCE link did not resolve');

    await riskProfiles.enqueueStudents([student.student_uuid], 'schema-id-uuid-smoke');
    const dashboard = await taskService.getRiskDashboard(actor, { limit: 5 });
    assert(
      dashboard && (dashboard.summary || dashboard.data || Array.isArray(dashboard.items)),
      `Risk dashboard did not return data after recalculation enqueue: ${JSON.stringify(dashboard)}`,
    );

    console.log(
      'schema id uuid smoke passed (visit/login/attendance links, delegation parent_link_id, submission join, timetable slot link, risk dashboard)',
    );
  } finally {
    await cleanup(dataSource, taskIds, createdSlotId);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
