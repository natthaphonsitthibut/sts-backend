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
  throw new Error('Refusing to run master-data lookup smoke with NODE_ENV=production');
}

const SETTINGS_USERNAME = 'master_data_lookup_smoke_settings';
const NO_SETTINGS_USERNAME = 'master_data_lookup_smoke_no_settings';

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
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'Master Data',
            "LastName" = 'Lookup Smoke',
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
            affiliation = 'Automated master-data lookup smoke',
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
        $1, $2, 'Master Data', 'Lookup Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'Automated master-data lookup smoke',
        'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [username, passwordHash, JSON.stringify(permissions)],
  );
  return row;
}

async function cleanup(dataSource, codePrefix) {
  await dataSource.query(`DELETE FROM absence_reasons WHERE code LIKE $1`, [`${codePrefix}%`]);
  await dataSource.query(`DELETE FROM absence_reason_categories WHERE code LIKE $1`, [
    `${codePrefix}%`,
  ]);
  await dataSource.query(`DELETE FROM school_affiliations WHERE code LIKE $1`, [`${codePrefix}%`]);
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
    [[SETTINGS_USERNAME, NO_SETTINGS_USERNAME]],
  );
  const [activeActors] = await dataSource.query(
    `SELECT COUNT(*)::int AS count FROM users WHERE username = ANY($1::text[]) AND status = 'ACTIVE'`,
    [[SETTINGS_USERNAME, NO_SETTINGS_USERNAME]],
  );
  assert(activeActors.count === 0, 'Smoke actors were not disabled during cleanup');
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
  const password = `MasterData-${suffix}-Password`;
  const codePrefix = `SMOKE_${suffix.toUpperCase()}`;

  try {
    await cleanup(dataSource, 'SMOKE_');
    await upsertActor(dataSource, await passwordService.hash(password), {
      username: SETTINGS_USERNAME,
      permissions: ['settings'],
    });
    await upsertActor(dataSource, await passwordService.hash(password), {
      username: NO_SETTINGS_USERNAME,
      permissions: ['home'],
    });

    const settingsLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: SETTINGS_USERNAME, password },
    });
    const settingsCookie = cookieHeader(settingsLogin.response);
    const noSettingsLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: NO_SETTINGS_USERNAME, password },
    });
    const noSettingsCookie = cookieHeader(noSettingsLogin.response);

    await request(baseUrl, 'GET', '/api/master-data/school_affiliations?page=1&limit=10', 200, {
      headers: { cookie: settingsCookie },
    });
    await request(baseUrl, 'GET', '/api/master-data/school_affiliations?page=1&limit=10', 403, {
      headers: { cookie: noSettingsCookie },
    });

    const category = await request(
      baseUrl,
      'POST',
      '/api/master-data/absence_reason_categories',
      201,
      {
        headers: { cookie: settingsCookie },
        body: {
          code: `${codePrefix}_CAT`,
          name: 'Smoke absence category',
          note: 'Created by automated smoke',
          is_active: true,
        },
      },
    );
    assert(category.payload?.id, 'Category create did not return an id');

    const missingCategory = await request(
      baseUrl,
      'POST',
      '/api/master-data/absence_reasons',
      400,
      {
        headers: { cookie: settingsCookie },
        body: { code: `${codePrefix}_NO_CAT`, name: 'Missing category' },
      },
    );
    assert(missingCategory.payload, 'Missing category validation did not return a response');

    const reason = await request(baseUrl, 'POST', '/api/master-data/absence_reasons', 201, {
      headers: { cookie: settingsCookie },
      body: {
        code: `${codePrefix}_REASON`,
        name: 'Smoke absence reason',
        category_id: Number(category.payload.id),
        note: 'Created by automated smoke',
        is_active: true,
      },
    });
    assert(reason.payload?.category_id, 'Reason create did not keep category_id');

    const updated = await request(
      baseUrl,
      'PUT',
      `/api/master-data/absence_reasons/${reason.payload.id}`,
      200,
      {
        headers: { cookie: settingsCookie },
        body: {
          code: `${codePrefix}_REASON`,
          name: 'Smoke absence reason updated',
          category_id: Number(category.payload.id),
          note: '',
          is_active: false,
        },
      },
    );
    assert(updated.payload?.is_active === false, 'Reason update did not persist is_active=false');

    const search = await request(
      baseUrl,
      'GET',
      `/api/master-data/absence_reasons?page=1&limit=10&searchTerm=${encodeURIComponent(codePrefix)}`,
      200,
      { headers: { cookie: settingsCookie } },
    );
    assert(search.payload?.totalCount >= 1, 'Search did not return the created reason');

    console.log('master-data lookup smoke passed');
  } finally {
    try {
      await cleanup(dataSource, 'SMOKE_');
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
  console.error(error);
  process.exit(1);
});
