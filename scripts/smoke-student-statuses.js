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
  throw new Error('Refusing to run student-status smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const SETTINGS_USERNAME = 'student_status_smoke_settings';
const IMPORT_USERNAME = 'student_status_smoke_import';
const NO_PERMISSION_USERNAME = 'student_status_smoke_no_permission';

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

async function cleanup(dataSource) {
  await dataSource.query(
    `DELETE FROM student_status WHERE source_system = 'SMOKE' AND code >= 900000`,
  );
}

async function disableActors(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated student-status smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [[SETTINGS_USERNAME, IMPORT_USERNAME, NO_PERMISSION_USERNAME]],
  );
}

async function upsertActor(dataSource, passwordHash, username, permissions) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'Student Status',
            "LastName" = 'Smoke',
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
            affiliation = 'Automated student-status smoke',
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
        $1, $2, 'Student Status', 'Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'Automated student-status smoke',
        'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [username, passwordHash, JSON.stringify(permissions)],
  );
  return row;
}

function assertStudentStatus(row, expected) {
  assert(row?.code === expected.code, 'Student status code did not match');
  assert(row?.labelTh === expected.labelTh, 'Student status label did not match');
  assert(row?.category === expected.category, 'Student status category did not match');
  assert(row?.badgeVariant === expected.badgeVariant, 'Student status badge did not match');
  assert(row?.isActiveForLogin === expected.isActiveForLogin, 'Login policy did not match');
  assert(row?.isTerminal === expected.isTerminal, 'Terminal policy did not match');
  assert(row?.requiresFollowup === expected.requiresFollowup, 'Follow-up policy did not match');
  assert(row?.isEnabled === expected.isEnabled, 'Enabled flag did not match');
  assert(row?.sortOrder === expected.sortOrder, 'Sort order did not match');
  assert(row?.sourceSystem === expected.sourceSystem, 'Source system did not match');
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
  const password = `StudentStatus-${suffix}-Password`;
  const code = 900000 + (Date.now() % 90000);

  try {
    await cleanup(dataSource);
    await upsertActor(dataSource, await passwordService.hash(password), SETTINGS_USERNAME, [
      'settings',
    ]);
    await upsertActor(dataSource, await passwordService.hash(password), IMPORT_USERNAME, [
      'import-data',
    ]);
    await upsertActor(dataSource, await passwordService.hash(password), NO_PERMISSION_USERNAME, [
      'home',
    ]);

    const settingsLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: SETTINGS_USERNAME, password },
    });
    const settingsCookie = cookieHeader(settingsLogin.response);
    const importLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: IMPORT_USERNAME, password },
    });
    const importCookie = cookieHeader(importLogin.response);
    const noPermissionLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: NO_PERMISSION_USERNAME, password },
    });
    const noPermissionCookie = cookieHeader(noPermissionLogin.response);

    await request(baseUrl, 'GET', '/api/student-statuses?page=1&limit=10', 200, {
      headers: { cookie: settingsCookie },
    });
    await request(baseUrl, 'GET', '/api/student-statuses?page=1&limit=10', 200, {
      headers: { cookie: importCookie },
    });
    await request(baseUrl, 'GET', '/api/student-statuses?page=1&limit=10', 403, {
      headers: { cookie: noPermissionCookie },
    });

    const createPayload = {
      code,
      labelTh: 'สถานะนักเรียน smoke',
      category: 'ACTIVE',
      badgeVariant: 'success',
      isActiveForLogin: true,
      isTerminal: false,
      requiresFollowup: false,
      isEnabled: true,
      sortOrder: 32000,
      sourceSystem: 'SMOKE',
    };
    const created = await request(baseUrl, 'POST', '/api/student-statuses', 201, {
      headers: { cookie: settingsCookie },
      body: createPayload,
    });
    assertStudentStatus(created.payload?.data, createPayload);

    await request(baseUrl, 'POST', '/api/student-statuses', 403, {
      headers: { cookie: importCookie },
      body: { ...createPayload, code: code + 1 },
    });
    await request(baseUrl, 'POST', '/api/student-statuses', 409, {
      headers: { cookie: settingsCookie },
      body: createPayload,
    });

    const list = await request(
      baseUrl,
      'GET',
      `/api/student-statuses?page=1&limit=10&searchTerm=${encodeURIComponent(String(code))}`,
      200,
      { headers: { cookie: settingsCookie } },
    );
    assert(list.payload?.data?.some((item) => item.code === code), 'Created status was not searchable');

    const getByCode = await request(baseUrl, 'GET', `/api/student-statuses/${code}`, 200, {
      headers: { cookie: settingsCookie },
    });
    assertStudentStatus(getByCode.payload?.data, createPayload);

    const updatePayload = {
      labelTh: 'สถานะนักเรียน smoke updated',
      category: 'WITHDRAWN',
      badgeVariant: 'warning',
      isActiveForLogin: false,
      isTerminal: true,
      requiresFollowup: true,
      isEnabled: true,
      sortOrder: 32001,
      sourceSystem: 'SMOKE',
    };
    const updated = await request(baseUrl, 'PUT', `/api/student-statuses/${code}`, 200, {
      headers: { cookie: settingsCookie },
      body: updatePayload,
    });
    assertStudentStatus(updated.payload?.data, { ...createPayload, ...updatePayload });

    const disabled = await request(baseUrl, 'DELETE', `/api/student-statuses/${code}`, 200, {
      headers: { cookie: settingsCookie },
    });
    assert(disabled.payload?.data?.isEnabled === false, 'Disable did not clear isEnabled');

    const auditRows = await dataSource.query(
      `
        SELECT metadata
        FROM audit_log
        WHERE action = 'MASTER_DATA_EDIT'
          AND target_type = 'student_status'
          AND target_id = $1
        ORDER BY created_at DESC
        LIMIT 3
      `,
      [String(code)],
    );
    assert(auditRows.length >= 3, 'Student status create/update/disable audit rows were not written');
    for (const row of auditRows) {
      assert(Array.isArray(row.metadata?.changedFields), 'Student status audit row omitted changedFields');
      assert(
        !JSON.stringify(row.metadata).includes(createPayload.labelTh) &&
          !JSON.stringify(row.metadata).includes(updatePayload.labelTh),
        'Student status audit metadata stored field values instead of field names',
      );
    }

    console.log(
      JSON.stringify({
        status: 'student_statuses_smoke_ok',
        checked: [
          'settings user can list statuses',
          'import-data user can list statuses read-only',
          'no-permission user cannot list statuses',
          'settings user can create a status',
          'import-data user cannot create a status',
          'duplicate status code is rejected',
          'created status is searchable and readable',
          'settings user can update policy flags',
          'delete soft-disables the status',
          'MASTER_DATA_EDIT audit stores field names only',
        ],
      }),
    );
  } finally {
    try {
      await cleanup(dataSource);
    } finally {
      try {
        await disableActors(dataSource);
      } finally {
        await app.close();
      }
    }
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
