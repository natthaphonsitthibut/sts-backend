const { randomUUID } = require('crypto');
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
  throw new Error('Refusing to run canonical import smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const ACTOR_USERNAME = 'canonical_import_smoke_actor';
// A teacher is matched by citizen id now — there is no login account to name.
// The 97 prefix keeps the smoke out of any real citizen-id range.
const TEACHER_CITIZEN_ID = '9700000000001';
const MISSING_TEACHER_CITIZEN_ID = '9700000000099';
const ACADEMIC_YEAR = 9901;
const SEMESTER = 1;
const ROOM_CODE = '1999999901';
const MAX_IMPORT_ROWS = 10_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return null;
  if (response.headers.get('content-type')?.includes('application/json')) {
    return JSON.parse(text);
  }
  return text;
}

async function request(baseUrl, method, path, expectedStatus, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await responseBody(response);
  assert(
    response.status === expectedStatus,
    `${method} ${path}: expected ${expectedStatus}, received ${response.status} (${JSON.stringify(payload)})`,
  );
  return { response, payload };
}

async function csvRequest(baseUrl, cookie, path, fields, csv, expectedStatus = 201) {
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'canonical-import-smoke.csv');
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, String(value));
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  const payload = await responseBody(response);
  assert(
    response.status === expectedStatus,
    `POST ${path}: expected ${expectedStatus}, received ${response.status} (${JSON.stringify(payload)})`,
  );
  return payload;
}

function cookieHeader(response) {
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  assert(setCookie?.includes('HttpOnly'), 'Login did not return an HttpOnly session cookie');
  return setCookie.split(';')[0];
}

async function upsertUser(dataSource, passwordHash, input) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    input.username,
  ]);
  const values = [
    input.username,
    passwordHash,
    input.firstName,
    input.lastName,
    JSON.stringify(input.permissions),
    JSON.stringify(input.dataScope),
    input.role,
  ];
  const rows = existing
    ? await dataSource.query(
        `UPDATE users
         SET password = $2, "FirstName" = $3, "LastName" = $4,
             permissions = $5::jsonb, data_scope = $6::jsonb, role = $7,
             status = 'ACTIVE', must_change_password = FALSE,
             temporary_password_issued_at = NULL, temporary_password_expires_at = NULL,
             deactivated_at = NULL, deactivated_by = NULL,
             deactivation_reason_code = NULL, deactivation_note = NULL,
             data_origin_code = 'AUTOMATED_TEST', email = NULL, phone = NULL
         WHERE username = $1
         RETURNING id`,
        values,
      )
    : await dataSource.query(
        `INSERT INTO users (
           username, password, "FirstName", "LastName", permissions, data_scope,
           role, status, must_change_password, data_origin_code, email, phone
         ) VALUES (
           $1, $2, $3, $4, $5::jsonb, $6::jsonb,
           $7, 'ACTIVE', FALSE, 'AUTOMATED_TEST', NULL, NULL
         )
         RETURNING id`,
        values,
      );
  const persisted = Array.isArray(rows[0]) ? rows[0][0] : rows[0];
  assert(persisted?.id, `Smoke user ${input.username} was not persisted`);
  return persisted;
}

async function cleanup(dataSource, actorId, schoolId) {
  const batches = await dataSource.query(
    `SELECT id FROM student_import_batches WHERE created_by = $1`,
    [actorId],
  );
  if (batches.length > 0) {
    const batchIds = batches.map((batch) => batch.id);
    await dataSource.query(
      `DELETE FROM student_import_quarantine_rows WHERE batch_id = ANY($1::uuid[])`,
      [batchIds],
    );
    await dataSource.query(`DELETE FROM student_import_batches WHERE id = ANY($1::uuid[])`, [
      batchIds,
    ]);
  }
  await dataSource.query(
    `DELETE FROM classroom_teacher_assignments WHERE school_id = $1 AND created_by = $2`,
    [schoolId, actorId],
  );
  await dataSource.query(
    `DELETE FROM school_teacher_memberships WHERE school_id = $1 AND created_by = $2`,
    [schoolId, actorId],
  );
  await dataSource.query(`DELETE FROM teachers WHERE citizen_id = $1`, [TEACHER_CITIZEN_ID]);
  await dataSource.query(
    `DELETE FROM school_classrooms
     WHERE school_id = $1 AND room_code = $2 AND created_by = $3`,
    [schoolId, ROOM_CODE, actorId],
  );
  await dataSource.query(
    `DELETE FROM school_terms
     WHERE school_id = $1 AND academic_year = $2 AND semester = $3 AND created_by = $4`,
    [schoolId, ACADEMIC_YEAR, SEMESTER, actorId],
  );
}

async function disableUsers(dataSource) {
  await dataSource.query(
    `UPDATE users
     SET status = 'DISABLED', deactivated_at = COALESCE(deactivated_at, NOW()),
         deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
         deactivation_note = COALESCE(
           deactivation_note,
           'Retained automated canonical import smoke fixture'
         )
     WHERE username = ANY($1::text[])`,
    [[ACTOR_USERNAME]],
  );
}

