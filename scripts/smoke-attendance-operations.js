const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');
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
  let deniedActorId = null;

  const fixtureRows = await dataSource.query(`
    SELECT term.id AS term_id, term.school_id, term.academic_year, term.semester,
      roster.grade_level_id, grade.label AS grade_label, roster.room_id, roster.roster_count
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
    WHERE term.status = 'DRAFT' AND term.deleted_at IS NULL
      AND term.starts_on IS NULL AND term.ends_on IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM school_calendar_days day
        WHERE day.school_term_id = term.id AND day.deleted_at IS NULL
      )
    ORDER BY roster.roster_count DESC, term.id
    LIMIT 1
  `);
  assert(fixtureRows.length === 1, 'No isolated DRAFT term fixture is available');
  const fixture = fixtureRows[0];

  const [actors] = await dataSource.query(`
    SELECT MIN(id) FILTER (WHERE role = 'ADMIN')::int AS admin_id
    FROM users WHERE status = 'ACTIVE'
  `);
  assert(Number.isInteger(actors.admin_id), 'No active ADMIN actor is available');

  const roster = await dataSource.query(
    `SELECT student_uuid FROM student_term
     WHERE "SchoolID_Onec" = $1 AND "AcademicYear_Onec" = $2
       AND "Semester_Onec" = $3 AND "GradeLevelID_Onec" = $4
       AND "RoomID_Onec"::int = $5 AND deleted_at IS NULL
     ORDER BY student_uuid`,
    [fixture.school_id, fixture.academic_year, fixture.semester, fixture.grade_level_id, fixture.room_id],
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
    const adminId = actors.admin_id;
    const [deniedActor] = await dataSource.query(
      `INSERT INTO users
         (username, password, status, permissions, "FirstName", "LastName", role, data_scope)
       VALUES ($1, 'NOT_A_LOGIN_CREDENTIAL', 'ACTIVE', '["home"]'::jsonb,
         'Attendance', 'Smoke', 'TEACHER', $2::jsonb)
       ON CONFLICT (username) DO UPDATE SET
         status = 'ACTIVE', permissions = '["home"]'::jsonb,
         role = 'TEACHER', data_scope = EXCLUDED.data_scope
       RETURNING id`,
      [deniedUsername, JSON.stringify({ school_ids: [fixture.school_id] })],
    );
    deniedActorId = Number(deniedActor.id);
    assert(Number.isInteger(deniedActorId), 'No-permission staff fixture was not created');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

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
    const draft = await request('POST', '/api/attendance/terms', 201, adminId, termBody);
    console.error('[smoke] term and authorization checks passed');
    assert(Number(draft.data.id) === Number(fixture.term_id), 'Term upsert returned another term');
    const generated = await request(
      'POST', `/api/attendance/terms/${fixture.term_id}/calendar/generate`, 201, adminId,
      { schoolDays: [1, 2, 3, 4, 5, 6, 7] },
    );
    assert(generated.data.length === 1, 'Expected exactly one generated calendar day');
    const calendarDayId = generated.data[0].id;
    const active = await request('POST', '/api/attendance/terms', 201, adminId, {
      ...termBody, status: 'ACTIVE',
    });
    assert(active.data.status === 'ACTIVE', 'Term did not become ACTIVE');
    console.error('[smoke] calendar activated');

    await request('PATCH', `/api/attendance/calendar-days/${calendarDayId}`, 200, adminId, {
      dayType: 'HOLIDAY', reason: 'automated smoke test',
    });
    const presentRecords = roster.map((row) => ({ student_id: row.student_uuid, status: 'P_PRESENT' }));
    await request('POST', '/api/attendance', 409, adminId, { records: presentRecords });
    await request('PATCH', `/api/attendance/calendar-days/${calendarDayId}`, 200, adminId, {
      dayType: 'SCHOOL_DAY', reason: 'automated smoke test',
    });

    const sessionQuery = new URLSearchParams({
      schoolId: String(fixture.school_id), grade: fixture.grade_label,
      room: String(fixture.room_id), date: today,
    });
    const beforeSubmit = await request('GET', `/api/attendance/session?${sessionQuery}`, 200, adminId);
    assert(beforeSubmit.data.calendarConfigured === true, 'Calendar is not configured');
    assert(beforeSubmit.data.session === null, 'Session unexpectedly exists before submit');
    console.error('[smoke] holiday and session-context checks passed');

    const initialSubmit = await request('POST', '/api/attendance', 201, adminId, {
      records: presentRecords,
    });
    assert(initialSubmit.session.status === 'SUBMITTED', 'Initial submit did not lock session');
    assert(initialSubmit.session.revision === 1, 'Initial session revision must be one');
    const sessionId = initialSubmit.session.id;
    console.error('[smoke] initial submit locked');
    await request('POST', '/api/attendance', 409, adminId, { records: presentRecords });
    await request('POST', `/api/attendance/sessions/${sessionId}/reopen`, 400, adminId, { reason: '' });

    const reopened = await request(
      'POST', `/api/attendance/sessions/${sessionId}/reopen`, 201, adminId,
      { reason: 'correct first student status' },
    );
    assert(reopened.data.status === 'REOPENED', 'Session did not enter REOPENED state');
    assert(reopened.data.revision === 2, 'Reopen did not increment revision');
    console.error('[smoke] reopen validation passed');

    const correctedRecords = presentRecords.map((record, index) => ({
      ...record, status: index === 0 ? 'P_ABSENT' : record.status,
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
      (row) => Number(row.gradeLevelId) === Number(fixture.grade_level_id)
        && Number(row.room) === Number(fixture.room_id),
    );
    assert(classRow, 'Reconciliation did not include the submitted class');
    assert(classRow.operationalStatus === 'COMPLETED', 'Class is not reconciled as COMPLETED');
    assert(classRow.recordedCount === roster.length, 'Recorded count does not match roster');

    const finalContext = await request('GET', `/api/attendance/session?${sessionQuery}`, 200, adminId);
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

    console.log(JSON.stringify({
      status: 'attendance_operations_smoke_ok', checks: 18, rosterCount: roster.length,
      finalSessionStatus: finalContext.data.session.status,
      revision: finalContext.data.session.revision,
      reconciliation: classRow.operationalStatus, auditEvents: auditRows.length,
    }));
  } finally {
    if (deniedActorId) {
      await dataSource.query(`DELETE FROM users WHERE id = $1 AND username = $2`, [
        deniedActorId,
        deniedUsername,
      ]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Attendance operations smoke failed');
  process.exitCode = 1;
});
