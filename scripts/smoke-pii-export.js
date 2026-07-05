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
  throw new Error('Refusing to run PII export smoke with NODE_ENV=production');
}

const REQUESTER_USERNAME = 'pii_export_smoke_requester';
const APPROVER_USERNAME = 'pii_export_smoke_approver';
const PERSON_UUID = '20000000-0000-4000-8000-000000000001';
const STUDENT_UUID = '20000000-0000-4000-8000-000000000002';
const STUDENT_PERSON_ID = '1234567890123';
const SCHOOL_ID = 10010002;
const GRADE_LEVEL_ID = 6;
const ROOM_ID = 1;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorMessage(error) {
  if (error instanceof AggregateError) {
    const messages = error.errors.map((cause) => cause?.message || String(cause));
    return `AggregateError: ${messages.join(' | ')}`;
  }
  return error?.message || String(error);
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

async function requestText(baseUrl, method, path, expectedStatus, options = {}) {
  const headers = { ...(options.headers || {}) };
  const response = await fetch(`${baseUrl}${path}`, { method, headers });
  const text = await response.text();
  assert(
    response.status === expectedStatus,
    `${method} ${path}: expected ${expectedStatus}, received ${response.status}`,
  );
  return { response, text };
}

async function upsertUser(dataSource, passwordHash, username, firstName, dataScope) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = $3,
            "LastName" = 'PII Export Smoke',
            status = 'ACTIVE',
            permissions = $4::jsonb,
            role = 'ADMIN',
            data_scope = $5::jsonb,
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            affiliation = 'Automated PII export smoke',
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
        WHERE id = $1
      `,
      [existing.id, passwordHash, firstName, JSON.stringify(['students']), JSON.stringify(dataScope)],
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
        $1, $2, $3, 'PII Export Smoke', 'ACTIVE', $4::jsonb, 'ADMIN',
        $5::jsonb, FALSE, 'Automated PII export smoke', 'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [username, passwordHash, firstName, JSON.stringify(['students']), JSON.stringify(dataScope)],
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
        student_uuid, person_uuid, "PersonID_Onec", "PassportNumber_Onec",
        "FirstName_Onec", "LastName_Onec", "SchoolID_Onec", "GradeLevelID_Onec",
        "RoomID_Onec", "StudentStatusID_Onec", "AcademicYear_Onec", "Semester_Onec",
        "ProvinceNameThai_Onec", "DistrictNameThai_Onec", "SubDistrictNameThai_Onec",
        "PostalCode_Onec", deleted_at, deleted_by
      )
      VALUES (
        $1::uuid, $2::uuid, $3, 'AA123456', 'Smoke', 'PII Export', $4, $5,
        $6, 10, 2569, 1, 'กรุงเทพมหานคร', 'ดอนเมือง', 'สีกัน', '10210', NULL, NULL
      )
      ON CONFLICT (student_uuid) DO UPDATE
      SET person_uuid = EXCLUDED.person_uuid,
          "PersonID_Onec" = EXCLUDED."PersonID_Onec",
          "PassportNumber_Onec" = EXCLUDED."PassportNumber_Onec",
          "FirstName_Onec" = EXCLUDED."FirstName_Onec",
          "LastName_Onec" = EXCLUDED."LastName_Onec",
          "SchoolID_Onec" = EXCLUDED."SchoolID_Onec",
          "GradeLevelID_Onec" = EXCLUDED."GradeLevelID_Onec",
          "RoomID_Onec" = EXCLUDED."RoomID_Onec",
          "StudentStatusID_Onec" = 10,
          "AcademicYear_Onec" = EXCLUDED."AcademicYear_Onec",
          "Semester_Onec" = EXCLUDED."Semester_Onec",
          "ProvinceNameThai_Onec" = EXCLUDED."ProvinceNameThai_Onec",
          "DistrictNameThai_Onec" = EXCLUDED."DistrictNameThai_Onec",
          "SubDistrictNameThai_Onec" = EXCLUDED."SubDistrictNameThai_Onec",
          "PostalCode_Onec" = EXCLUDED."PostalCode_Onec",
          deleted_at = NULL,
          deleted_by = NULL
    `,
    [STUDENT_UUID, PERSON_UUID, STUDENT_PERSON_ID, SCHOOL_ID, GRADE_LEVEL_ID, ROOM_ID],
  );

  const [current] = await dataSource.query(
    `
      SELECT resolution_state, selected_student_uuid
      FROM student_current_enrollment_resolution
      WHERE person_uuid = $1::uuid
    `,
    [PERSON_UUID],
  );
  assert(current?.resolution_state === 'ACTIVE', 'Smoke student must resolve as active');
  assert(current?.selected_student_uuid === STUDENT_UUID, 'Smoke student selection mismatch');
}