async function assertCanonicalImportMigration(dataSource) {
  const [row] = await dataSource.query(
    `SELECT pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conrelid = 'student_import_batches'::regclass
       AND conname = 'chk_student_import_batches_target'`,
  );
  assert(
    row?.definition?.includes('school_classroom') &&
      row.definition.includes('classroom_teacher_assignment'),
    'Canonical import migration is not applied; run migration 20260714280000 first',
  );
}

function studentCsv(rowCount) {
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const identifier = String(8_800_000_000_000 + index).padStart(13, '0');
    return `${identifier},Benchmark${index + 1}`;
  });
  return ['PersonID_Onec,FirstName_Onec', ...rows].join('\n');
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
  const password = `Canonical-Import-${Date.now()}-${randomUUID()}-Password`;
  let actor;
  let school;

  try {
    await assertCanonicalImportMigration(dataSource);
    [school] = await dataSource.query(
      `SELECT id, name FROM schools WHERE school_status = 'ACTIVE' ORDER BY id LIMIT 1`,
    );
    const [grade] = await dataSource.query(`SELECT id FROM grade_levels ORDER BY id LIMIT 1`);
    const [subject] = await dataSource.query(`SELECT id FROM subjects ORDER BY id LIMIT 1`);
    assert(school && grade && subject, 'Smoke requires an active school, grade, and subject');

    const passwordHash = await passwordService.hash(password);
    actor = await upsertUser(dataSource, passwordHash, {
      username: ACTOR_USERNAME,
      firstName: 'Canonical Import',
      lastName: 'Smoke Actor',
      permissions: ['import-data'],
      dataScope: { school_ids: [school.id] },
      role: 'ADMIN',
    });
    await cleanup(dataSource, actor.id, school.id);
    await dataSource.query(
      `
        INSERT INTO teachers (
          first_name, last_name, citizen_id, teacher_status, created_by, updated_by
        )
        VALUES ('Canonical Import', 'Smoke Teacher', $1, 'ACTIVE', $2, $2)
        ON CONFLICT DO NOTHING
      `,
      [TEACHER_CITIZEN_ID, actor.id],
    );

    const [term] = await dataSource.query(
      `INSERT INTO school_terms (
         school_id, academic_year, semester, status, created_by, updated_by
       ) VALUES ($1, $2, $3, 'DRAFT', $4, $4)
       RETURNING id`,
      [school.id, ACADEMIC_YEAR, SEMESTER, actor.id],
    );
    assert(term?.id, 'Canonical import smoke term was not created');

    const login = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: ACTOR_USERNAME, password },
    });
    const cookie = cookieHeader(login.response);

    const catalog = await request(baseUrl, 'GET', '/api/imports/catalog', 200, {
      headers: { cookie },
    });
    assert(catalog.payload?.version, 'Import catalog omitted its version');
    assert(
      JSON.stringify(catalog.payload.targets.map((target) => target.target)) ===
        JSON.stringify([
          'school_teacher_membership',
          'school_classroom',
          'classroom_teacher_assignment',
          'student_term',
        ]),
      'Import catalog target order or contents drifted',
    );
    assert(
      catalog.payload.targets.every((target) => target.allowed === true),
      'Smoke actor was not allowed for every expected import target',
    );

    const teacherFields = {
      target: 'school_teacher_membership',
      mapping: '{}',
      schoolId: school.id,
    };
    const teacherCsv = `citizenId,startedOn\n${TEACHER_CITIZEN_ID},2026-07-01`;
    const teacherPreview = await csvRequest(
      baseUrl,
      cookie,
      '/api/imports/preview',
      teacherFields,
      teacherCsv,
    );
    assert(teacherPreview.rowsReady === 1, 'Teacher catalog preview did not find one ready row');
    const teacherImport = await csvRequest(
      baseUrl,
      cookie,
      '/api/imports/bulk',
      teacherFields,
      teacherCsv,
    );
    assert(teacherImport.rowsInserted === 1, 'Teacher catalog import did not insert membership');

    const classroomFields = {
      target: 'school_classroom',
      mapping: '{}',
      schoolId: school.id,
      schoolTermId: term.id,
    };
    const classroomCsv = [
      'gradeLevelId,roomCode,roomName',
      `${grade.id},${ROOM_CODE},Canonical Import Smoke`,
      '2147483647,1999999902,Bad Grade',
    ].join('\n');
    const classroomPreview = await csvRequest(
      baseUrl,
      cookie,
      '/api/imports/preview',
      classroomFields,
      classroomCsv,
    );
    assert(
      classroomPreview.rowsToInsert === 1 && classroomPreview.rowsToQuarantine === 1,
      'Classroom preview did not split ready and quarantined rows',
    );
    const classroomFirst = await csvRequest(
      baseUrl,
      cookie,
      '/api/imports/bulk',
      classroomFields,
      classroomCsv,
    );
    assert(
      classroomFirst.rowsInserted === 1 && classroomFirst.rowsQuarantined === 1,
      'Classroom import did not persist one row and quarantine one row',
    );
    const classroomSecond = await csvRequest(
      baseUrl,
      cookie,
      '/api/imports/bulk',
      classroomFields,
      classroomCsv,
    );
    assert(
      classroomSecond.rowsInserted === 0 && classroomSecond.rowsSkipped === 1,
      'Classroom import rerun was not idempotent',
    );
    const [classroom] = await dataSource.query(
      `SELECT id FROM school_classrooms
       WHERE school_id = $1 AND school_term_id = $2 AND room_code = $3
         AND deleted_at IS NULL`,
      [school.id, term.id, ROOM_CODE],
    );
    assert(classroom?.id, 'Imported classroom was not persisted');

    const assignmentFields = {
      target: 'classroom_teacher_assignment',
      mapping: '{}',
      schoolId: school.id,
      schoolTermId: term.id,
      classroomId: classroom.id,
    };
    const assignmentCsv = [
      'citizenId,assignmentKind,subjectId',
      `${TEACHER_CITIZEN_ID},HOMEROOM,`,
      `${MISSING_TEACHER_CITIZEN_ID},SUBJECT,${subject.id}`,
    ].join('\n');
    const assignmentPreview = await csvRequest(
      baseUrl,
      cookie,
      '/api/imports/preview',
      assignmentFields,
      assignmentCsv,
    );
    assert(
      assignmentPreview.rowsToInsert === 1 && assignmentPreview.rowsToQuarantine === 1,
      'Assignment preview did not split ready and quarantined rows',
    );
    const assignmentFirst = await csvRequest(
      baseUrl,
      cookie,
      '/api/imports/bulk',
      assignmentFields,
      assignmentCsv,
    );
    assert(
      assignmentFirst.rowsInserted === 1 && assignmentFirst.rowsQuarantined === 1,
      'Assignment import did not persist one row and quarantine one row',
    );
    const assignmentSecond = await csvRequest(
      baseUrl,
      cookie,
      '/api/imports/bulk',
      assignmentFields,
      assignmentCsv,
    );
    assert(
      assignmentSecond.rowsInserted === 0 && assignmentSecond.rowsSkipped === 1,
      'Assignment import rerun was not idempotent',
    );

    const [state] = await dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int
          FROM school_classrooms
          WHERE school_id = $1 AND school_term_id = $2 AND room_code = $3
            AND deleted_at IS NULL) AS classroom_count,
         (SELECT COUNT(*)::int
          FROM classroom_teacher_assignments
          WHERE school_id = $1 AND classroom_id = $4 AND assignment_kind = 'HOMEROOM'
            AND assignment_status = 'ACTIVE' AND deleted_at IS NULL) AS assignment_count,
         (SELECT COUNT(*)::int
          FROM student_import_quarantine_rows quarantine
          JOIN student_import_batches batch ON batch.id = quarantine.batch_id
          WHERE batch.created_by = $5
            AND quarantine.reason_code IN ('GRADE_NOT_FOUND', 'TEACHER_MEMBERSHIP_NOT_FOUND')
            AND quarantine.status = 'PENDING' AND quarantine.deleted_at IS NULL) AS quarantine_count`,
      [school.id, term.id, ROOM_CODE, classroom.id, actor.id],
    );
    assert(state.classroom_count === 1, 'Classroom rerun created a duplicate row');
    assert(state.assignment_count === 1, 'Assignment rerun created a duplicate row');
    assert(state.quarantine_count === 2, 'Canonical import quarantine rows were not idempotent');

    const studentFields = {
      target: 'student_term',
      mapping: '{}',
      schoolId: school.id,
      schoolTermId: term.id,
      classroomId: classroom.id,
    };
    const benchmarkStartedAt = performance.now();
    const benchmark = await csvRequest(
      baseUrl,
      cookie,
      '/api/imports/preview',
      studentFields,
      studentCsv(MAX_IMPORT_ROWS),
    );
    const benchmarkMs = Math.round(performance.now() - benchmarkStartedAt);
    assert(
      benchmark.rowsProcessed === MAX_IMPORT_ROWS && benchmark.rowsReady === MAX_IMPORT_ROWS,
      '10k student preview did not accept and evaluate every row',
    );
    const overLimit = await csvRequest(
      baseUrl,
      cookie,
      '/api/imports/preview',
      studentFields,
      studentCsv(MAX_IMPORT_ROWS + 1),
      400,
    );
    assert(
      JSON.stringify(overLimit).includes('10000'),
      '10,001-row rejection did not report the 10,000-row limit',
    );

    console.log(
      `canonical import smoke passed (catalog, classroom, assignment, quarantine, rerun; 10k preview ${benchmarkMs} ms)`,
    );
  } finally {
    try {
      if (actor && school) await cleanup(dataSource, actor.id, school.id);
    } finally {
      try {
        await disableUsers(dataSource);
      } finally {
        await app.close();
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
