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

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const ALTERNATE_ACADEMIC_YEAR = 2598;
const SMOKE_ROOM_NAME = 'Quarantine smoke';
const SMOKE_KEY = 'student-import-quarantine-smoke';
const GLOBAL_USERNAME = 'student_import_quarantine_smoke_global';
const OUT_OF_SCOPE_USERNAME = 'student_import_quarantine_smoke_out_scope';
const NO_PERMISSION_USERNAME = 'student_import_quarantine_smoke_no_permission';
const IDENTIFIER = '9700000000001';
const READY_IDENTIFIER = '9700000000002';
const REJECT_IDENTIFIER = '9700000000003';
const PLACEHOLDER_STATUS_CODE = 9872;
const REAL_STATUS_CODE = 9871;

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
    `${method} ${path}: expected ${expectedStatus}, received ${response.status} (${JSON.stringify(payload)})`,
  );
  return { response, payload };
}

async function previewUpload(baseUrl, cookie, fixture, expectedStatus) {
  const csv = [
    'PersonID_Onec,AcademicYear_Onec,Semester_Onec,SchoolID_Onec',
    `${IDENTIFIER},${fixture.academicYear},${fixture.semester},${fixture.schoolId}`,
  ].join('\n');
  const body = new FormData();
  body.append('file', new Blob([csv], { type: 'text/csv' }), 'students.csv');
  body.append('target', 'student_term');
  body.append('mapping', '{}');
  // The canonical import context: the endpoint refuses a preview that does not
  // say which school, term and classroom the rows belong to.
  body.append('schoolId', String(fixture.schoolId));
  body.append('schoolTermId', String(fixture.schoolTermId));
  body.append('classroomId', String(fixture.classroomId));
  const response = await fetch(`${baseUrl}/api/imports/preview`, {
    method: 'POST',
    headers: { cookie },
    body,
  });
  const payload = await responseBody(response);
  assert(
    response.status === expectedStatus,
    `POST /api/imports/preview: expected ${expectedStatus}, received ${response.status} ${JSON.stringify(payload)}`,
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
           affiliation = 'Automated student import quarantine smoke',
           data_origin_code = 'AUTOMATED_TEST', email = NULL, phone = NULL
       WHERE id = $1`,
      [existing.id, passwordHash, JSON.stringify(permissions), JSON.stringify(dataScope)],
    );
    return existing;
  }
  const [created] = await dataSource.query(
    `INSERT INTO users (
       username, password, "FirstName", "LastName", status, permissions, role,
       data_scope, must_change_password, affiliation, data_origin_code, email, phone
     ) VALUES (
       $1, $2, 'Import', 'Quarantine Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
       $4::jsonb, FALSE, 'Automated student import quarantine smoke',
       'AUTOMATED_TEST', NULL, NULL
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
  await dataSource.query(`DELETE FROM student_status WHERE code = ANY($1::int[])`, [
    [PLACEHOLDER_STATUS_CODE, REAL_STATUS_CODE],
  ]);
  // Only the rooms this smoke created carry its own room_name; rooms it reused
  // from the school's real term keep theirs and are left alone.
  await dataSource.query(`DELETE FROM school_classrooms WHERE room_name = $1`, [SMOKE_ROOM_NAME]);
  await dataSource.query(
    `DELETE FROM school_terms
     WHERE academic_year = ANY($1::int[])
       AND NOT EXISTS (
         SELECT 1 FROM school_classrooms classroom WHERE classroom.school_term_id = school_terms.id
       )`,
    [[ALTERNATE_ACADEMIC_YEAR]],
  );
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
  // An enrolment only exists inside a configured term and classroom — the
  // `resolve_student_term_structure_refs` trigger refuses anything else. Borrow
  // the school's real active term for the main rows (a school may hold only one
  // active term, so a second one cannot be invented) and add a DRAFT term for
  // the row that has to sit in a different year: the trigger asks for a term
  // that exists, not one that is active.
  const [activeTerm] = await dataSource.query(
    `SELECT term.id, term.school_id, term.academic_year, term.semester
     FROM school_terms term
     WHERE term.status = 'ACTIVE' AND term.deleted_at IS NULL
     ORDER BY term.school_id, term.id
     LIMIT 1`,
  );
  assert(activeTerm, 'Smoke requires one active school term');
  const [grade] = await dataSource.query(`SELECT id FROM grade_levels ORDER BY id LIMIT 1`);
  assert(grade, 'Smoke requires at least one grade level');

  const [draftTerm] = await dataSource.query(
    `INSERT INTO school_terms (
       school_id, academic_year, semester, status, created_by, updated_by
     )
     VALUES ($1, $2, $3, 'DRAFT', $4, $4)
     ON CONFLICT (school_id, academic_year, semester) DO UPDATE SET updated_by = EXCLUDED.updated_by
     RETURNING id`,
    [activeTerm.school_id, ALTERNATE_ACADEMIC_YEAR, activeTerm.semester, actorId],
  );
  assert(draftTerm?.id, 'Smoke could not prepare the alternate term');

  // Rooms 1–3: the ready row uses 1, and the row that starts with an invalid
  // room is corrected to 3 later in the run.
  for (const termId of [activeTerm.id, draftTerm.id]) {
    for (const roomNumber of [1, 2, 3]) {
      await dataSource.query(
        `INSERT INTO school_classrooms (
           school_term_id, school_id, grade_level_id, legacy_room_number, room_code,
           room_name, classroom_status, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, $7)
         ON CONFLICT DO NOTHING`,
        [
          termId,
          activeTerm.school_id,
          grade.id,
          roomNumber,
          String(roomNumber),
          SMOKE_ROOM_NAME,
          actorId,
        ],
      );
    }
  }

  const [readyClassroom] = await dataSource.query(
    `SELECT id FROM school_classrooms
     WHERE school_term_id = $1 AND school_id = $2 AND grade_level_id = $3
       AND legacy_room_number = 1 AND classroom_status = 'ACTIVE' AND deleted_at IS NULL
     LIMIT 1`,
    [activeTerm.id, activeTerm.school_id, grade.id],
  );
  assert(readyClassroom?.id, 'Smoke could not resolve the classroom it just prepared');

  const classroom = {
    school_id: activeTerm.school_id,
    grade_level_id: grade.id,
    room_no: 1,
    academic_year: activeTerm.academic_year,
    semester: activeTerm.semester,
  };

  const personUuids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, personUuid] of personUuids.entries()) {
    const identifier = index === 2 ? READY_IDENTIFIER : IDENTIFIER;
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
      [personUuid, identifier, SMOKE_KEY, actorId],
    );
    await dataSource.query(
      `INSERT INTO student_term (
         person_uuid, "PersonID_Onec", "FirstName_Onec", "LastName_Onec",
         "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
         "AcademicYear_Onec", "Semester_Onec", created_by, updated_by
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        personUuid,
        `${identifier}-${index}`,
        `Candidate${index + 1}`,
        'Smoke',
        classroom.school_id,
        classroom.grade_level_id,
        classroom.room_no,
        classroom.academic_year,
        classroom.semester,
        actorId,
      ],
    );
  }

  const [batch] = await dataSource.query(
    `INSERT INTO student_import_batches (
       target, source_sha256, scope_snapshot, status, total_rows,
       quarantined_rows, completed_at, created_by, updated_by
     ) VALUES (
       'student_term', $1, $2::jsonb, 'PARTIAL', 5, 5, NOW(), $3, $3
     ) RETURNING id`,
    [createHash('sha256').update(randomUUID()).digest('hex'), JSON.stringify({ smoke_key: SMOKE_KEY }), actorId],
  );

  const baseValues = {
    PersonID_Onec: IDENTIFIER,
    FirstName_Onec: 'Private',
    LastName_Onec: 'Smoke',
    SchoolID_Onec: classroom.school_id,
    GradeLevelID_Onec: classroom.grade_level_id,
    RoomID_Onec: classroom.room_no,
    AcademicYear_Onec: classroom.academic_year,
    Semester_Onec: classroom.semester,
  };
  await dataSource.query(
    `INSERT INTO student_status (code, label_th, category, sort_order, source_system, created_by, updated_by)
     VALUES
       ($1, 'สถานะสำหรับ smoke', 'ACTIVE', 200, 'SMOKE', $3, $3),
       ($2, 'ยังไม่ได้จับคู่ (smoke)', 'UNMAPPED', 201, 'SMOKE', $3, $3)
     ON CONFLICT (code) DO NOTHING`,
    [REAL_STATUS_CODE, PLACEHOLDER_STATUS_CODE, actorId],
  );

  const createdRows = [];
  for (const [index, reasonCode] of [
    'IDENTIFIER_CONFLICT',
    'GRADE_NOT_FOUND',
    'ROOM_NOT_FOUND',
    'DUPLICATE_ROW_IN_FILE',
    'UNMAPPED_STUDENT_STATUS',
  ].entries()) {
    const [row] = await dataSource.query(
      `INSERT INTO student_import_quarantine_rows (
         batch_id, school_id, source_row_number, row_fingerprint, reason_code,
         mapped_values, created_by, updated_by
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $7)
       RETURNING id::text`,
      [
        batch.id,
        classroom.school_id,
        index + 2,
        createHash('sha256').update(`${batch.id}:${index}`).digest('hex'),
        reasonCode,
        JSON.stringify({
          ...baseValues,
          PersonID_Onec:
            index === 1 || index === 2 || index === 4
              ? READY_IDENTIFIER
              : index === 3
                ? REJECT_IDENTIFIER
                : IDENTIFIER,
          RoomID_Onec: index === 2 ? 'bad' : classroom.room_no,
          ...(index === 4
            ? {
                AcademicYear_Onec: ALTERNATE_ACADEMIC_YEAR,
                StudentStatusID_Onec: PLACEHOLDER_STATUS_CODE,
              }
            : {}),
        }),
        actorId,
      ],
    );
    createdRows.push(row.id);
  }
  return {
    schoolId: Number(classroom.school_id),
    academicYear: Number(classroom.academic_year),
    semester: Number(classroom.semester),
    schoolTermId: Number(activeTerm.id),
    classroomId: Number(readyClassroom.id),
    personUuids,
    conflictRowId: createdRows[0],
    readyRowId: createdRows[1],
    fixRowId: createdRows[2],
    rejectRowId: createdRows[3],
    unmappedStatusRowId: createdRows[4],
  };
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

    await previewUpload(baseUrl, cookies[OUT_OF_SCOPE_USERNAME], fixture, 403);
    await previewUpload(baseUrl, cookies[NO_PERMISSION_USERNAME], fixture, 403);
    const preview = await previewUpload(baseUrl, cookies[GLOBAL_USERNAME], fixture, 201);
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
    const visibleFixtureIds = new Set((list.payload?.items ?? []).map((item) => item.id));
    assert(
      [
        fixture.conflictRowId,
        fixture.readyRowId,
        fixture.fixRowId,
        fixture.rejectRowId,
        fixture.unmappedStatusRowId,
      ].every((id) => visibleFixtureIds.has(id)),
      'Global actor did not see all quarantine smoke rows',
    );
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
    assert(candidates.payload?.meta?.totalCount === 2, 'Candidate endpoint total count is incorrect');
    assert(candidates.payload?.meta?.visibleCount === 2, 'Candidate endpoint visible count is incorrect');
    assert(candidates.payload?.importRow?.schoolName, 'Candidate endpoint omitted import-row context');
    assert(candidates.payload.items.every((item) => item.schoolName), 'Candidate context omitted school names');
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

    const outOfScopeRetrySummary = await request(
      baseUrl,
      'GET',
      `/api/imports/quarantine-retryable-summary?reasonCode=GRADE_NOT_FOUND&search=Private&schoolId=${fixture.schoolId}`,
      200,
      { headers: { cookie: cookies[OUT_OF_SCOPE_USERNAME] } },
    );
    assert(outOfScopeRetrySummary.payload?.readyCount === 0, 'Out-of-scope retry count was exposed');
    await request(baseUrl, 'GET', '/api/imports/quarantine-retryable-summary', 403, {
      headers: { cookie: cookies[NO_PERMISSION_USERNAME] },
    });
    const retrySummary = await request(
      baseUrl,
      'GET',
      `/api/imports/quarantine-retryable-summary?reasonCode=GRADE_NOT_FOUND&search=Private&schoolId=${fixture.schoolId}`,
      200,
      { headers: { cookie: cookies[GLOBAL_USERNAME] } },
    );
    assert(retrySummary.payload?.readyCount === 1, 'Ready quarantine count is incorrect');
    const retryFilters = {
      reasonCode: 'GRADE_NOT_FOUND',
      search: 'Private',
      schoolId: fixture.schoolId,
    };
    const retried = await request(baseUrl, 'POST', '/api/imports/quarantine-retry', 201, {
      headers: { cookie: cookies[GLOBAL_USERNAME] },
      body: retryFilters,
    });
    assert(retried.payload?.processedCount === 1, 'Ready quarantine row was not retried');
    assert(
      retried.payload?.items?.[0]?.sourceRowNumber === 3,
      'Bulk retry result omitted the source row number',
    );
    assert(
      retried.payload?.items?.[0]?.studentName === 'Private Smoke',
      'Bulk retry result omitted the student name',
    );
    const retriedAgain = await request(baseUrl, 'POST', '/api/imports/quarantine-retry', 201, {
      headers: { cookie: cookies[GLOBAL_USERNAME] },
      body: retryFilters,
    });
    assert(retriedAgain.payload?.selectedCount === 0, 'Bulk retry was not idempotent');

    const fixed = await request(
      baseUrl,
      'PATCH',
      `/api/imports/quarantine/${fixture.fixRowId}/values`,
      200,
      {
        headers: { cookie: cookies[GLOBAL_USERNAME] },
        body: { values: { RoomID_Onec: '3' } },
      },
    );
    assert(fixed.payload?.status === 'RESOLVED', 'Inline quarantine correction did not resolve');

    // A placeholder status (category UNMAPPED) exists in master data but must
    // not count as mapped: not retry-eligible, and rejected as a fix value.
    const unmappedSummary = await request(
      baseUrl,
      'GET',
      `/api/imports/quarantine-retryable-summary?reasonCode=UNMAPPED_STUDENT_STATUS&search=Private&schoolId=${fixture.schoolId}`,
      200,
      { headers: { cookie: cookies[GLOBAL_USERNAME] } },
    );
    assert(
      unmappedSummary.payload?.readyCount === 0,
      'Placeholder UNMAPPED-category status was counted as retry-ready',
    );
    await request(
      baseUrl,
      'PATCH',
      `/api/imports/quarantine/${fixture.unmappedStatusRowId}/values`,
      400,
      {
        headers: { cookie: cookies[GLOBAL_USERNAME] },
        body: { values: { StudentStatusID_Onec: String(PLACEHOLDER_STATUS_CODE) } },
      },
    );
    const statusFixed = await request(
      baseUrl,
      'PATCH',
      `/api/imports/quarantine/${fixture.unmappedStatusRowId}/values`,
      200,
      {
        headers: { cookie: cookies[GLOBAL_USERNAME] },
        body: { values: { StudentStatusID_Onec: String(REAL_STATUS_CODE) } },
      },
    );
    assert(
      statusFixed.payload?.status === 'RESOLVED',
      'Quarantined status row was not resolved with a mapped status',
    );

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
    assert(
      typeof exported.payload === 'string' && exported.payload.includes('แถวซ้ำในไฟล์'),
      'Rejected CSV is missing the readable reason label',
    );
    assert(!exported.payload.includes(IDENTIFIER), 'Rejected CSV leaked the raw identifier');
    assert(exported.payload.includes('Private'), 'Scoped rejected CSV omitted the student name');

    const [state] = await dataSource.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved_count,
         COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected_count
       FROM student_import_quarantine_rows
       WHERE id = ANY($1::bigint[])`,
      [
        [
          fixture.conflictRowId,
          fixture.readyRowId,
          fixture.fixRowId,
          fixture.rejectRowId,
          fixture.unmappedStatusRowId,
        ],
      ],
    );
    assert(state.resolved_count === 4 && state.rejected_count === 1, 'Resolution state was not persisted');

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
