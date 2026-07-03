const { createHash, randomUUID } = require('crypto');
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
  throw new Error('Refusing to run student import quarantine smoke with NODE_ENV=production');
}

const SMOKE_KEY = 'student-import-quarantine-smoke';
const GLOBAL_USERNAME = 'student_import_quarantine_smoke_global';
const OUT_OF_SCOPE_USERNAME = 'student_import_quarantine_smoke_out_scope';
const NO_PERMISSION_USERNAME = 'student_import_quarantine_smoke_no_permission';
const IDENTIFIER = '9700000000001';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function responseBody(response) {
  const raw = await response.text();
  if (!raw) return null;
  return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(raw) : raw;
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
  const payload = await responseBody(response);
  assert(
    response.status === expectedStatus,
    `${method} ${path}: expected ${expectedStatus}, received ${response.status}`,
  );
  return { response, payload };
}

async function previewUpload(baseUrl, cookie, schoolId, expectedStatus) {
  const csv = [
    'PersonID_Onec,AcademicYear_Onec,Semester_Onec,SchoolID_Onec',
    `${IDENTIFIER},2599,1,${schoolId}`,
  ].join('\n');
  const body = new FormData();
  body.append('file', new Blob([csv], { type: 'text/csv' }), 'students.csv');
  body.append('target', 'student_term');
  body.append('mapping', '{}');
  const response = await fetch(`${baseUrl}/api/imports/preview`, {
    method: 'POST',
    headers: { cookie },
    body,
  });
  const payload = await responseBody(response);
  assert(
    response.status === expectedStatus,
    `POST /api/imports/preview: expected ${expectedStatus}, received ${response.status}`,
  );
  return payload;
}

async function upsertActor(dataSource, passwordHash, username, permissions, dataScope) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing) {
    await dataSource.query(
      `UPDATE users
       SET password = $2, "FirstName" = 'Import', "LastName" = 'Quarantine Smoke',
           status = 'ACTIVE', permissions = $3::jsonb, role = 'ADMIN', data_scope = $4::jsonb,
           must_change_password = FALSE, temporary_password_issued_at = NULL,
           temporary_password_expires_at = NULL, deactivated_at = NULL, deactivated_by = NULL,
           deactivation_reason_code = NULL, deactivation_note = NULL,
           affiliation = 'Automated student import quarantine smoke', email = NULL, phone = NULL
       WHERE id = $1`,
      [existing.id, passwordHash, JSON.stringify(permissions), JSON.stringify(dataScope)],
    );
    return existing;
  }
  const [created] = await dataSource.query(
    `INSERT INTO users (
       username, password, "FirstName", "LastName", status, permissions, role,
       data_scope, must_change_password, affiliation, email, phone
     ) VALUES (
       $1, $2, 'Import', 'Quarantine Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
       $4::jsonb, FALSE, 'Automated student import quarantine smoke', NULL, NULL
     ) RETURNING id`,
    [username, passwordHash, JSON.stringify(permissions), JSON.stringify(dataScope)],
  );
  return created;
}

async function cleanupFixtures(dataSource) {
  const people = await dataSource.query(
    `SELECT DISTINCT person_uuid FROM student_person_identifier WHERE source = $1`,
    [SMOKE_KEY],
  );
  const personUuids = people.map((row) => row.person_uuid);
  await dataSource.query(
    `DELETE FROM student_import_quarantine_rows q
     USING student_import_batches b
     WHERE q.batch_id = b.id AND b.scope_snapshot->>'smoke_key' = $1`,
    [SMOKE_KEY],
  );
  await dataSource.query(
    `DELETE FROM student_import_batches WHERE scope_snapshot->>'smoke_key' = $1`,
    [SMOKE_KEY],
  );
  if (personUuids.length > 0) {
    await dataSource.query(`DELETE FROM student_term WHERE person_uuid = ANY($1::uuid[])`, [
      personUuids,
    ]);
    await dataSource.query(`DELETE FROM student_person_identifier WHERE person_uuid = ANY($1::uuid[])`, [
      personUuids,
    ]);
    await dataSource.query(`DELETE FROM student_person WHERE person_uuid = ANY($1::uuid[])`, [
      personUuids,
    ]);
  }
}

async function disableActors(dataSource) {
  await dataSource.query(
    `UPDATE users
     SET status = 'DISABLED', deactivated_at = COALESCE(deactivated_at, NOW()),
         deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
         deactivation_note = COALESCE(deactivation_note, 'Retained automated smoke fixture')
     WHERE username = ANY($1::text[])`,
    [[GLOBAL_USERNAME, OUT_OF_SCOPE_USERNAME, NO_PERMISSION_USERNAME]],
  );
}

