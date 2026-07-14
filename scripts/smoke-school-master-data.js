const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run school master-data smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const USERNAMES = {
  global: 'school_master_smoke_global',
  scoped: 'school_master_smoke_scoped',
  noScope: 'school_master_smoke_no_scope',
  executive: 'school_master_smoke_executive',
  importer: 'school_master_smoke_importer',
};
const SCHOOL_NAME_PREFIX = 'AUTOMATED SCHOOL MASTER SMOKE';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function parseJsonResponse(response) {
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
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

async function upsertActor(dataSource, passwordHash, { username, role, permissions, dataScope }) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [username]);
  const values = [
    passwordHash,
    JSON.stringify(permissions),
    role,
    JSON.stringify(dataScope),
    username,
  ];
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $1,
            "FirstName" = 'School',
            "LastName" = 'Master Smoke',
            status = 'ACTIVE',
            permissions = $2::jsonb,
            role = $3,
            data_scope = $4::jsonb,
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            affiliation = 'Automated school master-data smoke',
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
        WHERE username = $5
      `,
      values,
    );
    return existing;
  }
  const [created] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code, email, phone
      )
      VALUES (
        $5, $1, 'School', 'Master Smoke', 'ACTIVE', $2::jsonb, $3,
        $4::jsonb, FALSE, 'Automated school master-data smoke',
        'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    values,
  );
  return created;
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

async function cleanup(dataSource) {
  await dataSource.query(`DELETE FROM schools WHERE name LIKE $1`, [`${SCHOOL_NAME_PREFIX}%`]);
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [Object.values(USERNAMES)],
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
  const sessionCookieService = app.get(SessionCookieService);
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const password = `School-Master-${Date.now()}-Password`;
  let originalSchoolName;
  let schoolA;
  const createdSchoolId = 1900000000 + (Date.now() % 90_000_000);

  try {
    await cleanup(dataSource);
    const schools = await dataSource.query(
      `SELECT id, name FROM schools WHERE school_status = 'ACTIVE' ORDER BY id LIMIT 2`,
    );
    assert(schools.length === 2, 'School master-data smoke requires two active schools');
    [schoolA] = schools;
    const schoolB = schools[1];
    originalSchoolName = schoolA.name;
    const hash = await passwordService.hash(password);
    const globalActor = await upsertActor(dataSource, hash, {
      username: USERNAMES.global,
      role: 'ADMIN',
      permissions: ['manage-schools'],
      dataScope: { global: true },
    });
    const scopedActor = await upsertActor(dataSource, hash, {
      username: USERNAMES.scoped,
      role: 'DIRECTOR',
      permissions: ['manage-schools'],
      dataScope: { school_ids: [schoolA.id] },
    });
    const noScopeActor = await upsertActor(dataSource, hash, {
      username: USERNAMES.noScope,
      role: 'ADMIN',
      permissions: ['manage-schools'],
      dataScope: {},
    });
    const executiveActor = await upsertActor(dataSource, hash, {
      username: USERNAMES.executive,
      role: 'EXECUTIVE',
      permissions: ['home'],
      dataScope: { global: true },
    });
    const importerActor = await upsertActor(dataSource, hash, {
      username: USERNAMES.importer,
      role: 'ADMIN',
      permissions: ['import-data'],
      dataScope: { global: true },
    });

    const globalCookie = sessionCookieHeader(sessionCookieService, globalActor.id);
    const scopedCookie = sessionCookieHeader(sessionCookieService, scopedActor.id);
    const noScopeCookie = sessionCookieHeader(sessionCookieService, noScopeActor.id);
    const executiveCookie = sessionCookieHeader(sessionCookieService, executiveActor.id);
    const importerCookie = sessionCookieHeader(sessionCookieService, importerActor.id);

    const scopedList = await request(
      baseUrl,
      'GET',
      '/api/master-data/schools?page=1&limit=20',
      200,
      { headers: { cookie: scopedCookie } },
    );
    assert(scopedList.payload.totalCount === 1, 'Scoped list returned schools outside school A');
    assert(scopedList.payload.rows[0]?.id === schoolA.id, 'Scoped list did not return school A');
    await request(baseUrl, 'GET', `/api/master-data/schools/${schoolA.id}`, 200, {
      headers: { cookie: scopedCookie },
    });
    await request(baseUrl, 'GET', `/api/master-data/schools/${schoolB.id}`, 404, {
      headers: { cookie: scopedCookie },
    });
    await request(baseUrl, 'POST', '/api/master-data/schools', 403, {
      headers: { cookie: scopedCookie },
      body: { id: createdSchoolId, name: `${SCHOOL_NAME_PREFIX} SCOPED CREATE` },
    });
    await request(baseUrl, 'PUT', `/api/master-data/schools/${schoolB.id}`, 404, {
      headers: { cookie: scopedCookie },
      body: { name: schoolB.name },
    });
    await request(baseUrl, 'DELETE', `/api/master-data/schools/${schoolA.id}`, 403, {
      headers: { cookie: scopedCookie },
    });
    await request(baseUrl, 'GET', '/api/master-data/schools?page=1&limit=20', 403, {
      headers: { cookie: noScopeCookie },
    });
    await request(baseUrl, 'PUT', `/api/master-data/schools/${schoolA.id}`, 403, {
      headers: { cookie: executiveCookie },
      body: { name: schoolA.name },
    });

    const temporaryName = `${originalSchoolName} (scope smoke)`;
    await request(baseUrl, 'PUT', `/api/master-data/schools/${schoolA.id}`, 200, {
      headers: { cookie: scopedCookie },
      body: { name: temporaryName },
    });
    await request(baseUrl, 'PUT', `/api/master-data/schools/${schoolA.id}`, 200, {
      headers: { cookie: scopedCookie },
      body: { name: originalSchoolName },
    });

    const created = await request(baseUrl, 'POST', '/api/master-data/schools', 201, {
      headers: { cookie: globalCookie },
      body: {
        id: createdSchoolId,
        name: `${SCHOOL_NAME_PREFIX} ${Date.now()}`,
        province: 'เชียงใหม่',
        district: 'เมืองเชียงใหม่',
        subDistrict: 'สุเทพ',
      },
    });
    assert(created.payload.id === createdSchoolId, 'Global create did not keep the school id');
    const disabled = await request(
      baseUrl,
      'DELETE',
      `/api/master-data/schools/${createdSchoolId}`,
      200,
      { headers: { cookie: globalCookie } },
    );
    assert(
      disabled.payload.schoolStatus === 'INACTIVE',
      `Delete route did not disable school: ${JSON.stringify(disabled.payload)}`,
    );
    const [persisted] = await dataSource.query(
      `SELECT school_status FROM schools WHERE id = $1`,
      [createdSchoolId],
    );
    assert(persisted?.school_status === 'INACTIVE', 'Disabled school was hard-deleted');

    const auditRows = await dataSource.query(
      `
        SELECT metadata->>'op' AS op
        FROM audit_log
        WHERE action = 'MASTER_DATA_EDIT'
          AND target_type = 'schools'
          AND target_id = $1
      `,
      [String(createdSchoolId)],
    );
    assert(auditRows.some((row) => row.op === 'create'), 'School create audit is missing');
    assert(auditRows.some((row) => row.op === 'disable'), 'School disable audit is missing');

    const form = new FormData();
    form.append(
      'file',
      new Blob(['PersonID_Onec,AcademicYear_Onec,Semester_Onec,SchoolID_Onec\n1,2569,1,99999999']),
      'school-master-smoke.csv',
    );
    form.append('target', 'student_term');
    form.append('mapping', '{}');
    form.append('schools', JSON.stringify([{ id: 99999999, name: 'Hidden school' }]));
    const importResponse = await fetch(`${baseUrl}/api/imports/bulk`, {
      method: 'POST',
      headers: { cookie: importerCookie },
      body: form,
    });
    assert(importResponse.status === 400, 'Import manual-school side effect was not rejected');

    console.log('school master-data scope smoke passed');
  } finally {
    try {
      if (schoolA && originalSchoolName) {
        await dataSource.query(`UPDATE schools SET name = $2 WHERE id = $1`, [
          schoolA.id,
          originalSchoolName,
        ]);
      }
      await cleanup(dataSource);
    } finally {
      await app.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
