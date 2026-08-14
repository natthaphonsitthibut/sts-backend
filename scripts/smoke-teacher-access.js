const { createHash, randomUUID } = require('crypto');
const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { EmailService } = require('../dist/common/email/email.service');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run teacher access smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const USERNAMES = {
  admin: 'teacher_access_smoke_admin',
  teacherOne: 'teacher_access_smoke_teacher_one',
  teacherTwo: 'teacher_access_smoke_teacher_two',
};
const FIXTURE_PREFIX = 'TA-SMOKE-';
const CALENDAR_REASON = 'Automated teacher access smoke';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function extractToken(accessUrl) {
  assert(typeof accessUrl === 'string', 'Issue/rotate response did not include accessUrl');
  const token = new URLSearchParams(new URL(accessUrl).hash.slice(1)).get('token');
  assert(token && token.length >= 32, 'accessUrl fragment did not contain a usable token');
  return token;
}

function tamperToken(token) {
  const finalCharacter = token.slice(-1);
  return `${token.slice(0, -1)}${finalCharacter === 'A' ? 'B' : 'A'}`;
}

async function parseJsonResponse(response) {
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

async function rawRequest(baseUrl, method, path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (options.token) headers['x-teacher-access-token'] = options.token;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { response, payload: await parseJsonResponse(response) };
}

async function request(baseUrl, method, path, expectedStatus, options = {}) {
  const result = await rawRequest(baseUrl, method, path, options);
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  assert(
    expected.includes(result.response.status),
    `${method} ${path}: expected ${expected.join('/')}, received ${result.response.status}; message=${
      result.payload?.message || 'none'
    }`,
  );
  return result;
}

function sessionCookieHeader(sessionCookieService, userId) {
  let captured;
  sessionCookieService.setSession(
    {
      cookie: (name, value) => {
        captured = `${name}=${value}`;
      },
    },
    userId,
  );
  assert(captured, 'Session cookie was not created');
  return captured;
}

async function upsertUser(dataSource, input) {
  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code, email, phone
      )
      VALUES (
        $1, 'NOT_A_LOGIN_CREDENTIAL', $2, $3, 'ACTIVE', $4::jsonb, $5,
        $6::jsonb, FALSE, 'Automated teacher access smoke',
        'AUTOMATED_TEST', NULL, NULL
      )
      ON CONFLICT (username) DO UPDATE
      SET password = 'NOT_A_LOGIN_CREDENTIAL',
          "FirstName" = EXCLUDED."FirstName",
          "LastName" = EXCLUDED."LastName",
          status = 'ACTIVE',
          permissions = EXCLUDED.permissions,
          role = EXCLUDED.role,
          data_scope = EXCLUDED.data_scope,
          must_change_password = FALSE,
          temporary_password_issued_at = NULL,
          temporary_password_expires_at = NULL,
          deactivated_at = NULL,
          deactivated_by = NULL,
          deactivation_reason_code = NULL,
          deactivation_note = NULL,
          affiliation = EXCLUDED.affiliation,
          data_origin_code = 'AUTOMATED_TEST',
          email = NULL,
          phone = NULL
      RETURNING id
    `,
    [
      input.username,
      input.firstName,
      input.lastName,
      JSON.stringify(input.permissions),
      input.role,
      JSON.stringify(input.dataScope),
    ],
  );
  return { id: Number(row.id), username: input.username };
}

async function cleanup(dataSource) {
  const users = await dataSource.query(
    `SELECT id, username FROM users WHERE username = ANY($1::text[])`,
    [Object.values(USERNAMES)],
  );
  if (users.length === 0) return;
  const userIds = users.map((row) => Number(row.id));
  const teacherIds = users
    .filter((row) => row.username !== USERNAMES.admin)
    .map((row) => Number(row.id));
  const [admin] = users.filter((row) => row.username === USERNAMES.admin);
  const adminId = admin ? Number(admin.id) : null;

  if (adminId) {
    await dataSource.query(`DELETE FROM teacher_line_invitations WHERE issued_by = $1`, [adminId]);
    await dataSource.query(`DELETE FROM teacher_access_grants WHERE issued_by = $1`, [adminId]);
  }

  const students = await dataSource.query(
    `SELECT student_uuid, person_uuid FROM student_term WHERE "PersonID_Onec" LIKE $1`,
    [`${FIXTURE_PREFIX}%`],
  );
  const studentIds = students.map((row) => row.student_uuid);
  const personIds = students.map((row) => row.person_uuid);
  const sessions =
    teacherIds.length > 0
      ? await dataSource.query(
          `SELECT id FROM attendance_sessions WHERE created_by = ANY($1::int[])`,
          [teacherIds],
        )
      : [];
  const sessionIds = sessions.map((row) => row.id);
  if (sessionIds.length > 0 || studentIds.length > 0) {
    await dataSource.query(
      `
        DELETE FROM attendance
        WHERE ($1::uuid[] <> '{}'::uuid[] AND session_id = ANY($1::uuid[]))
           OR ($2::uuid[] <> '{}'::uuid[] AND student_uuid = ANY($2::uuid[]))
      `,
      [sessionIds, studentIds],
    );
  }
  if (sessionIds.length > 0) {
    await dataSource.query(`DELETE FROM attendance_sessions WHERE id = ANY($1::uuid[])`, [
      sessionIds,
    ]);
  }
  if (studentIds.length > 0) {
    const [{ case_count: caseCount }] = await dataSource.query(
      `SELECT COUNT(*)::int AS case_count FROM cases WHERE student_uuid = ANY($1::uuid[])`,
      [studentIds],
    );
    assert(caseCount === 0, 'Smoke students unexpectedly have cases; refusing destructive cleanup');
    await dataSource.query(`DELETE FROM student_term WHERE student_uuid = ANY($1::uuid[])`, [
      studentIds,
    ]);
  }
  if (personIds.length > 0) {
    await dataSource.query(`DELETE FROM student_person WHERE person_uuid = ANY($1::uuid[])`, [
      personIds,
    ]);
  }

  if (adminId) {
    await dataSource.query(
      `DELETE FROM classroom_teacher_assignments WHERE created_by = $1`,
      [adminId],
    );
    await dataSource.query(`DELETE FROM school_teacher_memberships WHERE created_by = $1`, [
      adminId,
    ]);
    await dataSource.query(
      `DELETE FROM school_classrooms WHERE created_by = $1 AND room_name = 'Teacher access smoke'`,
      [adminId],
    );
    await dataSource.query(
      `DELETE FROM school_calendar_days WHERE created_by = $1 AND reason = $2`,
      [adminId, CALENDAR_REASON],
    );
  }

  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(
            deactivation_note,
            'Retained automated teacher access smoke fixture'
          )
      WHERE id = ANY($1::int[])
    `,
    [userIds],
  );
}

