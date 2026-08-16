const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');
const { randomUUID } = require('crypto');
const { AppModule } = require('../dist/app.module');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');
const { authConfig } = require('../dist/config/auth.config');

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createSyntheticFixture(dataSource) {
  return dataSource.transaction(async (manager) => {
    await manager.query(`
    DELETE FROM school_terms term
    WHERE term.academic_year BETWEEN 3000 AND 8999
      AND term.semester = 3
      AND term.status = 'DRAFT'
      AND term.starts_on IS NULL
      AND term.ends_on IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM school_classrooms classroom WHERE classroom.school_term_id = term.id
      )
  `);
    const [source] = await manager.query(`
    SELECT student."SchoolID_Onec" AS school_id,
      student."GradeLevelID_Onec" AS grade_level_id,
      grade.label AS grade_label,
      COALESCE(student.student_status_code, student."StudentStatusID_Onec")::int AS status_code
    FROM student_term student
    JOIN grade_levels grade ON grade.id = student."GradeLevelID_Onec"
    JOIN schools school ON school.id = student."SchoolID_Onec"
    WHERE student.deleted_at IS NULL
      AND student.student_uuid IS NOT NULL
      AND COALESCE(student.student_status_code, student."StudentStatusID_Onec") IS NOT NULL
    ORDER BY student."SchoolID_Onec", student."GradeLevelID_Onec"
    LIMIT 1
  `);
    assert(source, 'No school/grade/status seed is available for the synthetic fixture');

    const academicYear = 3000 + (Math.floor(Date.now() / 1000) % 6000);
    const semester = 3;
    const [schoolIdRow] = await manager.query(
      `SELECT (COALESCE(MAX(id), 0) + 1000000)::int AS id FROM schools`,
    );
    const [school] = await manager.query(
      `INSERT INTO schools (id, name, province, district, sub_district, school_status)
       VALUES ($1, $2, 'AUTOMATED_TEST', 'AUTOMATED_TEST', 'AUTOMATED_TEST', 'ACTIVE')
       RETURNING id`,
      [schoolIdRow.id, `Attendance Operations Smoke ${academicYear}`],
    );
    const [term] = await manager.query(
      `INSERT INTO school_terms (school_id, academic_year, semester, status)
     VALUES ($1, $2, $3, 'DRAFT')
     RETURNING id`,
      [school.id, academicYear, semester],
    );
    const [classroom] = await manager.query(
      `INSERT INTO school_classrooms (
       school_term_id, school_id, grade_level_id, legacy_room_number,
       room_code, room_name, classroom_status
     )
     VALUES ($1, $2, $3, 99, '99', 'Attendance Smoke', 'ACTIVE')
     RETURNING id`,
      [term.id, school.id, source.grade_level_id],
    );

    const students = [];
    for (let index = 1; index <= 2; index += 1) {
      const personUuid = randomUUID();
      const studentUuid = randomUUID();
      const personId = `9${String(Date.now()).slice(-11)}${index}`;
      await manager.query(
        `INSERT INTO student_person (person_uuid, identity_status)
       VALUES ($1, 'ACTIVE')`,
        [personUuid],
      );
      await manager.query(
        `INSERT INTO student_term (
         student_uuid, person_uuid, "PersonID_Onec", "FirstName_Onec", "LastName_Onec",
         "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
         "StudentStatusID_Onec", student_status_code,
         "AcademicYear_Onec", "Semester_Onec", school_term_id, classroom_id
       )
       VALUES ($1, $2, $3, $4, 'Attendance Smoke', $5, $6, 99, $7, $7, $8, $9, $10, $11)`,
        [
          studentUuid,
          personUuid,
          personId,
          `Student ${index}`,
          school.id,
          source.grade_level_id,
          source.status_code,
          academicYear,
          semester,
          term.id,
          classroom.id,
        ],
      );
      students.push({ studentUuid, personUuid });
    }

    return {
      term_id: term.id,
      school_id: school.id,
      academic_year: academicYear,
      semester,
      grade_level_id: source.grade_level_id,
      grade_label: source.grade_label,
      room_id: 99,
      roster_count: students.length,
      original_status: 'DRAFT',
      original_starts_on: null,
      original_ends_on: null,
      synthetic: { schoolId: school.id, classroomId: classroom.id, students },
    };
  });
}

