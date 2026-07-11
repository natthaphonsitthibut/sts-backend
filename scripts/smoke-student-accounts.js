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
  throw new Error('Refusing to run student accounts smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const ADMIN_USERNAME = 'student_accounts_smoke_admin';
const PERSON_UUID = '10000000-0000-4000-8000-000000000001';
const STUDENT_UUID = '10000000-0000-4000-8000-000000000002';
const STUDENT_PERSON_ID = 'SMOKE-STUDENT-ACCT-001';
const SCHOOL_ID = 10010002;
const GRADE_LEVEL_ID = 6;
const ROOM_ID = 1;

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
    `${method} ${path}: expected ${expectedStatus}, received ${response.status}`,
  );
  return { response, payload };
}

async function upsertAdmin(dataSource, passwordHash) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    ADMIN_USERNAME,
  ]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'Student',
            "LastName" = 'Accounts Admin',
            status = 'ACTIVE',
            permissions = $3::jsonb,
            role = 'ADMIN',
            data_scope = $4::jsonb,
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            affiliation = 'Automated student accounts smoke',
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
        WHERE id = $1
      `,
      [
        existing.id,
        passwordHash,
        JSON.stringify(['manage-student-accounts']),
        JSON.stringify({ global: true }),
      ],
    );
    return existing;
  }

  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code, email, phone
      )
      VALUES (
        $1, $2, 'Student', 'Accounts Admin', 'ACTIVE', $3::jsonb, 'ADMIN',
        $4::jsonb, FALSE, 'Automated student accounts smoke', 'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [
      ADMIN_USERNAME,
      passwordHash,
      JSON.stringify(['manage-student-accounts']),
      JSON.stringify({ global: true }),
    ],
  );
  return row;
}

async function upsertStudentFixture(dataSource) {
  const [school] = await dataSource.query(`SELECT id FROM schools WHERE id = $1`, [SCHOOL_ID]);
  assert(school, `Smoke school ${SCHOOL_ID} is missing`);

  await dataSource.query(
    `
      INSERT INTO student_person (person_uuid, identity_status)
      VALUES ($1::uuid, 'ACTIVE')
      ON CONFLICT (person_uuid) DO UPDATE
      SET identity_status = 'ACTIVE', merged_into = NULL, deleted_at = NULL, deleted_by = NULL
    `,
    [PERSON_UUID],
  );

  await dataSource.query(
    `
      INSERT INTO student_term (
        student_uuid, person_uuid, "PersonID_Onec", "FirstName_Onec", "LastName_Onec",
        "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec", "StudentStatusID_Onec",
        "AcademicYear_Onec", "Semester_Onec", "ProvinceNameThai_Onec",
        "DistrictNameThai_Onec", "SubDistrictNameThai_Onec", deleted_at, deleted_by
      )
      VALUES (
        $1::uuid, $2::uuid, $3, 'Smoke', 'Student Account', $4, $5, $6, 10,
        2569, 1, 'กรุงเทพมหานคร', 'ดอนเมือง', 'สีกัน', NULL, NULL
      )
      ON CONFLICT (student_uuid) DO UPDATE
      SET person_uuid = EXCLUDED.person_uuid,
          "PersonID_Onec" = EXCLUDED."PersonID_Onec",
          "FirstName_Onec" = EXCLUDED."FirstName_Onec",
          "LastName_Onec" = EXCLUDED."LastName_Onec",
          "SchoolID_Onec" = EXCLUDED."SchoolID_Onec",
          "GradeLevelID_Onec" = EXCLUDED."GradeLevelID_Onec",
          "RoomID_Onec" = EXCLUDED."RoomID_Onec",
          "StudentStatusID_Onec" = 10,
          "AcademicYear_Onec" = EXCLUDED."AcademicYear_Onec",
          "Semester_Onec" = EXCLUDED."Semester_Onec",
          deleted_at = NULL,
          deleted_by = NULL
    `,
    [STUDENT_UUID, PERSON_UUID, STUDENT_PERSON_ID, SCHOOL_ID, GRADE_LEVEL_ID, ROOM_ID],
  );
}

async function disableSmokeAccounts(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated student account smoke fixture')
      WHERE username = $1 OR (role = 'STUDENT' AND person_uuid = $2::uuid)
    `,
    [ADMIN_USERNAME, PERSON_UUID],
  );
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
  const adminPassword = `Admin-${suffix}-Password`;

  try {
    await upsertStudentFixture(dataSource);
    await disableSmokeAccounts(dataSource);
    const admin = await upsertAdmin(dataSource, await passwordService.hash(adminPassword));

    const adminLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: ADMIN_USERNAME, password: adminPassword },
    });
    const adminCookie = cookieHeader(adminLogin.response);
    assert(admin.id > 0, 'Admin fixture id is invalid');

    const filter = { schoolId: SCHOOL_ID, grade: 'ม.6', room: ROOM_ID, limit: 1 };
    const preview = await request(baseUrl, 'POST', '/api/users/student-accounts/preview', 201, {
      headers: { cookie: adminCookie },
      body: filter,
    });
    assert(
      preview.payload?.data?.summary?.withoutAccountCount >= 1,
      'Preview did not expose an account candidate',
    );
    assert(!JSON.stringify(preview.payload).includes(PERSON_UUID), 'Preview leaked person_uuid');
    assert(!JSON.stringify(preview.payload).includes(STUDENT_PERSON_ID), 'Preview leaked person id');

    const generated = await request(baseUrl, 'POST', '/api/users/student-accounts/generate', 201, {
      headers: { cookie: adminCookie },
      body: filter,
    });
    assert(generated.payload?.createdCount === 1, 'Generate did not create exactly one account');
    const credential = generated.payload.credentials?.[0];
    assert(credential?.userId > 0, 'Generated credential is missing userId');
    assert(credential?.username, 'Generated credential is missing username');
    assert(credential?.tempPassword, 'Generated credential is missing temp password');
    assert(!JSON.stringify(generated.payload).includes(PERSON_UUID), 'Generate leaked person_uuid');
    assert(!JSON.stringify(generated.payload).includes(STUDENT_PERSON_ID), 'Generate leaked person id');

    const list = await request(
      baseUrl,
      'GET',
      `/api/users/student-accounts?schoolId=${SCHOOL_ID}&grade=${encodeURIComponent('ม.6')}&room=${ROOM_ID}&searchTerm=${encodeURIComponent(
        credential.username,
      )}`,
      200,
      { headers: { cookie: adminCookie } },
    );
    assert(list.payload?.data?.some((row) => row.userId === credential.userId), 'List did not include generated account');

    const reissued = await request(
      baseUrl,
      'POST',
      `/api/users/student-accounts/${credential.userId}/reissue-temporary-password`,
      201,
      { headers: { cookie: adminCookie } },
    );
    assert(reissued.payload?.tempPassword, 'Reissue did not return a temporary password');

    await request(baseUrl, 'POST', '/api/users/login', 401, {
      body: { username: credential.username, password: credential.tempPassword },
    });
    const studentLoginAfterReissue = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: credential.username, password: reissued.payload.tempPassword },
    });
    assert(
      studentLoginAfterReissue.payload?.must_change_password === true,
      'Reissued student login did not require password change',
    );

    await request(
      baseUrl,
      'POST',
      `/api/users/student-accounts/${credential.userId}/deactivate`,
      201,
      {
        headers: { cookie: adminCookie },
        body: { reasonCode: 'OTHER', note: 'Automated student account smoke' },
      },
    );
    await request(baseUrl, 'POST', '/api/users/login', 401, {
      body: { username: credential.username, password: reissued.payload.tempPassword },
    });

    await request(
      baseUrl,
      'POST',
      `/api/users/student-accounts/${credential.userId}/reactivate`,
      201,
      { headers: { cookie: adminCookie } },
    );
    await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: credential.username, password: reissued.payload.tempPassword },
    });

    console.log(
      JSON.stringify({
        status: 'student_accounts_smoke_ok',
        checked: [
          'admin login',
          'preview candidate without identifier leak',
          'generate one student account',
          'list generated account',
          'reissue rotates temp password',
          'student temp login requires change',
          'deactivate blocks login',
          'reactivate restores login',
        ],
      }),
    );
  } finally {
    await disableSmokeAccounts(dataSource);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