async function assertSchemaPrerequisites(dataSource) {
  const [tables] = await dataSource.query(
    `
      SELECT
        to_regclass('public.teacher_access_grants')::text AS grants,
        to_regclass('public.teacher_access_grant_capabilities')::text AS capabilities,
        to_regclass('public.teacher_access_grant_assignments')::text AS assignments,
        to_regclass('public.school_teacher_memberships')::text AS memberships,
        to_regclass('public.classroom_teacher_assignments')::text AS teacher_assignments
    `,
  );
  assert(
    Object.values(tables).every(Boolean),
    'Teacher access/school structure migrations are not applied to the smoke database',
  );
}

async function createFixture(dataSource, actors) {
  const schools = await dataSource.query(
    `SELECT id, name FROM schools WHERE school_status = 'ACTIVE' ORDER BY id`,
  );
  assert(schools.length >= 2, 'Teacher access smoke requires two active schools');
  const [term] = await dataSource.query(
    `
      SELECT term.id, term.school_id, term.academic_year, term.semester,
             term.starts_on::text, term.ends_on::text, school.name AS school_name
      FROM school_terms term
      JOIN schools school ON school.id = term.school_id
      WHERE term.status = 'ACTIVE'
        AND term.deleted_at IS NULL
        AND school.school_status = 'ACTIVE'
        AND CURRENT_DATE BETWEEN term.starts_on AND term.ends_on
      ORDER BY term.ends_on DESC, term.id
      LIMIT 1
    `,
  );
  assert(term, 'Teacher access smoke requires an active term covering today');
  const schoolB = schools.find((school) => Number(school.id) !== Number(term.school_id));
  assert(schoolB, 'Teacher access smoke requires a second active school for scope denial');
  const [grade] = await dataSource.query(`SELECT id FROM grade_levels ORDER BY id LIMIT 1`);
  const [subject] = await dataSource.query(
    `SELECT id FROM subjects WHERE is_active = TRUE ORDER BY id LIMIT 1`,
  );
  const [studentStatus] = await dataSource.query(
    `
      SELECT code FROM student_status
      WHERE category = 'ACTIVE' AND is_enabled = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
      LIMIT 1
    `,
  );
  assert(grade && subject && studentStatus, 'Grade, subject, or active student status is missing');

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const roomNumber = 1_900_000_000 + (Date.now() % 100_000_000);
  const [classroom] = await dataSource.query(
    `
      INSERT INTO school_classrooms (
        school_term_id, school_id, grade_level_id, legacy_room_number,
        room_code, room_name, classroom_status, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, 'Teacher access smoke', 'ACTIVE', $6, $6)
      RETURNING id
    `,
    [
      term.id,
      term.school_id,
      grade.id,
      roomNumber,
      // room_code must equal legacy_room_number since the numeric-room-code
      // migration; the fixture is identified by its room_name marker instead.
      String(roomNumber),
      actors.admin.id,
    ],
  );

  const teacherMemberships = [];
  for (const teacher of [actors.teacherOne, actors.teacherTwo]) {
    const [membership] = await dataSource.query(
      `
        INSERT INTO school_teacher_memberships (
          school_id, teacher_user_id, membership_status, started_on, created_by, updated_by
        )
        VALUES ($1, $2, 'ACTIVE', CURRENT_DATE, $3, $3)
        RETURNING id, teacher_id
      `,
      [term.school_id, teacher.id, actors.admin.id],
    );
    // The teacher identity row is created by the membership trigger. EMAIL_OTP
    // needs an address on it (smoke accounts deliberately carry none), and a
    // row left over from an earlier run is INACTIVE because cleanup disables
    // the account it was copied from.
    await dataSource.query(
      `UPDATE teachers SET email = $2, teacher_status = 'ACTIVE', deleted_at = NULL WHERE id = $1`,
      [membership.teacher_id, `${teacher.username}@sts-smoke.invalid`],
    );
    teacherMemberships.push({
      id: Number(membership.id),
      teacherId: Number(membership.teacher_id),
      teacher,
    });
  }

  const [homeroomAssignment] = await dataSource.query(
    `
      INSERT INTO classroom_teacher_assignments (
        school_id, classroom_id, teacher_membership_id, subject_id,
        assignment_kind, assignment_status, effective_on, created_by, updated_by
      )
      VALUES ($1, $2, $3, NULL, 'HOMEROOM', 'ACTIVE', CURRENT_DATE, $4, $4)
      RETURNING id
    `,
    [term.school_id, classroom.id, teacherMemberships[0].id, actors.admin.id],
  );
  const subjectAssignments = [];
  for (const membership of teacherMemberships) {
    const [assignment] = await dataSource.query(
      `
        INSERT INTO classroom_teacher_assignments (
          school_id, classroom_id, teacher_membership_id, subject_id,
          assignment_kind, assignment_status, effective_on, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, 'SUBJECT', 'ACTIVE', CURRENT_DATE, $5, $5)
        RETURNING id
      `,
      [term.school_id, classroom.id, membership.id, subject.id, actors.admin.id],
    );
    subjectAssignments.push({ id: Number(assignment.id), membership });
  }

  const students = [];
  for (let index = 1; index <= 2; index += 1) {
    const personUuid = randomUUID();
    const studentUuid = randomUUID();
    const personId = `${FIXTURE_PREFIX}${suffix}-${index}`;
    await dataSource.query(
      `
        INSERT INTO student_person (
          person_uuid, identity_status, created_by, updated_by
        )
        VALUES ($1, 'ACTIVE', $2, $2)
      `,
      [personUuid, actors.admin.id],
    );
    await dataSource.query(
      `
        INSERT INTO student_term (
          student_uuid, person_uuid, "PersonID_Onec", "FirstName_Onec", "LastName_Onec",
          "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
          "StudentStatusID_Onec", student_status_code,
          "AcademicYear_Onec", "Semester_Onec", school_term_id, classroom_id,
          created_by, updated_by
        )
        VALUES (
          $1, $2, $3, $4, 'Teacher Access Smoke',
          $5, $6, $7, $8, $8, $9, $10, $11, $12, $13, $13
        )
      `,
      [
        studentUuid,
        personUuid,
        personId,
        `Student ${index}`,
        term.school_id,
        grade.id,
        roomNumber,
        studentStatus.code,
        term.academic_year,
        term.semester,
        term.id,
        classroom.id,
        actors.admin.id,
      ],
    );
    students.push({ studentUuid, personUuid });
  }

  const [attendanceDate] = await dataSource.query(
    `
      SELECT candidate.day::date::text AS attendance_date,
             calendar.id AS calendar_id,
             calendar.day_type
      FROM generate_series(
        $1::date,
        LEAST($2::date, CURRENT_DATE),
        INTERVAL '1 day'
      ) candidate(day)
      LEFT JOIN school_calendar_days calendar
        ON calendar.school_term_id = $3
       AND calendar.calendar_date = candidate.day::date
       AND calendar.deleted_at IS NULL
      WHERE calendar.id IS NULL OR calendar.day_type = 'SCHOOL_DAY'
      ORDER BY (calendar.id IS NOT NULL) DESC, candidate.day DESC
      LIMIT 1
    `,
    [term.starts_on, term.ends_on, term.id],
  );
  let calendarCreated = false;
  if (attendanceDate && !attendanceDate.calendar_id) {
    const inserted = await dataSource.query(
      `
        INSERT INTO school_calendar_days (
          school_term_id, calendar_date, day_type, reason, source, created_by, updated_by
        )
        VALUES ($1, $2, 'SCHOOL_DAY', $3, 'MANUAL', $4, $4)
        ON CONFLICT (school_term_id, calendar_date) DO NOTHING
        RETURNING id
      `,
      [term.id, attendanceDate.attendance_date, CALENDAR_REASON, actors.admin.id],
    );
    calendarCreated = inserted.length === 1;
  }

  return {
    term,
    schoolB,
    classroom: { id: Number(classroom.id), roomNumber },
    teacherMemberships,
    homeroomAssignmentId: Number(homeroomAssignment.id),
    subjectAssignments,
    students,
    attendanceDate: attendanceDate?.attendance_date || null,
    calendarCreated,
  };
}

