const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run student contact smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function parseJsonResponse(response) {
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

function cookieHeader(response) {
  const cookie = response.headers.get('set-cookie');
  assert(cookie && cookie.includes('HttpOnly'), 'Login did not return an httpOnly session cookie');
  return cookie.split(';')[0];
}

async function request(baseUrl, method, path, expectedStatus, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await parseJsonResponse(response);
  assert(
    response.status === expectedStatus,
    `${method} ${path}: expected ${expectedStatus}, received ${response.status} (${JSON.stringify(payload)})`,
  );
  return { response, payload };
}

function randomThaiNationalId() {
  let digits = '';
  for (let i = 0; i < 13; i += 1) {
    digits += Math.floor(Math.random() * 10);
  }
  return digits;
}

async function upsertSmokeUser(
  dataSource,
  { username, passwordHash, firstName, lastName, permissions, role, dataScope, personUuid },
) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = $3,
            "LastName" = $4,
            status = 'ACTIVE',
            permissions = $5::jsonb,
            role = $6,
            data_scope = $7::jsonb,
            person_uuid = $8,
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            affiliation = 'Automated student contact smoke',
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL,
            line_id = NULL
        WHERE id = $1
      `,
      [
        existing.id,
        passwordHash,
        firstName,
        lastName,
        JSON.stringify(permissions),
        role,
        JSON.stringify(dataScope),
        personUuid ?? null,
      ],
    );
    return existing;
  }

  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, person_uuid, must_change_password, affiliation, data_origin_code
      )
      VALUES ($1, $2, $3, $4, 'ACTIVE', $5::jsonb, $6, $7::jsonb, $8, FALSE, $9, 'AUTOMATED_TEST')
      RETURNING id
    `,
    [
      username,
      passwordHash,
      firstName,
      lastName,
      JSON.stringify(permissions),
      role,
      JSON.stringify(dataScope),
      personUuid ?? null,
      'Automated student contact smoke',
    ],
  );
  return row;
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
  const passwordService = app.get(PasswordService);
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const adminUsername = 'student_contact_smoke_admin';
  const studentUsername = 'student_contact_smoke_student';
  const adminPassword = `Admin-${suffix}-Password`;
  const studentPassword = `Student-${suffix}-Password`;

  let personUuid = null;
  let studentUuid = null;

  try {
    // student_term inserts must resolve to a configured school term + ACTIVE
    // classroom (structure trigger), so anchor the fixture on an existing one.
    const [classroom] = await dataSource.query(
      `
        SELECT c.school_id, c.grade_level_id, c.legacy_room_number,
               t.academic_year, t.semester
        FROM school_classrooms c
        JOIN school_terms t ON t.id = c.school_term_id
        WHERE c.classroom_status = 'ACTIVE' AND c.deleted_at IS NULL AND t.deleted_at IS NULL
        ORDER BY t.academic_year DESC, t.semester DESC, c.id
        LIMIT 1
      `,
    );
    assert(classroom, 'Smoke DB has no ACTIVE classroom — seed the smoke database first');

    // Student login needs the enrollment to resolve as ACTIVE, which requires a
    // status that is active-for-login (see student_current_enrollment_resolution).
    const [loginStatus] = await dataSource.query(
      `
        SELECT code FROM student_status
        WHERE category = 'ACTIVE' AND is_active_for_login IS TRUE AND is_enabled IS TRUE
          AND deleted_at IS NULL
        ORDER BY code LIMIT 1
      `,
    );
    assert(loginStatus, 'Smoke DB has no login-capable student_status row');

    [{ person_uuid: personUuid }] = await dataSource.query(
      `INSERT INTO student_person (identity_status) VALUES ('ACTIVE') RETURNING person_uuid`,
    );

    [{ student_uuid: studentUuid }] = await dataSource.query(
      `
        INSERT INTO student_term (
          "PersonID_Onec", person_uuid, "AcademicYear_Onec", "Semester_Onec",
          "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
          student_status_code, "FirstName_Onec", "LastName_Onec"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ณัฐดนัย', 'พงศ์ไพบูลย์')
        RETURNING student_uuid
      `,
      [
        randomThaiNationalId(),
        personUuid,
        classroom.academic_year,
        classroom.semester,
        classroom.school_id,
        classroom.grade_level_id,
        classroom.legacy_room_number,
        loginStatus.code,
      ],
    );

    const admin = await upsertSmokeUser(dataSource, {
      username: adminUsername,
      passwordHash: await passwordService.hash(adminPassword),
      firstName: 'Contact',
      lastName: 'Smoke Admin',
      permissions: ['students', 'edit-students'],
      role: 'ADMIN',
      dataScope: { global: true },
    });
    assert(admin.id, 'Admin fixture missing id');

    const adminLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: adminUsername, password: adminPassword },
    });
    const adminCookie = cookieHeader(adminLogin.response);

    // 1. Fresh student has no account and no contact yet.
    const baseline = await request(baseUrl, 'GET', `/api/students/${studentUuid}`, 200, {
      headers: { cookie: adminCookie },
    });
    assert(baseline.payload.contact === null, 'Baseline detail should have no contact yet');
    assert(
      Array.isArray(baseline.payload.guardians) && baseline.payload.guardians.length === 0,
      'Baseline detail should have no guardians',
    );

    // 2. Staff saves the student's own channels + a father and a grandmother.
    const saved = await request(baseUrl, 'PATCH', `/api/students/${studentUuid}`, 200, {
      headers: { cookie: adminCookie },
      body: {
        contact: { phone: '0812345678', email: 'natdanai.p@example.ac.th', line_id: 'natdanai_p' },
        guardians: [
          {
            relation: 'FATHER',
            full_name: 'ประวิทย์ พงศ์ไพบูลย์',
            phone: '0898765432',
            is_primary: true,
          },
          {
            relation: 'GUARDIAN',
            relation_note: 'ยาย',
            full_name: 'บุญมี สายทอง',
            phone: '0861112222',
          },
        ],
      },
    });
    assert(saved.payload.contact?.phone === '0812345678', 'Saved contact phone missing');
    assert(saved.payload.guardians?.length === 2, 'Expected two guardians after save');
    assert(
      saved.payload.guardians[0].relation === 'FATHER' && saved.payload.guardians[0].is_primary,
      'Primary father should be listed first',
    );
    assert(
      saved.payload.guardians[1].relation_note === 'ยาย',
      'GUARDIAN row should keep its relation note',
    );

    const [personContactRow] = await dataSource.query(
      `SELECT phone, email, line_id FROM student_person_contact WHERE person_uuid = $1`,
      [personUuid],
    );
    assert(
      personContactRow.phone === '0812345678' && personContactRow.line_id === 'natdanai_p',
      'Student contact was not written to the canonical person row',
    );

    // 3. Replacing the list soft-deletes prior rows, keeps history.
    const replaced = await request(baseUrl, 'PATCH', `/api/students/${studentUuid}`, 200, {
      headers: { cookie: adminCookie },
      body: {
        guardians: [
          { relation: 'MOTHER', full_name: 'วรรณา พงศ์ไพบูลย์', phone: '0853334444', is_primary: true },
        ],
      },
    });
    assert(
      replaced.payload.guardians?.length === 1 &&
        replaced.payload.guardians[0].relation === 'MOTHER',
      'Guardian replacement did not apply',
    );
    assert(
      replaced.payload.FirstName_Onec === 'ณัฐดนัย',
      'Contact-only PATCH must not blank enrollment fields',
    );
    const [guardianCounts] = await dataSource.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE deleted_at IS NULL) AS live,
          COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted
        FROM student_guardian WHERE person_uuid = $1
      `,
      [personUuid],
    );
    assert(Number(guardianCounts.live) === 1, 'Expected exactly one live guardian row');
    assert(Number(guardianCounts.soft_deleted) === 2, 'Prior guardians should be soft-deleted');

    // 4. Validation: GUARDIAN needs relation_note; only one primary allowed.
    await request(baseUrl, 'PATCH', `/api/students/${studentUuid}`, 400, {
      headers: { cookie: adminCookie },
      body: { guardians: [{ relation: 'GUARDIAN', full_name: 'สมr ไม่ระบุ' }] },
    });
    await request(baseUrl, 'PATCH', `/api/students/${studentUuid}`, 400, {
      headers: { cookie: adminCookie },
      body: {
        guardians: [
          { relation: 'FATHER', full_name: 'ก หนึ่ง', is_primary: true },
          { relation: 'MOTHER', full_name: 'ข สอง', is_primary: true },
        ],
      },
    });

    // 5. Link an account after staff entered contact. Student self-service must
    // read and update the same canonical person row.
    await upsertSmokeUser(dataSource, {
      username: studentUsername,
      passwordHash: await passwordService.hash(studentPassword),
      firstName: 'ณัฐดนัย',
      lastName: 'พงศ์ไพบูลย์',
      permissions: ['student-self'],
      role: 'STUDENT',
      dataScope: { own_only: true },
      personUuid,
    });
    const studentLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: studentUsername, password: studentPassword },
    });
    const studentCookie = cookieHeader(studentLogin.response);

    await request(baseUrl, 'PATCH', `/api/students/${studentUuid}`, 403, {
      headers: { cookie: studentCookie },
      body: { FirstName_Onec: 'ชื่อปลอม' },
    });
    const selfProfile = await request(baseUrl, 'GET', '/api/users/me', 200, {
      headers: { cookie: studentCookie },
    });
    assert(
      selfProfile.payload.phone === '0812345678' && selfProfile.payload.line_id === 'natdanai_p',
      'Student profile did not read staff-entered canonical contact',
    );
    const selfSave = await request(baseUrl, 'PATCH', '/api/users/me', 200, {
      headers: { cookie: studentCookie },
      body: { phone: '0800000001', line_id: 'natdanai_self' },
    });
    assert(
      selfSave.payload.phone === '0800000001' && selfSave.payload.line_id === 'natdanai_self',
      'Student ProfilePage contact update did not apply',
    );
    const afterSelfSave = await request(baseUrl, 'GET', `/api/students/${studentUuid}`, 200, {
      headers: { cookie: adminCookie },
    });
    assert(
      afterSelfSave.payload.contact?.phone === '0800000001' &&
        afterSelfSave.payload.contact?.line_id === 'natdanai_self',
      'Student detail did not read the ProfilePage update from the canonical row',
    );

    console.log(
      JSON.stringify({
        status: 'student_contact_smoke_ok',
        checked: [
          'student without account starts with empty contact',
          'staff saves canonical contact without a student account',
          'father + guardian(note) saved, primary first',
          'replacement soft-deletes prior guardians',
          'GUARDIAN without note rejected',
          'duplicate primary rejected',
          'student blocked from enrollment fields',
          'student ProfilePage reads and updates the same canonical contact',
        ],
      }),
    );
  } finally {
    await dataSource.query(
      `UPDATE users SET status = 'DISABLED', person_uuid = NULL WHERE username = ANY($1::text[])`,
      [[adminUsername, studentUsername]],
    );
    if (personUuid) {
      await dataSource.query(`DELETE FROM student_term WHERE person_uuid = $1`, [personUuid]);
      // Cascades student_guardian and student_person_contact fixture rows.
      await dataSource.query(`DELETE FROM student_person WHERE person_uuid = $1`, [personUuid]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