async function disableSmokeAccounts(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated PII export smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [[REQUESTER_USERNAME, APPROVER_USERNAME]],
  );
}

async function cancelSmokeRequests(dataSource, requestIds) {
  if (requestIds.length === 0) {
    return;
  }
  await dataSource.query(
    `
      UPDATE pii_export_requests
      SET status = 'CANCELLED',
          download_token_hash = NULL,
          download_expires_at = NULL,
          updated_at = NOW()
      WHERE id = ANY($1::uuid[])
    `,
    [requestIds],
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
  const requesterPassword = `Requester-${suffix}-Password`;
  const approverPassword = `Approver-${suffix}-Password`;
  const requestIds = [];

  try {
    await upsertStudentFixture(dataSource);
    await disableSmokeAccounts(dataSource);
    await upsertUser(
      dataSource,
      await passwordService.hash(requesterPassword),
      REQUESTER_USERNAME,
      'Requester',
      { school_ids: [SCHOOL_ID] },
    );
    await upsertUser(
      dataSource,
      await passwordService.hash(approverPassword),
      APPROVER_USERNAME,
      'Approver',
      { global: true },
    );

    const requesterLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: REQUESTER_USERNAME, password: requesterPassword },
    });
    const requesterCookie = cookieHeader(requesterLogin.response);
    const approverLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: APPROVER_USERNAME, password: approverPassword },
    });
    const approverCookie = cookieHeader(approverLogin.response);

    const createBody = {
      scope: { school_ids: [SCHOOL_ID] },
      include_full_national_id: false,
      reason_code: 'VERIFY_DATA',
      reason_note: 'ตรวจสอบข้อมูลตามคำขอ smoke',
    };
    const created = await request(baseUrl, 'POST', '/api/students/pii-export-requests', 201, {
      headers: { cookie: requesterCookie },
      body: createBody,
    });
    const requestId = created.payload?.data?.id;
    requestIds.push(requestId);
    assert(requestId, 'Create request did not return id');
    assert(created.payload?.data?.row_estimate >= 1, 'Export row estimate must include fixture student');

    const approved = await request(
      baseUrl,
      'POST',
      `/api/students/pii-export-requests/${requestId}/approve`,
      201,
      { headers: { cookie: approverCookie } },
    );
    const token = approved.payload?.data?.download_token;
    assert(typeof token === 'string' && token.length > 0, 'Approve did not return one-time token');

    const downloaded = await requestText(
      baseUrl,
      'GET',
      `/api/students/pii-export-download?token=${encodeURIComponent(token)}`,
      200,
    );
    assert(
      downloaded.response.headers.get('content-disposition')?.includes(`pii-export-${requestId.slice(0, 8)}.csv`),
      'Download filename is missing export id',
    );
    assert(downloaded.text.includes('export_id'), 'CSV watermark missing export id label');
    assert(downloaded.text.includes(requestId), 'CSV watermark missing export id value');
    assert(downloaded.text.includes('VERIFY_DATA'), 'CSV watermark missing purpose');
    assert(downloaded.text.includes('••••0123'), 'CSV must contain masked national id');
    assert(!downloaded.text.includes(STUDENT_PERSON_ID), 'CSV leaked full national id');

    await requestText(
      baseUrl,
      'GET',
      `/api/students/pii-export-download?token=${encodeURIComponent(token)}`,
      410,
    );

    const selfCreated = await request(baseUrl, 'POST', '/api/students/pii-export-requests', 201, {
      headers: { cookie: requesterCookie },
      body: createBody,
    });
    const selfRequestId = selfCreated.payload?.data?.id;
    requestIds.push(selfRequestId);
    await request(
      baseUrl,
      'POST',
      `/api/students/pii-export-requests/${selfRequestId}/approve`,
      403,
      { headers: { cookie: requesterCookie } },
    );

    await request(baseUrl, 'POST', '/api/students/pii-export-requests', 403, {
      headers: { cookie: requesterCookie },
      body: { ...createBody, scope: { global: true } },
    });

    console.log(`PII export smoke passed (request=${requestId})`);
  } finally {
    await cancelSmokeRequests(dataSource, requestIds.filter(Boolean));
    await disableSmokeAccounts(dataSource);
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
