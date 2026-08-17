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
  throw new Error('Refusing to run account lifecycle smoke with NODE_ENV=production');
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
    `${method} ${path}: expected ${expectedStatus}, received ${response.status}`,
  );
  return { response, payload };
}

async function disableSmokeUsers(dataSource, usernames) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [usernames],
  );
}

async function upsertSmokeUser(
  dataSource,
  { username, passwordHash, firstName, lastName, permissions, role, dataScope },
) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
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
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            affiliation = 'Automated account lifecycle smoke',
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
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
      VALUES ($1, $2, $3, $4, 'ACTIVE', $5::jsonb, $6, $7::jsonb, FALSE, $8, 'AUTOMATED_TEST', NULL, NULL)
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
      'Automated account lifecycle smoke',
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
  const adminUsername = 'account_lifecycle_smoke_admin';
  const teacherUsername = 'account_lifecycle_smoke_teacher';
  const adminPassword = `Admin-${suffix}-Password`;
  const teacherPassword = `Teacher-${suffix}-Password`;

  try {
    const adminPasswordHash = await passwordService.hash(adminPassword);
    const teacherPasswordHash = await passwordService.hash(teacherPassword);

    const admin = await upsertSmokeUser(dataSource, {
      username: adminUsername,
      passwordHash: adminPasswordHash,
      firstName: 'Account',
      lastName: 'Lifecycle Admin',
      permissions: ['manage-users-list'],
      role: 'ADMIN',
      dataScope: { global: true },
    });

    const teacher = await upsertSmokeUser(dataSource, {
      username: teacherUsername,
      passwordHash: teacherPasswordHash,
      firstName: 'Account',
      lastName: 'Lifecycle Staff',
      permissions: ['home', 'attendance'],
      role: 'DIRECTOR',
      dataScope: { school_ids: [10010002] },
    });

    const teacherLoginBefore = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: teacherUsername, password: teacherPassword },
    });
    assert(
      teacherLoginBefore.payload?.username === teacherUsername,
      'Teacher baseline login returned the wrong user',
    );

    const adminLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: adminUsername, password: adminPassword },
    });
    const adminCookie = cookieHeader(adminLogin.response);
    assert(admin.id !== teacher.id, 'Admin and teacher fixtures unexpectedly share an id');

    const deactivate = await request(
      baseUrl,
      'POST',
      `/api/users/${teacher.id}/deactivate`,
      201,
      {
        headers: { cookie: adminCookie },
        body: { reasonCode: 'OTHER', note: 'Automated smoke test' },
      },
    );
    assert(deactivate.payload?.status === 'DISABLED', 'Deactivate did not return DISABLED status');

    await request(baseUrl, 'POST', '/api/users/login', 401, {
      body: { username: teacherUsername, password: teacherPassword },
    });

    const reactivate = await request(
      baseUrl,
      'POST',
      `/api/users/${teacher.id}/reactivate`,
      201,
      { headers: { cookie: adminCookie } },
    );
    assert(reactivate.payload?.status === 'ACTIVE', 'Reactivate did not return ACTIVE status');

    const teacherLoginAfter = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: teacherUsername, password: teacherPassword },
    });
    assert(
      teacherLoginAfter.payload?.username === teacherUsername,
      'Teacher login after reactivate returned the wrong user',
    );
    assert(
      !JSON.stringify(teacherLoginAfter.payload).includes(teacherPasswordHash),
      'Login response leaked password hash',
    );

    const [teacherRow] = await dataSource.query(
      `
        SELECT status, deactivated_at, deactivated_by, deactivation_reason_code, deactivation_note
        FROM users WHERE id = $1
      `,
      [teacher.id],
    );
    assert(teacherRow.status === 'ACTIVE', 'Teacher row did not end ACTIVE');
    assert(teacherRow.deactivated_at === null, 'Reactivate did not clear deactivated_at');
    assert(teacherRow.deactivated_by === null, 'Reactivate did not clear deactivated_by');
    assert(
      teacherRow.deactivation_reason_code === null && teacherRow.deactivation_note === null,
      'Reactivate did not clear deactivation reason metadata',
    );

    console.log(
      JSON.stringify({
        status: 'account_lifecycle_smoke_ok',
        checked: [
          'teacher baseline login',
          'admin cookie login',
          'deactivate teacher',
          'disabled teacher login rejected',
          'reactivate teacher',
          'teacher login restored',
          'password hash not leaked',
          'reactivation metadata cleared',
        ],
      }),
    );
  } finally {
    await disableSmokeUsers(dataSource, [adminUsername, teacherUsername]);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
