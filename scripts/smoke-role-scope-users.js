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
  throw new Error('Refusing to run role/scope smoke with NODE_ENV=production');
}

const GLOBAL_ADMIN_USERNAME = 'role_scope_smoke_global_admin';
const SCHOOL_ADMIN_USERNAME = 'role_scope_smoke_school_admin';
const TARGET_USERNAME_PREFIX = 'role_scope_smoke_teacher';
const SCHOOL_ID = 10010002;

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

function userPayload(targetUsername, targetPersonId, overrides = {}) {
  return {
    username: targetUsername,
    password: 'Target-Smoke-Password-123',
    FirstName: 'Role',
    LastName: 'Scope Smoke',
    PersonID_Onec: targetPersonId,
    phone: '0990000001',
    email: 'role.scope.smoke@example.invalid',
    affiliation: 'Automated role scope smoke',
    role: 'TEACHER',
    permissions: ['home', 'attendance'],
    data_scope: { school_ids: [String(SCHOOL_ID)] },
    ...overrides,
  };
}

async function upsertActor(dataSource, passwordHash, { username, dataScope }) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
  const permissions = ['manage-users-list', 'home', 'attendance'];
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'Role',
            "LastName" = 'Scope Admin',
            "PersonID_Onec" = NULL,
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
            affiliation = 'Automated role scope smoke',
            email = NULL,
            phone = NULL
        WHERE id = $1
      `,
      [existing.id, passwordHash, JSON.stringify(permissions), JSON.stringify(dataScope)],
    );
    return existing;
  }

  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, email, phone
      )
      VALUES (
        $1, $2, 'Role', 'Scope Admin', 'ACTIVE', $3::jsonb, 'ADMIN',
        $4::jsonb, FALSE, 'Automated role scope smoke', NULL, NULL
      )
      RETURNING id
    `,
    [username, passwordHash, JSON.stringify(permissions), JSON.stringify(dataScope)],
  );
  return row;
}

async function disableSmokeUsers(dataSource, targetUsername) {
  const usernames = [GLOBAL_ADMIN_USERNAME, SCHOOL_ADMIN_USERNAME];
  if (targetUsername) {
    usernames.push(targetUsername);
  }
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated role scope smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [usernames],
  );
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
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
  const globalAdminPassword = `Global-${suffix}-Password`;
  const schoolAdminPassword = `School-${suffix}-Password`;
  const targetUsername = `${TARGET_USERNAME_PREFIX}_${suffix}`;
  const targetPersonId = `99${String(Date.now()).slice(-11)}`;

  try {
    const [school] = await dataSource.query(`SELECT id FROM schools WHERE id = $1`, [SCHOOL_ID]);
    assert(school, `Smoke school ${SCHOOL_ID} is missing`);
    await disableSmokeUsers(dataSource);

    await upsertActor(dataSource, await passwordService.hash(globalAdminPassword), {
      username: GLOBAL_ADMIN_USERNAME,
      dataScope: { global: true },
    });
    await upsertActor(dataSource, await passwordService.hash(schoolAdminPassword), {
      username: SCHOOL_ADMIN_USERNAME,
      dataScope: { school_ids: [String(SCHOOL_ID)] },
    });

    const globalLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: GLOBAL_ADMIN_USERNAME, password: globalAdminPassword },
    });
    const globalCookie = cookieHeader(globalLogin.response);
    const schoolLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: SCHOOL_ADMIN_USERNAME, password: schoolAdminPassword },
    });
    const schoolCookie = cookieHeader(schoolLogin.response);

    const catalog = await request(baseUrl, 'GET', '/api/users/permissions', 200, {
      headers: { cookie: globalCookie },
    });
    assert(
      catalog.payload?.data?.some(
        (permission) =>
          permission.id === 'manage-users-list' && typeof permission.label === 'string',
      ),
      'Permission catalog did not include Thai-labelled manage-users-list',
    );

    await request(baseUrl, 'POST', '/api/users', 403, {
      headers: { cookie: schoolCookie },
      body: userPayload(`${targetUsername}_global`, `98${targetPersonId.slice(2)}`, {
        data_scope: { global: true },
      }),
    });
    await request(baseUrl, 'POST', '/api/users', 403, {
      headers: { cookie: schoolCookie },
      body: userPayload(`${targetUsername}_outside`, `97${targetPersonId.slice(2)}`, {
        data_scope: { school_ids: ['99999999'] },
      }),
    });

    const created = await request(baseUrl, 'POST', '/api/users', 201, {
      headers: { cookie: schoolCookie },
      body: userPayload(targetUsername, targetPersonId),
    });
    const targetUserId = created.payload?.userId;
    assert(Number.isInteger(targetUserId), 'Create user did not return a userId');

    await request(baseUrl, 'PUT', `/api/users/${targetUserId}`, 200, {
      headers: { cookie: schoolCookie },
      body: userPayload(targetUsername, targetPersonId, { FirstName: 'Role Updated' }),
    });
    await request(baseUrl, 'PUT', `/api/users/${targetUserId}`, 400, {
      headers: { cookie: schoolCookie },
      body: userPayload(targetUsername, targetPersonId, { status: 'DISABLED' }),
    });
    await request(baseUrl, 'PUT', `/api/users/${targetUserId}`, 403, {
      headers: { cookie: schoolCookie },
      body: userPayload(targetUsername, targetPersonId, { data_scope: { global: true } }),
    });

    const [target] = await dataSource.query(
      `SELECT role, data_scope, status FROM users WHERE id = $1`,
      [targetUserId],
    );
    assert(target.role === 'TEACHER', 'Target role drifted');
    assert(target.status === 'ACTIVE', 'Target status was changed through update path');
    assert(
      Array.isArray(target.data_scope?.school_ids) &&
        target.data_scope.school_ids.includes(String(SCHOOL_ID)),
      'Target scope was not kept school-bound',
    );

    console.log(
      JSON.stringify({
        status: 'role_scope_users_smoke_ok',
        checked: [
          'permission catalog labels',
          'school admin cannot create global scope',
          'school admin cannot create outside school scope',
          'school admin can create in-scope teacher',
          'school admin can update in-scope teacher',
          'generic update cannot change lifecycle status',
          'school admin cannot widen target scope',
        ],
      }),
    );
  } finally {
    await disableSmokeUsers(dataSource, targetUsername);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