async function createFixtures(dataSource, actorId) {
  const [school] = await dataSource.query(`SELECT id FROM schools ORDER BY id LIMIT 1`);
  const [grade] = await dataSource.query(`SELECT id FROM grade_levels ORDER BY id LIMIT 1`);
  assert(school && grade, 'Smoke requires at least one school and one grade level');

  const personUuids = [randomUUID(), randomUUID()];
  for (const [index, personUuid] of personUuids.entries()) {
    await dataSource.query(
      `INSERT INTO student_person (person_uuid, identity_status, created_by, updated_by)
       VALUES ($1::uuid, 'ACTIVE', $2, $2)`,
      [personUuid, actorId],
    );
    await dataSource.query(
      `INSERT INTO student_person_identifier (
         person_uuid, identifier_type, identifier_value, identifier_normalized,
         is_primary, source, created_by, updated_by
       ) VALUES ($1::uuid, 'NATIONAL_ID', $2, $2, TRUE, $3, $4, $4)`,
      [personUuid, IDENTIFIER, SMOKE_KEY, actorId],
    );
    await dataSource.query(
      `INSERT INTO student_term (
         person_uuid, "PersonID_Onec", "FirstName_Onec", "LastName_Onec",
         "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
         "AcademicYear_Onec", "Semester_Onec", created_by, updated_by
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, 1, $7, 1, $8, $8)`,
      [
        personUuid,
        `${IDENTIFIER}-${index}`,
        `Candidate${index + 1}`,
        'Smoke',
        school.id,
        grade.id,
        2500 + index,
        actorId,
      ],
    );
  }

  const [batch] = await dataSource.query(
    `INSERT INTO student_import_batches (
       target, source_sha256, scope_snapshot, status, total_rows,
       quarantined_rows, completed_at, created_by, updated_by
     ) VALUES (
       'student_term', $1, $2::jsonb, 'PARTIAL', 2, 2, NOW(), $3, $3
     ) RETURNING id`,
    [createHash('sha256').update(randomUUID()).digest('hex'), JSON.stringify({ smoke_key: SMOKE_KEY }), actorId],
  );

  const baseValues = {
    PersonID_Onec: IDENTIFIER,
    FirstName_Onec: 'Private',
    LastName_Onec: 'Smoke',
    SchoolID_Onec: school.id,
    GradeLevelID_Onec: grade.id,
    RoomID_Onec: 1,
    AcademicYear_Onec: 2599,
    Semester_Onec: 1,
  };
  const createdRows = [];
  for (const [index, reasonCode] of ['IDENTIFIER_CONFLICT', 'GRADE_NOT_FOUND'].entries()) {
    const [row] = await dataSource.query(
      `INSERT INTO student_import_quarantine_rows (
         batch_id, school_id, source_row_number, row_fingerprint, reason_code,
         mapped_values, created_by, updated_by
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $7)
       RETURNING id::text`,
      [
        batch.id,
        school.id,
        index + 2,
        createHash('sha256').update(`${batch.id}:${index}`).digest('hex'),
        reasonCode,
        JSON.stringify({ ...baseValues, RoomID_Onec: index + 1 }),
        actorId,
      ],
    );
    createdRows.push(row.id);
  }
  return { schoolId: Number(school.id), personUuids, conflictRowId: createdRows[0], rejectRowId: createdRows[1] };
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
  const password = `Import-${Date.now()}-${randomUUID()}-Password`;

  try {
    await cleanupFixtures(dataSource);
    const passwordHash = await passwordService.hash(password);
    const globalActor = await upsertActor(
      dataSource,
      passwordHash,
      GLOBAL_USERNAME,
      ['import-data'],
      { global: true },
    );
    const fixture = await createFixtures(dataSource, globalActor.id);
    await upsertActor(
      dataSource,
      passwordHash,
      OUT_OF_SCOPE_USERNAME,
      ['import-data'],
      { school_ids: [fixture.schoolId + 999999] },
    );
    await upsertActor(dataSource, passwordHash, NO_PERMISSION_USERNAME, ['home'], { global: true });

    const cookies = {};
    for (const username of [GLOBAL_USERNAME, OUT_OF_SCOPE_USERNAME, NO_PERMISSION_USERNAME]) {
      const login = await request(baseUrl, 'POST', '/api/users/login', 201, {
        body: { username, password },
      });
      cookies[username] = cookieHeader(login.response);
    }

    await previewUpload(
      baseUrl,
      cookies[OUT_OF_SCOPE_USERNAME],
      fixture.schoolId,
      403,
    );
    await previewUpload(baseUrl, cookies[NO_PERMISSION_USERNAME], fixture.schoolId, 403);
    const preview = await previewUpload(
      baseUrl,
      cookies[GLOBAL_USERNAME],
      fixture.schoolId,
      201,
    );
    assert(preview?.rowsToQuarantine === 1, 'Global preview did not detect identity conflict');
    assert(!JSON.stringify(preview).includes(IDENTIFIER), 'Preview leaked the raw identifier');
    for (const personUuid of fixture.personUuids) {
      assert(!JSON.stringify(preview).includes(personUuid), 'Preview leaked person_uuid');
    }

    await request(baseUrl, 'GET', '/api/imports/quarantine?page=1&limit=100', 400, {
      headers: { cookie: cookies[GLOBAL_USERNAME] },
    });
    await request(baseUrl, 'GET', '/api/imports/quarantine?page=1&limit=20', 403, {
      headers: { cookie: cookies[NO_PERMISSION_USERNAME] },
    });
    const outOfScope = await request(baseUrl, 'GET', '/api/imports/quarantine?page=1&limit=20', 200, {
      headers: { cookie: cookies[OUT_OF_SCOPE_USERNAME] },
    });
    assert(outOfScope.payload?.meta?.totalCount === 0, 'Out-of-scope actor saw quarantine rows');

    const list = await request(baseUrl, 'GET', '/api/imports/quarantine?page=1&limit=20', 200, {
      headers: { cookie: cookies[GLOBAL_USERNAME] },
    });
    assert(list.payload?.meta?.totalCount === 2, 'Global actor did not see both quarantine rows');
    const serializedList = JSON.stringify(list.payload);
    assert(!serializedList.includes(IDENTIFIER), 'Quarantine list leaked the raw identifier');
    for (const personUuid of fixture.personUuids) {
      assert(!serializedList.includes(personUuid), 'Quarantine list leaked person_uuid');
    }

    const candidates = await request(
      baseUrl,
      'GET',
      `/api/imports/quarantine/${fixture.conflictRowId}/candidates`,
      200,
      { headers: { cookie: cookies[GLOBAL_USERNAME] } },
    );
    assert(candidates.payload?.items?.length === 2, 'Candidate endpoint did not return two matches');
    assert(candidates.payload.items.every((item) => /^[0-9a-f]{64}$/.test(item.candidateKey)), 'Candidate keys are not opaque hashes');
    const serializedCandidates = JSON.stringify(candidates.payload);
    for (const personUuid of fixture.personUuids) {
      assert(!serializedCandidates.includes(personUuid), 'Candidate response leaked person_uuid');
    }

    const resolved = await request(
      baseUrl,
      'POST',
      `/api/imports/quarantine/${fixture.conflictRowId}/resolve`,
      201,
      {
        headers: { cookie: cookies[GLOBAL_USERNAME] },
        body: { action: 'RESOLVE', candidateKey: candidates.payload.items[0].candidateKey },
      },
    );
    assert(resolved.payload?.status === 'RESOLVED', 'Identity conflict was not resolved');
    assert(!JSON.stringify(resolved.payload).includes(fixture.personUuids[0]), 'Resolve leaked person_uuid');

    const rejected = await request(
      baseUrl,
      'POST',
      `/api/imports/quarantine/${fixture.rejectRowId}/resolve`,
      201,
      {
        headers: { cookie: cookies[GLOBAL_USERNAME] },
        body: { action: 'REJECT', note: 'Automated smoke rejection' },
      },
    );
    assert(rejected.payload?.status === 'REJECTED', 'Quarantine row was not rejected');

    const exported = await request(baseUrl, 'GET', '/api/imports/quarantine-export?status=REJECTED', 200, {
      headers: { cookie: cookies[GLOBAL_USERNAME] },
    });
    assert(typeof exported.payload === 'string' && exported.payload.includes('GRADE_NOT_FOUND'), 'Rejected CSV is missing the row');
    assert(!exported.payload.includes(IDENTIFIER), 'Rejected CSV leaked the raw identifier');
    assert(!exported.payload.includes('Private'), 'Rejected CSV leaked the student name');

    const [state] = await dataSource.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved_count,
         COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected_count
       FROM student_import_quarantine_rows
       WHERE id = ANY($1::bigint[])`,
      [[fixture.conflictRowId, fixture.rejectRowId]],
    );
    assert(state.resolved_count === 1 && state.rejected_count === 1, 'Resolution state was not persisted');

    console.log('student import quarantine smoke passed');
  } finally {
    try {
      await cleanupFixtures(dataSource);
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
