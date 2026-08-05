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
  throw new Error('Refusing to run profile self-edit smoke with NODE_ENV=production');
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

async function disableSmokeUser(dataSource, username) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated profile smoke fixture')
      WHERE username = $1
    `,
    [username],
  );
}

async function upsertSmokeUser(dataSource, passwordHash, username) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'Profile',
            "LastName" = 'Smoke',
            status = 'ACTIVE',
            permissions = '["home","audit-log"]'::jsonb,
            role = 'ADMIN',
            data_scope = '{"global":true}'::jsonb,
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            affiliation = 'Automated profile self-edit smoke',
            data_origin_code = 'AUTOMATED_TEST',
            email = 'profile.self.edit.smoke@example.invalid',
            phone = '0891234567'
        WHERE id = $1
      `,
      [existing.id, passwordHash],
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
        $1, $2, 'Profile', 'Smoke', 'ACTIVE', '["home","audit-log"]'::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'Automated profile self-edit smoke',
        'AUTOMATED_TEST', 'profile.self.edit.smoke@example.invalid', '0891234567'
      )
      RETURNING id
    `,
    [username, passwordHash],
  );
  return row;
}

function assertProfilePersisted(profile, payload) {
  assert(profile.FirstName === payload.FirstName, 'FirstName did not persist');
  assert(profile.LastName === payload.LastName, 'LastName did not persist');
  assert(profile.phone === payload.phone, 'Phone did not persist');
  assert(profile.email === payload.email, 'Email did not persist');
  assert(profile.affiliation === payload.affiliation, 'Affiliation did not persist');
  assert(profile.line_id === payload.line_id, 'LINE ID did not persist');
  assert(profile.address_line === payload.address_line, 'Address line did not persist');
  assert(profile.address_village_no === payload.address_village_no, 'Village no did not persist');
  assert(profile.address_street === payload.address_street, 'Street did not persist');
  assert(profile.address_soi === payload.address_soi, 'Soi did not persist');
  assert(profile.address_trok === payload.address_trok, 'Trok did not persist');
  assert(profile.address_sub_district === payload.address_sub_district, 'Sub-district did not persist');
  assert(profile.address_district === payload.address_district, 'District did not persist');
  assert(profile.address_province === payload.address_province, 'Province did not persist');
  assert(profile.address_postal_code === payload.address_postal_code, 'Postal code did not persist');
  assert(Number(profile.address_latitude) === payload.address_latitude, 'Latitude did not persist');
  assert(Number(profile.address_longitude) === payload.address_longitude, 'Longitude did not persist');
}

function assertAuditDoesNotLeakProfileValues(metadata, payload) {
  const metadataText = JSON.stringify(metadata || {});
  for (const value of [
    payload.address_line,
    payload.address_village_no,
    payload.address_street,
    payload.address_soi,
    payload.address_trok,
    payload.address_sub_district,
    payload.address_district,
    payload.address_province,
    payload.address_postal_code,
    String(payload.address_latitude),
    String(payload.address_longitude),
  ]) {
    assert(!metadataText.includes(value), 'Profile audit metadata leaked address or coordinate value');
  }
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
  const username = 'profile_self_edit_smoke';
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const password = `Profile-${suffix}-Password`;

  try {
    const user = await upsertSmokeUser(dataSource, await passwordService.hash(password), username);
    const auditStart = new Date();

    const login = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username, password },
    });
    const cookie = cookieHeader(login.response);
    assert(login.payload?.username === username, 'Login returned the wrong profile fixture');

    const before = await request(baseUrl, 'GET', '/api/users/me', 200, {
      headers: { cookie },
    });
    assert(before.payload?.username === username, 'GET /users/me returned the wrong user');

    const payload = {
      FirstName: 'ProfileSmoke',
      LastName: 'Verified',
      phone: '0897654321',
      email: 'profile.self.edit.smoke@example.invalid',
      affiliation: 'Automated profile self-edit smoke updated',
      line_id: 'profile-smoke-line',
      address_line: '99/7 อาคารทดสอบ',
      address_village_no: '5',
      address_street: 'ถนนทดสอบ',
      address_soi: 'ซอยทดสอบ',
      address_trok: 'ตรอกทดสอบ',
      address_sub_district: 'คลองถนน',
      address_district: 'สายไหม',
      address_province: 'กรุงเทพมหานคร',
      address_postal_code: '10220',
      address_latitude: 13.912345,
      address_longitude: 100.612345,
    };
    const expectedProfile = {
      ...payload,
      address_street: 'ทดสอบ',
      address_soi: 'ทดสอบ',
      address_trok: 'ทดสอบ',
    };

    const update = await request(baseUrl, 'PATCH', '/api/users/me', 200, {
      headers: { cookie },
      body: payload,
    });
    assertProfilePersisted(update.payload, expectedProfile);

    const after = await request(baseUrl, 'GET', '/api/users/me', 200, {
      headers: { cookie },
    });
    assertProfilePersisted(after.payload, expectedProfile);

    const [audit] = await dataSource.query(
      `
        SELECT metadata
        FROM audit_log
        WHERE action = 'USER_PROFILE_UPDATE'
          AND target_id = $1
          AND created_at >= $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [String(user.id), auditStart],
    );
    assert(audit, 'USER_PROFILE_UPDATE audit row was not written');
    assert(Array.isArray(audit.metadata?.fields), 'Profile audit metadata did not include fields');
    assert(audit.metadata.fieldCount === Object.keys(payload).length, 'Profile audit field count is incorrect');
    assertAuditDoesNotLeakProfileValues(audit.metadata, payload);

    console.log(
      JSON.stringify({
        status: 'profile_self_edit_smoke_ok',
        checked: [
          'httpOnly login cookie',
          'GET /users/me loads current user',
          'PATCH /users/me persists contact fields',
          'PATCH /users/me persists address fields',
          'PATCH /users/me persists map coordinates',
          'refresh GET /users/me keeps saved profile data',
          'USER_PROFILE_UPDATE audit row written',
          'profile audit metadata does not leak address or coordinate values',
        ],
      }),
    );
  } finally {
    await disableSmokeUser(dataSource, username);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