async function cleanupSyntheticFixture(dataSource, fixture) {
  if (!fixture?.synthetic) return;
  const studentUuids = fixture.synthetic.students.map((student) => student.studentUuid);
  const personUuids = fixture.synthetic.students.map((student) => student.personUuid);
  await dataSource.query(`DELETE FROM student_term WHERE student_uuid = ANY($1::uuid[])`, [
    studentUuids,
  ]);
  await dataSource.query(`DELETE FROM student_person WHERE person_uuid = ANY($1::uuid[])`, [
    personUuids,
  ]);
  await dataSource.query(`DELETE FROM school_classrooms WHERE id = $1`, [
    fixture.synthetic.classroomId,
  ]);
  await dataSource.query(`DELETE FROM school_terms WHERE id = $1`, [fixture.term_id]);
  await dataSource.query(`DELETE FROM schools WHERE id = $1`, [fixture.synthetic.schoolId]);
}

async function main() {
  console.error('[smoke] bootstrapping application');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  console.error('[smoke] application created');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: false,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: createValidationException,
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());
  await app.listen(0, '127.0.0.1');
  console.error('[smoke] HTTP server ready');

  const dataSource = app.get(DataSource);
  const jwtService = app.get(JwtService);
  const runtimeAuthConfig = app.get(authConfig.KEY);
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const deniedUsername = 'attendance_operations_smoke_no_permission';
  const settingsOnlyUsername = 'attendance_operations_smoke_settings_only';
  const allowedUsername = 'attendance_operations_smoke_allowed';
  let deniedActorId = null;
  let settingsOnlyActorId = null;
  let allowedActorId = null;
  let fixturePrepared = false;

  const fixtureRows = await dataSource.query(`
    SELECT term.id AS term_id, term.school_id, term.academic_year, term.semester,
      roster.grade_level_id, grade.label AS grade_label, roster.room_id, roster.roster_count,
      term.status AS original_status, term.starts_on AS original_starts_on,
      term.ends_on AS original_ends_on
    FROM school_terms term
    JOIN (
      SELECT "SchoolID_Onec" AS school_id, "AcademicYear_Onec" AS academic_year,
        "Semester_Onec" AS semester, "GradeLevelID_Onec" AS grade_level_id,
        "RoomID_Onec"::int AS room_id, COUNT(*)::int AS roster_count
      FROM student_term
      WHERE deleted_at IS NULL AND student_uuid IS NOT NULL
      GROUP BY 1, 2, 3, 4, 5
      HAVING COUNT(*) >= 2
    ) roster ON roster.school_id = term.school_id
      AND roster.academic_year = term.academic_year AND roster.semester = term.semester
    JOIN grade_levels grade ON grade.id = roster.grade_level_id
    WHERE term.status IN ('DRAFT', 'ACTIVE') AND term.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM school_calendar_days day
        WHERE day.school_term_id = term.id AND day.deleted_at IS NULL
      )
    ORDER BY roster.roster_count DESC, term.id
    LIMIT 1
  `);
  const fixture = fixtureRows[0] ?? (await createSyntheticFixture(dataSource));

  const roster = await dataSource.query(
    `SELECT student_uuid FROM student_term
     WHERE "SchoolID_Onec" = $1 AND "AcademicYear_Onec" = $2
       AND "Semester_Onec" = $3 AND "GradeLevelID_Onec" = $4
       AND "RoomID_Onec"::int = $5 AND deleted_at IS NULL
     ORDER BY student_uuid`,
    [
      fixture.school_id,
      fixture.academic_year,
      fixture.semester,
      fixture.grade_level_id,
      fixture.room_id,
    ],
  );
  assert(roster.length === fixture.roster_count, 'Roster fixture count changed during setup');
  console.error('[smoke] isolated fixture ready');

  const cookieFor = (userId) => {
    const token = jwtService.sign({ sub: userId });
    return `${runtimeAuthConfig.cookieName}=${encodeURIComponent(token)}`;
  };
  const request = async (method, path, expectedStatus, actorId, body) => {
    const headers = { 'content-type': 'application/json' };
    if (actorId) headers.cookie = cookieFor(actorId);
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : null;
    assert(
      response.status === expectedStatus,
      `${method} ${path}: expected ${expectedStatus}, received ${response.status}`,
    );
    return payload;
  };

  try {
    const [allowedActor] = await dataSource.query(
      `INSERT INTO users
         (username, password, status, permissions, "FirstName", "LastName", role, data_scope, data_origin_code)
       VALUES ($1, 'NOT_A_LOGIN_CREDENTIAL', 'ACTIVE', $2::jsonb,
         'Attendance', 'Allowed Smoke', 'ADMIN', $3::jsonb, 'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET
         status = 'ACTIVE', permissions = EXCLUDED.permissions,
         role = 'ADMIN', data_scope = EXCLUDED.data_scope, data_origin_code = 'AUTOMATED_TEST'
       RETURNING id`,
      [
        allowedUsername,
        JSON.stringify([
          'home',
          'attendance',
          'attendance-dashboard',
          'manage-attendance-calendar',
        ]),
        JSON.stringify({ school_ids: [fixture.school_id] }),
      ],
    );
    allowedActorId = Number(allowedActor.id);
    assert(Number.isInteger(allowedActorId), 'Allowed staff fixture was not created');
    const adminId = allowedActorId;
    const [deniedActor] = await dataSource.query(
      `INSERT INTO users
         (username, password, status, permissions, "FirstName", "LastName", role, data_scope, data_origin_code)
       VALUES ($1, 'NOT_A_LOGIN_CREDENTIAL', 'ACTIVE', '["home"]'::jsonb,
         'Attendance', 'Smoke', 'TEACHER', $2::jsonb, 'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET
         status = 'ACTIVE', permissions = '["home"]'::jsonb,
         role = 'TEACHER', data_scope = EXCLUDED.data_scope, data_origin_code = 'AUTOMATED_TEST'
       RETURNING id`,
      [deniedUsername, JSON.stringify({ school_ids: [fixture.school_id] })],
    );
    deniedActorId = Number(deniedActor.id);
    assert(Number.isInteger(deniedActorId), 'No-permission staff fixture was not created');
    const [settingsOnlyActor] = await dataSource.query(
      `INSERT INTO users
         (username, password, status, permissions, "FirstName", "LastName", role, data_scope, data_origin_code)
       VALUES ($1, 'NOT_A_LOGIN_CREDENTIAL', 'ACTIVE', '["home","settings"]'::jsonb,
         'Attendance', 'Settings Only', 'ADMIN', $2::jsonb, 'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET
         status = 'ACTIVE', permissions = '["home","settings"]'::jsonb,
         role = 'ADMIN', data_scope = EXCLUDED.data_scope, data_origin_code = 'AUTOMATED_TEST'
       RETURNING id`,
      [settingsOnlyUsername, JSON.stringify({ school_ids: [fixture.school_id] })],
    );
    settingsOnlyActorId = Number(settingsOnlyActor.id);
    assert(Number.isInteger(settingsOnlyActorId), 'Settings-only admin fixture was not created');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    await dataSource.query(
      `UPDATE school_terms
       SET status = 'DRAFT', starts_on = NULL, ends_on = NULL
       WHERE id = $1`,
      [fixture.term_id],
    );
    fixturePrepared = true;

    await request('GET', `/api/attendance/terms?schoolId=${fixture.school_id}`, 401);
    await request('GET', `/api/attendance/terms?schoolId=${fixture.school_id}`, 403, deniedActorId);

    const termBody = {
      schoolId: fixture.school_id,
      academicYear: fixture.academic_year,
      semester: fixture.semester,
      startsOn: today,
      endsOn: today,
      status: 'DRAFT',
    };
    await request(
      'GET',
      `/api/attendance/terms?schoolId=${fixture.school_id}`,
      403,
      settingsOnlyActorId,
    );
    await request('POST', '/api/attendance/terms', 403, settingsOnlyActorId, termBody);
    const draft = await request('POST', '/api/attendance/terms', 201, adminId, termBody);
    console.error('[smoke] term and authorization checks passed');
    assert(Number(draft.data.id) === Number(fixture.term_id), 'Term upsert returned another term');
    const generated = await request(
      'POST',
      `/api/attendance/terms/${fixture.term_id}/calendar/generate`,
      201,
      adminId,
      { schoolDays: [1, 2, 3, 4, 5, 6, 7] },
    );
    assert(generated.data.length === 1, 'Expected exactly one generated calendar day');
    const calendarDayId = generated.data[0].id;
    const active = await request('POST', '/api/attendance/terms', 201, adminId, {
      ...termBody,
      status: 'ACTIVE',
    });
    assert(active.data.status === 'ACTIVE', 'Term did not become ACTIVE');
    console.error('[smoke] calendar activated');

    await request('PATCH', `/api/attendance/calendar-days/${calendarDayId}`, 200, adminId, {
      dayType: 'HOLIDAY',
      reason: 'automated smoke test',
    });
    const presentRecords = roster.map((row) => ({
      student_id: row.student_uuid,
      status: 'P_PRESENT',
    }));
    await request('POST', '/api/attendance', 409, adminId, { records: presentRecords });
    // A submitted round rejects further autosaves the same way it rejects submits.
    await request('POST', '/api/attendance/marks', 409, adminId, {
      records: [presentRecords[0]],
    });
    await request('PATCH', `/api/attendance/calendar-days/${calendarDayId}`, 200, adminId, {
      dayType: 'SCHOOL_DAY',
      reason: 'automated smoke test',
    });

    const sessionQuery = new URLSearchParams({
      schoolId: String(fixture.school_id),
      grade: fixture.grade_label,
      room: String(fixture.room_id),
      date: today,
    });
    const beforeSubmit = await request(
      'GET',
      `/api/attendance/session?${sessionQuery}`,
      200,
      adminId,
    );
    assert(beforeSubmit.data.calendarConfigured === true, 'Calendar is not configured');
    assert(beforeSubmit.data.session === null, 'Session unexpectedly exists before submit');
    console.error('[smoke] holiday and session-context checks passed');

    // Draft autosave: a partial class, an open session, no audit row and a
    // per-student mark time that survives to the row.
    const markedAt = new Date(Date.now() - 90 * 1000).toISOString();
    const draftMarks = await request('POST', '/api/attendance/marks', 201, adminId, {
      records: [{ ...presentRecords[0], marked_at: markedAt }],
    });
    assert(draftMarks.session.status === 'OPEN', 'Draft must leave the session open');
    assert(draftMarks.recordedCount === 1, 'Draft recorded_count must count stored rows');
    assert(
      draftMarks.expectedRosterCount === presentRecords.length,
      'Draft must report the full expected roster',
    );
    const afterDraft = await request(
      'GET',
      `/api/attendance/session?${sessionQuery}`,
      200,
      adminId,
    );
    assert(
      afterDraft.data.session && afterDraft.data.session.status === 'OPEN',
      'Session must exist and stay OPEN after a draft save',
    );
    const [draftAudit] = await dataSource.query(
      `SELECT count(*)::int AS total FROM audit_log
       WHERE target_type = 'attendance_session' AND target_id = $1`,
      [afterDraft.data.session.id],
    );
    assert(draftAudit.total === 0, 'Draft autosave must not write a submit audit row');
    const [draftRow] = await dataSource.query(
      `SELECT marked_at, "RecordedAt" FROM attendance
       WHERE student_uuid = $1 AND "AttendanceDate" = $2`,
      [presentRecords[0].student_id, today],
    );
    assert(draftRow && draftRow.marked_at, 'Draft must persist marked_at');
    assert(
      new Date(draftRow.marked_at) <= new Date(draftRow.RecordedAt),
      'marked_at must never be after RecordedAt',
    );
    // The row is stored so the teacher can leave and come back, but a round
    // nobody submitted must not reach ประวัติ, the dashboard chart or the risk
    // engine — all three read the day views.
    const [draftDay] = await dataSource.query(
      `SELECT count(*)::int AS total FROM attendance_day
       WHERE student_uuid = $1 AND "AttendanceDate" = $2`,
      [presentRecords[0].student_id, today],
    );
    assert(draftDay.total === 0, 'A draft round must not appear in attendance_day');
    console.error('[smoke] draft autosave kept the session open and out of the day views');

    await request('POST', '/api/attendance/marks', 403, adminId, {
      records: [
        { student_id: '00000000-0000-4000-8000-0000000000ff', status: 'P_PRESENT' },
      ],
    });

    // Tapping the same status again clears the student: the stored row must go,
    // otherwise the next prefill would restore what the teacher just undid.
    const cleared = await request('POST', '/api/attendance/marks', 201, adminId, {
      cleared_student_ids: [presentRecords[0].student_id],
    });
    assert(cleared.recordedCount === 0, 'Clearing a mark must drop the recorded count');
    const [clearedRow] = await dataSource.query(
      `SELECT count(*)::int AS total FROM attendance
       WHERE student_uuid = $1 AND "AttendanceDate" = $2`,
      [presentRecords[0].student_id, today],
    );
    assert(clearedRow.total === 0, 'Clearing a mark must delete the stored row');
    await request('POST', '/api/attendance/marks', 403, adminId, {
      cleared_student_ids: ['00000000-0000-4000-8000-0000000000ff'],
    });
    console.error('[smoke] clearing a mark removed the row');

    const initialSubmit = await request('POST', '/api/attendance', 201, adminId, {
      records: presentRecords,
    });
    assert(initialSubmit.session.status === 'SUBMITTED', 'Initial submit did not lock session');
    assert(initialSubmit.session.revision === 1, 'Initial session revision must be one');
    const sessionId = initialSubmit.session.id;
    const [submittedDay] = await dataSource.query(
      `SELECT count(*)::int AS total FROM attendance_day
       WHERE student_uuid = $1 AND "AttendanceDate" = $2`,
      [presentRecords[0].student_id, today],
    );
    assert(submittedDay.total === 1, 'A submitted round must appear in attendance_day');
    console.error('[smoke] initial submit locked and reached the day views');
    await request('POST', '/api/attendance', 409, adminId, { records: presentRecords });
    // A submitted round rejects further autosaves the same way it rejects submits.
    await request('POST', '/api/attendance/marks', 409, adminId, {
      records: [presentRecords[0]],
    });
    await request('POST', `/api/attendance/sessions/${sessionId}/reopen`, 400, adminId, {
      reason: '',
    });

    const reopened = await request(
      'POST',
      `/api/attendance/sessions/${sessionId}/reopen`,
      201,
      adminId,
      { reason: 'correct first student status' },
    );
    assert(reopened.data.status === 'REOPENED', 'Session did not enter REOPENED state');
    assert(reopened.data.revision === 2, 'Reopen did not increment revision');
    console.error('[smoke] reopen validation passed');

    const correctedRecords = presentRecords.map((record, index) => ({
      ...record,
      status: index === 0 ? 'P_LEAVE' : record.status,
    }));
    const corrected = await request('POST', '/api/attendance', 201, adminId, {
      records: correctedRecords,
    });
    assert(corrected.session.status === 'SUBMITTED', 'Corrected session was not submitted');
    assert(corrected.session.revision === 2, 'Corrected session lost its revision');
    console.error('[smoke] correction submitted');

    const reconciliation = await request(
      'GET',
      `/api/attendance/reconciliation?termId=${fixture.term_id}&date=${today}&page=1&limit=50`,
      200,
      adminId,
    );
    const classRow = reconciliation.rows.find(
      (row) =>
        Number(row.gradeLevelId) === Number(fixture.grade_level_id) &&
        Number(row.room) === Number(fixture.room_id),
    );
    assert(classRow, 'Reconciliation did not include the submitted class');
    assert(classRow.operationalStatus === 'COMPLETED', 'Class is not reconciled as COMPLETED');
    assert(classRow.recordedCount === roster.length, 'Recorded count does not match roster');

    const finalContext = await request(
      'GET',
      `/api/attendance/session?${sessionQuery}`,
      200,
      adminId,
    );
    assert(finalContext.data.session.status === 'SUBMITTED', 'Session is not locked');
    assert(finalContext.data.session.revision === 2, 'Session revision is incorrect');

    const auditRows = await dataSource.query(
      `SELECT action, metadata FROM audit_log
       WHERE target_type = 'attendance_session' AND target_id = $1 ORDER BY created_at`,
      [sessionId],
    );
    assert(
      auditRows.map((row) => row.action).join(',') ===
        'ATTENDANCE_SUBMIT,ATTENDANCE_REOPEN,ATTENDANCE_SUBMIT',
      'Attendance audit sequence is incomplete',
    );
    const changes = auditRows[2].metadata.correctionChanges;
    assert(Array.isArray(changes) && changes.length === 1, 'Correction audit is incorrect');
    assert(changes[0].nextStatusCode === 4, 'Leave correction was not persisted as status code 4');

    console.log(
      JSON.stringify({
        status: 'attendance_operations_smoke_ok',
        checks: 20,
        rosterCount: roster.length,
        finalSessionStatus: finalContext.data.session.status,
        revision: finalContext.data.session.revision,
        reconciliation: classRow.operationalStatus,
        auditEvents: auditRows.length,
      }),
    );
  } finally {
    if (allowedActorId) {
      const smokeSessions = await dataSource.query(
        `SELECT id FROM attendance_sessions WHERE created_by = $1`,
        [allowedActorId],
      );
      const smokeSessionIds = smokeSessions.map((row) => row.id);
      if (smokeSessionIds.length > 0) {
        await dataSource.query(`DELETE FROM attendance WHERE session_id = ANY($1::uuid[])`, [
          smokeSessionIds,
        ]);
        await dataSource.query(`DELETE FROM attendance_sessions WHERE id = ANY($1::uuid[])`, [
          smokeSessionIds,
        ]);
      }
      await dataSource.query(
        `DELETE FROM school_calendar_days WHERE school_term_id = $1 AND created_by = $2`,
        [fixture.term_id, allowedActorId],
      );
    }
    if (fixturePrepared && !fixture.synthetic) {
      await dataSource.query(
        `UPDATE school_terms
         SET status = $2, starts_on = $3, ends_on = $4
         WHERE id = $1`,
        [
          fixture.term_id,
          fixture.original_status,
          fixture.original_starts_on,
          fixture.original_ends_on,
        ],
      );
    }
    await cleanupSyntheticFixture(dataSource, fixture);
    await dataSource.query(
      `
        UPDATE users
        SET status = 'DISABLED',
            deactivated_at = COALESCE(deactivated_at, NOW()),
            deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
            deactivation_note = COALESCE(deactivation_note, 'Retained automated attendance operations smoke fixture')
        WHERE username = ANY($1::text[])
          AND data_origin_code = 'AUTOMATED_TEST'
      `,
      [[allowedUsername, deniedUsername, settingsOnlyUsername]],
    );
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Attendance operations smoke failed');
  process.exitCode = 1;
});
