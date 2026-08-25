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
  throw new Error('Refusing to run teachers smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const USERNAME = 'teachers_api_smoke';
const NO_PERMISSION_USERNAME = 'teachers_api_smoke_no_permission';

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
    `${method} ${path}: expected ${expectedStatus}, received ${response.status}; payload=${JSON.stringify(payload)}`,
  );
  return { response, payload };
}

async function upsertActor(dataSource, passwordHash, { username, permissions }) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'Teachers',
            "LastName" = 'API Smoke',
            status = 'ACTIVE',
            permissions = $3::jsonb,
            role = 'ADMIN',
            data_scope = '{"global":true}'::jsonb,
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            affiliation = 'Automated teachers smoke',
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
        WHERE id = $1
      `,
      [existing.id, passwordHash, JSON.stringify(permissions)],
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
        $1, $2, 'Teachers', 'API Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'Automated teachers smoke',
        'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [username, passwordHash, JSON.stringify(permissions)],
  );
  return row;
}

/** Teachers created by earlier runs, matched by the marker this smoke writes. */
async function cleanupFixtures(dataSource, emailPattern) {
  await dataSource.query(
    `
      DELETE FROM school_teacher_memberships
      WHERE teacher_id IN (SELECT id FROM teachers WHERE email LIKE $1)
    `,
    [emailPattern],
  );
  await dataSource.query(`DELETE FROM teachers WHERE email LIKE $1`, [emailPattern]);
}

async function disableActors(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [[USERNAME, NO_PERMISSION_USERNAME]],
  );
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
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
  const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const password = `Teachers-${suffix}-Password`;
  const email = `teachers.smoke.${suffix}@smoke.invalid`;
  // The unique identity of a teacher. Kept inside a reserved test range so it
  // can never collide with a real citizen id.
  const citizenId = `99${String(Date.now()).slice(-11)}`;
  const duplicateCitizenId = `98${String(Date.now()).slice(-11)}`;
  const checked = [];

  try {
    await cleanupFixtures(dataSource, 'teachers.smoke.%@smoke.invalid');
    await upsertActor(dataSource, await passwordService.hash(password), {
      username: USERNAME,
      permissions: ['teachers'],
    });
    await upsertActor(dataSource, await passwordService.hash(password), {
      username: NO_PERMISSION_USERNAME,
      permissions: ['home'],
    });

    const [school] = await dataSource.query(`SELECT id FROM schools ORDER BY id LIMIT 1`);
    assert(school, 'No school available to attach the smoke teacher to');

    const login = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: USERNAME, password },
    });
    const cookie = cookieHeader(login.response);

    // The regression this smoke exists for: creating a teacher writes both the
    // person and their school membership, and the membership names the teacher
    // row directly — there is no login account anywhere in the path.
    const created = await request(baseUrl, 'POST', '/api/teachers', 201, {
      headers: { cookie },
      body: {
        schoolId: Number(school.id),
        firstName: 'สมสมร',
        lastName: 'ทดสอบระบบ',
        citizenId,
        email,
        phone: '0812345678',
      },
    });
    const teacherId = created.payload?.data?.id;
    assert(teacherId, `Create teacher returned no id; payload=${JSON.stringify(created.payload)}`);
    checked.push('creating a teacher without a login account succeeds');

    const [membership] = await dataSource.query(
      `
        SELECT teacher_id, membership_status
        FROM school_teacher_memberships
        WHERE teacher_id = $1
      `,
      [teacherId],
    );
    assert(membership, 'Creating a teacher did not write a school membership');
    assert(
      String(membership.teacher_id) === String(teacherId) &&
        membership.membership_status === 'ACTIVE',
      `Membership shape unexpected: ${JSON.stringify(membership)}`,
    );
    checked.push('the membership is active and points at the teacher row');

    const listed = await request(
      baseUrl,
      'GET',
      `/api/teachers?schoolId=${Number(school.id)}&page=1&limit=50&searchTerm=${encodeURIComponent('ทดสอบระบบ')}`,
      200,
      { headers: { cookie } },
    );
    const rows = listed.payload?.data ?? [];
    assert(
      rows.some((row) => String(row.id) === String(teacherId)),
      'The created teacher did not come back from the roster',
    );
    checked.push('the new teacher appears in the roster');

    // A second teacher on the same email must be refused rather than silently
    // attached to someone else's record.
    await request(baseUrl, 'POST', '/api/teachers', 409, {
      headers: { cookie },
      body: {
        schoolId: Number(school.id),
        firstName: 'ซ้ำ',
        lastName: 'อีเมลเดิม',
        citizenId: duplicateCitizenId,
        email,
      },
    });
    checked.push('a duplicate email is refused');

    const noPermissionLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: NO_PERMISSION_USERNAME, password },
    });
    await request(baseUrl, 'POST', '/api/teachers', 403, {
      headers: { cookie: cookieHeader(noPermissionLogin.response) },
      body: {
        schoolId: Number(school.id),
        firstName: 'ไม่มีสิทธิ์',
        lastName: 'ทดสอบระบบ',
        citizenId: duplicateCitizenId,
      },
    });
    checked.push('an account without teachers is refused');

    console.log(JSON.stringify({ status: 'teachers_api_smoke_ok', checked }));
  } finally {
    await cleanupFixtures(dataSource, 'teachers.smoke.%@smoke.invalid');
    await disableActors(dataSource);
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