async function issueGrant(baseUrl, adminCookie, body) {
  const issued = await request(baseUrl, 'POST', '/api/teacher-access-grants', 201, {
    headers: { cookie: adminCookie },
    body,
  });
  const token = extractToken(issued.payload?.data?.accessUrl);
  return { id: issued.payload.data.id, token, data: issued.payload.data };
}

/**
 * Captures the emailed OTP without ever sending mail: the smoke boots the app
 * in-process, so it can wrap the shared EmailService the same way a test double
 * would. There is no other way to read a code that is stored hashed.
 */
function captureOtpCodes(app) {
  const emailService = app.get(EmailService);
  const codes = [];
  const original = emailService.sendOTP.bind(emailService);
  emailService.sendOTP = async (email, code, minutes) => {
    codes.push({ email, code });
    return { success: true, provider: 'SMOKE_CAPTURE' };
  };
  return {
    codes,
    latestFor(email) {
      for (let index = codes.length - 1; index >= 0; index -= 1) {
        if (codes[index].email === email) return codes[index].code;
      }
      return null;
    },
    restore() {
      emailService.sendOTP = original;
    },
  };
}

async function verifiedSession(baseUrl, token, otpCapture, email) {
  const challenge = await request(baseUrl, 'POST', '/api/teacher-access/otp/request', 201, {
    token,
  });
  assert(
    challenge.payload?.data?.maskedEmail && !challenge.payload.data.maskedEmail.startsWith(email),
    'OTP request did not mask the teacher email',
  );
  const code = otpCapture.latestFor(email);
  assert(code && /^\d{6}$/.test(code), 'OTP code was not delivered to the teacher email');
  assert(
    !JSON.stringify(challenge.payload).includes(code),
    'OTP request response leaked the code itself',
  );
  await request(baseUrl, 'POST', '/api/teacher-access/otp/verify', 400, {
    token,
    body: { otp: code === '000000' ? '111111' : '000000' },
  });
  const verified = await request(baseUrl, 'POST', '/api/teacher-access/otp/verify', 201, {
    token,
    body: { otp: code },
  });
  const sessionToken = verified.payload?.data?.sessionToken;
  assert(sessionToken, 'OTP verify did not return a session token');
  return sessionToken;
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
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

  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const otpCapture = captureOtpCodes(app);
  let lockRunner;

  try {
    await assertSchemaPrerequisites(dataSource);
    const existingSchools = await dataSource.query(
      `SELECT id FROM schools WHERE school_status = 'ACTIVE' ORDER BY id LIMIT 2`,
    );
    assert(existingSchools.length === 2, 'Teacher access smoke requires two active schools');
    const initialSchoolId = Number(existingSchools[0].id);
    const actors = {
      admin: await upsertUser(dataSource, {
        username: USERNAMES.admin,
        firstName: 'Teacher Access',
        lastName: 'Smoke Admin',
        role: 'ADMIN',
        permissions: ['manage-teacher-access'],
        dataScope: { school_ids: [initialSchoolId] },
      }),
      teacherOne: await upsertUser(dataSource, {
        username: USERNAMES.teacherOne,
        firstName: 'Teacher One',
        lastName: 'Smoke',
        role: 'TEACHER',
        permissions: ['attendance'],
        dataScope: { school_ids: [initialSchoolId] },
      }),
      teacherTwo: await upsertUser(dataSource, {
        username: USERNAMES.teacherTwo,
        firstName: 'Teacher Two',
        lastName: 'Smoke',
        role: 'TEACHER',
        permissions: ['attendance'],
        dataScope: { school_ids: [initialSchoolId] },
      }),
    };
    await cleanup(dataSource);

    const fixture = await createFixture(dataSource, actors);
    for (const actor of Object.values(actors)) {
      await dataSource.query(
        `UPDATE users SET status = 'ACTIVE', data_scope = $2::jsonb,
          deactivated_at = NULL, deactivated_by = NULL,
          deactivation_reason_code = NULL, deactivation_note = NULL
         WHERE id = $1`,
        [actor.id, JSON.stringify({ school_ids: [Number(fixture.term.school_id)] })],
      );
    }
    const adminCookie = sessionCookieHeader(sessionCookieService, actors.admin.id);
    const termId = Number(fixture.term.id);
    // Narrowed to the fixture teachers: a demo school carries hundreds, and the
    // roster is paginated like every other list.
    const rosterUrl =
      `/api/teacher-access-grants/teacher-roster` +
      `?schoolId=${fixture.term.school_id}&schoolTermId=${termId}&page=1&limit=50&search=Smoke`;

    // 1. Every teacher of the term is listed, with no link yet.
    const beforeIssue = await request(baseUrl, 'GET', rosterUrl, 200, {
      headers: { cookie: adminCookie },
    });
    const rowFor = (payload, membershipId) =>
      payload?.data?.find((row) => Number(row.teacherMembershipId) === membershipId);
    const teacherOneRow = rowFor(beforeIssue.payload, fixture.teacherMemberships[0].id);
    const teacherTwoRow = rowFor(beforeIssue.payload, fixture.teacherMemberships[1].id);
    assert(teacherOneRow && teacherTwoRow, 'Teacher roster did not list both smoke teachers');
    assert(
      teacherOneRow.linkStatus === 'NOT_CREATED' && teacherTwoRow.linkStatus === 'NOT_CREATED',
      'Teacher roster did not start from NOT_CREATED',
    );
    assert(
      teacherOneRow.assignmentCount >= 2,
      'Teacher one should carry both the homeroom and the subject assignment',
    );

    // 2. Issue one link per teacher: the link covers every assignment, no picking.
    const grantOne = await issueGrant(baseUrl, adminCookie, {
      teacherMembershipId: fixture.teacherMemberships[0].id,
      schoolTermId: termId,
    });
    assert(
      grantOne.data.capabilities.includes('HOMEROOM_ATTENDANCE') &&
        grantOne.data.capabilities.includes('SUBJECT_ATTENDANCE') &&
        grantOne.data.capabilities.includes('TEACHER_OBSERVATION'),
      'Derived capabilities did not cover the teacher assignments',
    );
    assert(
      grantOne.data.stepUpPolicy === 'EMAIL_OTP',
      'New links must default to email OTP step-up',
    );
    assert(
      new Date(grantOne.data.expiresAt).toISOString().slice(0, 10) === fixture.term.ends_on,
      'Link expiry is not the end of the term',
    );

    // 3. Issuing for picked rows only touches those rows: teacher one already has
    //    a link so the batch issues nothing and says why, and teacher two — who was
    //    not picked — is still without a link afterwards.
    const pickedBulk = await request(baseUrl, 'POST', '/api/teacher-access-grants/bulk', 201, {
      headers: { cookie: adminCookie },
      body: {
        schoolTermId: termId,
        teacherMembershipIds: [fixture.teacherMemberships[0].id],
      },
    });
    assert(
      Number(pickedBulk.payload?.data?.issued) === 0,
      'Picked bulk issue re-issued a link the teacher already had',
    );
    assert(
      pickedBulk.payload?.data?.skipped?.[0]?.teacherMembershipId ===
        fixture.teacherMemberships[0].id &&
        pickedBulk.payload.data.skipped[0].reason.includes('มีลิงก์'),
      'Picked bulk issue did not report why the teacher was skipped',
    );
    const afterPicked = await request(baseUrl, 'GET', rosterUrl, 200, {
      headers: { cookie: adminCookie },
    });
    assert(
      rowFor(afterPicked.payload, fixture.teacherMemberships[1].id).linkStatus === 'NOT_CREATED',
      'Picked bulk issue created a link for a teacher that was not picked',
    );

    // 4. The bulk action covers the teachers that still have none, and skips the
    //    one that already does instead of rotating it.
    const bulk = await request(baseUrl, 'POST', '/api/teacher-access-grants/bulk', 201, {
      headers: { cookie: adminCookie },
      body: { schoolTermId: termId },
    });
    assert(Number(bulk.payload?.data?.issued) >= 1, 'Bulk issue did not create any link');
    const afterIssue = await request(baseUrl, 'GET', rosterUrl, 200, {
      headers: { cookie: adminCookie },
    });
    const teacherOneAfter = rowFor(afterIssue.payload, fixture.teacherMemberships[0].id);
    const teacherTwoAfter = rowFor(afterIssue.payload, fixture.teacherMemberships[1].id);
    assert(
      teacherOneAfter.grantId === grantOne.id,
      'Bulk issue replaced a link that already existed',
    );
    assert(
      teacherOneAfter.linkStatus === 'ACTIVE' && teacherTwoAfter.linkStatus === 'ACTIVE',
      'Teacher roster did not report both links as active',
    );
    assert(teacherOneAfter.canCopyLink === true, 'Newly issued link must be copyable again');

    // 4. The stored ciphertext gives the same working link back, and nothing
    //    persists the raw token.
    const copied = await request(
      baseUrl,
      'GET',
      `/api/teacher-access-grants/${grantOne.id}/link`,
      200,
      { headers: { cookie: adminCookie } },
    );
    assert(
      extractToken(copied.payload?.data?.accessUrl) === grantOne.token,
      'Copy link did not return the issued token',
    );
    const [stored] = await dataSource.query(
      `
        SELECT token_hash,
               token_encrypted,
               POSITION($2 IN COALESCE(token_encrypted, ''))::int AS cipher_leak,
               POSITION($2 IN (to_jsonb(grant_row) - 'token_encrypted')::text)::int AS raw_position
        FROM teacher_access_grants grant_row
        WHERE id = $1
      `,
      [grantOne.id, grantOne.token],
    );
    assert(stored?.token_hash === sha256(grantOne.token), 'Stored token hash did not match SHA-256');
    assert(stored.token_encrypted, 'Link was issued without a redisplayable ciphertext');
    assert(stored.cipher_leak === 0, 'Ciphertext contains the raw token');
    assert(stored.raw_position === 0, 'Raw teacher token was persisted in grant storage');
    const [{ audit_raw_count: auditRawCount }] = await dataSource.query(
      `
        SELECT COUNT(*)::int AS audit_raw_count
        FROM audit_log
        WHERE POSITION($1 IN COALESCE(metadata::text, '')) > 0
      `,
      [grantOne.token],
    );
    assert(auditRawCount === 0, 'Raw teacher token was persisted in audit metadata');

    // 5. Nothing is readable before the OTP is verified.
    await request(baseUrl, 'GET', '/api/teacher-access/context', 401, { token: grantOne.token });
    await request(baseUrl, 'GET', '/api/teacher-access/context', 404, {
      token: tamperToken(grantOne.token),
    });

    const teacherOneEmail = `${USERNAMES.teacherOne}@sts-smoke.invalid`;
    const sessionOne = await verifiedSession(baseUrl, grantOne.token, otpCapture, teacherOneEmail);
    const sessionHeaders = { 'x-teacher-access-session': sessionOne };

    // 6. With the session, the teacher sees their own classes and roster.
    const context = await request(baseUrl, 'GET', '/api/teacher-access/context', 200, {
      token: grantOne.token,
      headers: sessionHeaders,
    });
    assert(
      context.payload?.data?.teacherDisplayName.includes('Teacher One'),
      'Verified context did not identify teacher one',
    );
    assert(
      context.payload.data.assignments.length >= 2,
      'Verified context did not return both classes of the teacher',
    );
    assert(
      context.payload.data.assignments.every((assignment) => assignment.cardCoverColor),
      'Classroom cards are missing their cover colour',
    );
    const roster = await request(
      baseUrl,
      'GET',
      `/api/teacher-access/roster?assignmentId=${fixture.homeroomAssignmentId}&page=1&limit=20`,
      200,
      { token: grantOne.token, headers: sessionHeaders },
    );
    assert(roster.payload?.data?.length === 2, 'Homeroom roster did not return two students');
    assert(
      'studentNumber' in roster.payload.data[0] && 'riskTier' in roster.payload.data[0],
      'Roster rows are missing the columns the classroom screen renders',
    );

    // 7. Attendance write + the history the teacher reads back.
    let attendanceChecked = false;
    if (fixture.attendanceDate) {
      const attendance = await request(baseUrl, 'POST', '/api/teacher-access/attendance', 201, {
        token: grantOne.token,
        headers: sessionHeaders,
        body: {
          assignmentId: fixture.homeroomAssignmentId,
          date: fixture.attendanceDate,
          records: fixture.students.map((student) => ({
            studentId: student.studentUuid,
            status: 'P_PRESENT',
          })),
        },
      });
      const sessionId = attendance.payload?.data?.session?.id;
      assert(sessionId, 'Homeroom attendance response did not include a session');
      const [attendanceSession] = await dataSource.query(
        `SELECT status, submitted_by, recorded_count FROM attendance_sessions WHERE id = $1`,
        [sessionId],
      );
      assert(attendanceSession?.status === 'SUBMITTED', 'Attendance session was not submitted');
      assert(
        Number(attendanceSession.submitted_by) === actors.teacherOne.id,
        'Attendance was not attributed to teacher one',
      );
      const history = await request(
        baseUrl,
        'GET',
        `/api/teacher-access/attendance-history?assignmentId=${fixture.homeroomAssignmentId}&page=1&limit=20`,
        200,
        { token: grantOne.token, headers: sessionHeaders },
      );
      const historyRow = history.payload?.data?.find(
        (row) => row.attendanceDate === fixture.attendanceDate,
      );
      assert(historyRow, 'Attendance history did not include the round just recorded');
      assert(
        Number(historyRow.presentCount) === fixture.students.length,
        'Attendance history counted the wrong number of present students',
      );
      attendanceChecked = true;
    }

    // 8. Rotation invalidates the old link; revocation closes the new one.
    const rotated = await request(
      baseUrl,
      'POST',
      `/api/teacher-access-grants/${grantOne.id}/rotate`,
      201,
      { headers: { cookie: adminCookie } },
    );
    const rotatedToken = extractToken(rotated.payload?.data?.accessUrl);
    assert(rotatedToken !== grantOne.token, 'Rotate returned the original token');
    await request(baseUrl, 'GET', '/api/teacher-access/context', 404, {
      token: grantOne.token,
      headers: sessionHeaders,
    });
    await request(baseUrl, 'GET', '/api/teacher-access/context', 401, { token: rotatedToken });

    // 9. The public read still waits on the real grant row lock.
    const grantTwoId = teacherTwoAfter.grantId;
    const copiedTwo = await request(
      baseUrl,
      'GET',
      `/api/teacher-access-grants/${grantTwoId}/link`,
      200,
      { headers: { cookie: adminCookie } },
    );
    const tokenTwo = extractToken(copiedTwo.payload?.data?.accessUrl);
    const sessionTwo = await verifiedSession(
      baseUrl,
      tokenTwo,
      otpCapture,
      `${USERNAMES.teacherTwo}@sts-smoke.invalid`,
    );
    lockRunner = dataSource.createQueryRunner();
    await lockRunner.connect();
    await lockRunner.startTransaction();
    await lockRunner.query(`SELECT id FROM teacher_access_grants WHERE id = $1 FOR UPDATE`, [
      grantTwoId,
    ]);
    let contextSettled = false;
    let revokeSettled = false;
    const concurrentContext = rawRequest(baseUrl, 'GET', '/api/teacher-access/context', {
      token: tokenTwo,
      headers: { 'x-teacher-access-session': sessionTwo },
    }).then((result) => {
      contextSettled = true;
      return result;
    });
    await delay(120);
    assert(!contextSettled, 'Public context did not wait on the real grant row lock');
    const concurrentRevoke = rawRequest(
      baseUrl,
      'POST',
      `/api/teacher-access-grants/${grantTwoId}/revoke`,
      {
        headers: { cookie: adminCookie },
        body: { reason: 'Automated concurrent revoke smoke' },
      },
    ).then((result) => {
      revokeSettled = true;
      return result;
    });
    await delay(120);
    assert(!contextSettled && !revokeSettled, 'Concurrent requests bypassed the grant row lock');
    await lockRunner.commitTransaction();
    await lockRunner.release();
    lockRunner = null;
    const [contextRaceResult, revokeRaceResult] = await Promise.all([
      concurrentContext,
      concurrentRevoke,
    ]);
    assert(
      [200, 410].includes(contextRaceResult.response.status),
      `Concurrent context returned ${contextRaceResult.response.status}`,
    );
    assert(revokeRaceResult.response.status === 201, 'Concurrent revoke did not succeed');
    await request(baseUrl, 'GET', '/api/teacher-access/context', 410, {
      token: tokenTwo,
      headers: { 'x-teacher-access-session': sessionTwo },
    });

    // 10. Per-classroom attendance links can no longer be created at all.
    await request(baseUrl, 'POST', '/api/tasks', 400, {
      headers: { cookie: adminCookie },
      body: {
        task_type: 'ATTENDANCE',
        assigned_to_name: 'ครูทดสอบ ระบบ',
        target_school_id: Number(fixture.term.school_id),
      },
    });

    console.log(
      JSON.stringify({
        status: 'teacher_access_smoke_ok',
        attendanceChecked,
        checked: [
          'teacher roster lists every teacher with NOT_CREATED before issuing',
          'per-teacher issue derives capabilities and expires at term end',
          'issuing for picked rows only covers those rows and explains the skips',
          'bulk issue fills the gaps and leaves existing links alone',
          'copy link returns the issued token from ciphertext, storage stays hash-only',
          'guest reads are refused until the emailed OTP is verified',
          'wrong OTP rejected; verified session unlocks context, roster and attendance',
          attendanceChecked ? 'attendance write and history read back the same round' : null,
          'rotate invalidates the old token; revoke closes the link',
          'real row lock serializes context and revoke',
          'legacy per-classroom attendance link creation is refused',
        ].filter(Boolean),
      }),
    );
  } finally {
    otpCapture.restore();
    if (lockRunner) {
      if (lockRunner.isTransactionActive) await lockRunner.rollbackTransaction();
      await lockRunner.release();
    }
    await cleanup(dataSource);
    await app.close();
  }
}

module.exports = {
  USERNAMES,
  assert,
  assertSchemaPrerequisites,
  captureOtpCodes,
  cleanup,
  createFixture,
  issueGrant,
  sessionCookieHeader,
  upsertUser,
  verifiedSession,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}
