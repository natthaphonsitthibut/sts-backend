const { NestFactory } = require('@nestjs/core');
const { randomUUID } = require('crypto');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { DataExportsService } = require('../dist/data-exports/data-exports.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run data export smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const FIXTURE_SCHOOL_ID = 2_140_000_001;
const FIXTURE_PROVINCE = 'จังหวัดทดสอบส่งออก';
const FIXTURE_DISTRICT = 'อำเภอทดสอบส่งออก';
const FIXTURE_SUB_DISTRICT = 'ตำบลทดสอบส่งออก';
const FIXTURE_ROOM_ID = 91;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createSessionCookie(sessionCookieService, userId) {
  let captured = null;
  sessionCookieService.setSession(
    {
      cookie: (name, value) => {
        captured = { name, value };
      },
    },
    userId,
  );
  assert(captured, 'Session cookie was not created');
  return captured;
}

async function requestJson(baseUrl, path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      cookie: `${cookie.name}=${cookie.value}`,
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function postJson(baseUrl, path, cookie, body = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      cookie: `${cookie.name}=${cookie.value}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function requestText(baseUrl, path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      cookie: `${cookie.name}=${cookie.value}`,
    },
  });
  return { status: response.status, text: await response.text() };
}

async function waitFor(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(lastError ? `${message}: ${lastError.message || lastError}` : message);
}

function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  cells.push(value);
  return cells;
}

function parseCsv(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split('\n');
  const headers = parseCsvLine(lines.shift() || '');
  return lines.filter(Boolean).map((line) => {
    const cells = parseCsvLine(line.replace(/\r$/, ''));
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

async function upsertActor(dataSource, username, permissions) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET status = 'ACTIVE',
            permissions = $2::jsonb,
            role = 'ADMIN',
            data_scope = '{"global":true}'::jsonb,
            data_origin_code = 'AUTOMATED_TEST',
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL
        WHERE id = $1
      `,
      [existing.id, JSON.stringify(permissions)],
    );
    return Number(existing.id);
  }
  const [created] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, data_origin_code
      )
      VALUES (
        $1, 'not-used-by-session-smoke', 'Data Export', 'Smoke', 'ACTIVE',
        $2::jsonb, 'ADMIN', '{"global":true}'::jsonb, FALSE, 'AUTOMATED_TEST'
      )
      RETURNING id
    `,
    [username, JSON.stringify(permissions)],
  );
  return Number(created.id);
}

async function disableActors(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated data export smoke fixture')
      WHERE username LIKE 'data_export_smoke_%'
        AND data_origin_code = 'AUTOMATED_TEST'
    `,
  );
}

async function cleanupDataFixture(dataSource, personUuids = []) {
  const existingPeople = await dataSource.query(
    `SELECT DISTINCT person_uuid::text FROM student_term WHERE "SchoolID_Onec" = $1`,
    [FIXTURE_SCHOOL_ID],
  );
  await dataSource.query(`DELETE FROM student_term WHERE "SchoolID_Onec" = $1`, [
    FIXTURE_SCHOOL_ID,
  ]);
  const allPersonUuids = Array.from(
    new Set([...personUuids, ...existingPeople.map((row) => row.person_uuid)]),
  );
  if (allPersonUuids.length > 0) {
    await dataSource.query(`DELETE FROM student_person WHERE person_uuid = ANY($1::uuid[])`, [
      allPersonUuids,
    ]);
  }
  await dataSource.query(`DELETE FROM school_classrooms WHERE school_id = $1`, [FIXTURE_SCHOOL_ID]);
  await dataSource.query(`DELETE FROM school_terms WHERE school_id = $1`, [FIXTURE_SCHOOL_ID]);
  await dataSource.query(`DELETE FROM schools WHERE id = $1`, [FIXTURE_SCHOOL_ID]);
}

async function createDataFixture(dataSource, actorId) {
  await cleanupDataFixture(dataSource);
  const [grade] = await dataSource.query(`SELECT id, label FROM grade_levels ORDER BY id LIMIT 1`);
  assert(grade, 'Data export smoke requires one grade level');
  await dataSource.query(
    `
      INSERT INTO schools (id, name, province, district, sub_district, school_status)
      VALUES ($1, 'โรงเรียนทดสอบส่งออก', $2, $3, $4, 'ACTIVE')
    `,
    [FIXTURE_SCHOOL_ID, FIXTURE_PROVINCE, FIXTURE_DISTRICT, FIXTURE_SUB_DISTRICT],
  );
  const [term] = await dataSource.query(
    `
      INSERT INTO school_terms (
        school_id, academic_year, semester, status, created_by, updated_by
      )
      VALUES ($1, 2700, 1, 'DRAFT', $2, $2)
      RETURNING id
    `,
    [FIXTURE_SCHOOL_ID, actorId],
  );
  const [classroom] = await dataSource.query(
    `
      INSERT INTO school_classrooms (
        school_term_id, school_id, grade_level_id, legacy_room_number,
        room_code, room_name, classroom_status, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, '91', 'ห้องทดสอบส่งออก', 'ACTIVE', $5, $5)
      RETURNING id
    `,
    [term.id, FIXTURE_SCHOOL_ID, Number(grade.id), FIXTURE_ROOM_ID, actorId],
  );
  assert(classroom?.id, 'Data export smoke classroom was not created');

  const personUuids = [];
  const studentUuids = [];
  for (let index = 1; index <= 4; index += 1) {
    const personUuid = randomUUID();
    const studentUuid = randomUUID();
    await dataSource.query(
      `
        INSERT INTO student_person (person_uuid, identity_status, created_by, updated_by)
        VALUES ($1::uuid, 'ACTIVE', $2, $2)
      `,
      [personUuid, actorId],
    );
    personUuids.push(personUuid);
    try {
      await dataSource.query(
        `
          INSERT INTO student_term (
            student_uuid, person_uuid, "PersonID_Onec", "FirstName_Onec", "LastName_Onec",
            "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
            "StudentStatusID_Onec", student_status_code,
            "AcademicYear_Onec", "Semester_Onec", created_by, updated_by
          )
          VALUES (
            $1::uuid, $2::uuid, $3, $4, 'Export Smoke', $5, $6, $7,
            10, 10, 2700, 1, $8, $8
          )
        `,
        [
          studentUuid,
          personUuid,
          `99000000010${index}`,
          `Export Student ${index}`,
          FIXTURE_SCHOOL_ID,
          Number(grade.id),
          FIXTURE_ROOM_ID,
          actorId,
        ],
      );
    } catch (error) {
      await dataSource.query(`DELETE FROM student_person WHERE person_uuid = $1::uuid`, [
        personUuid,
      ]);
      throw error;
    }
    studentUuids.push(studentUuid);
  }
  const [resolution] = await dataSource.query(
    `
      SELECT COUNT(*)::int AS active_count
      FROM student_current_enrollment_resolution
      WHERE selected_student_uuid = ANY($1::uuid[])
        AND resolution_state = 'ACTIVE'
    `,
    [studentUuids],
  );
  assert(Number(resolution.active_count) === 4, 'Fixture students must resolve as active');
  return { gradeLabel: grade.label, personUuids };
}

async function runExportJob(baseUrl, cookie, payload) {
  const created = await postJson(baseUrl, '/data-exports/jobs', cookie, payload);
  assert(created.status === 202, `create ${payload.datasetCode} job returned ${created.status}`);
  const jobId = created.body?.data?.id;
  assert(jobId, `create ${payload.datasetCode} job did not return id`);
  assert(
    !JSON.stringify(created.body).includes('artifact_storage_key'),
    'job response leaked storage key',
  );
  const completed = await waitFor(async () => {
    const status = await requestJson(baseUrl, `/data-exports/jobs/${jobId}`, cookie);
    assert(status.status === 200, `job status returned ${status.status}`);
    if (status.body.data.status === 'FAILED') {
      throw new Error(
        status.body.data.failureSummary || `${payload.datasetCode} export job failed`,
      );
    }
    return status.body.data.status === 'COMPLETED' ? status.body.data : null;
  }, `${payload.datasetCode} export job did not complete`);
  const downloaded = await requestText(baseUrl, `/data-exports/jobs/${jobId}/download`, cookie);
  assert(
    downloaded.status === 200,
    `download ${payload.datasetCode} returned ${downloaded.status}`,
  );
  return { completed, csv: downloaded.text, jobId };
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  const dataExportsService = app.get(DataExportsService);
  let fixture;

  try {
    await disableActors(dataSource);
    const exporterId = await upsertActor(dataSource, 'data_export_smoke_exporter', [
      'export-data',
      'students',
      'dashboard',
      'import-data',
      'manage-school-structure',
    ]);
    const deniedId = await upsertActor(dataSource, 'data_export_smoke_denied', ['students']);

    const exporterCookie = createSessionCookie(sessionCookieService, exporterId);
    const allowed = await requestJson(baseUrl, '/data-exports/catalog', exporterCookie);
    assert(allowed.status === 200, `catalog returned ${allowed.status}`);
    assert(allowed.body?.success === true, 'catalog must use success envelope');
    const codes = allowed.body.data.map((item) => item.code);
    assert(codes.includes('student_roster_basic'), 'student basic roster must be listed');
    assert(codes.includes('student_pii'), 'student PII adapter must be listed');
    assert(codes.includes('import_quarantine'), 'import quarantine adapter must be listed');
    assert(
      allowed.body.data.every((item) => item.formats.includes('CSV')),
      'phase-one catalog must be CSV-only',
    );
    for (const item of allowed.body.data.filter(
      (candidate) => candidate.deliveryMode === 'ASYNC_JOB',
    )) {
      const keys = item.filterDefinitions.map((definition) => definition.key);
      assert(new Set(keys).size === keys.length, `${item.code} has duplicate typed filters`);
      assert(
        JSON.stringify(item.supportedFilters) === JSON.stringify(keys),
        `${item.code} supportedFilters drifted from typed definitions`,
      );
    }

    const denied = await requestJson(
      baseUrl,
      '/data-exports/catalog',
      createSessionCookie(sessionCookieService, deniedId),
    );
    assert(denied.status === 403, `actor without export-data must be 403, got ${denied.status}`);

    const serialized = JSON.stringify(allowed.body);
    assert(!serialized.includes('password'), 'catalog must not expose password fields');
    assert(!serialized.includes('PersonID_Onec'), 'catalog must not expose national id fields');
    assert(!serialized.includes('storageKey'), 'catalog must not expose storage keys');

    fixture = await createDataFixture(dataSource, exporterId);
    const roster = await runExportJob(baseUrl, exporterCookie, {
      datasetCode: 'student_roster_basic',
      fieldBundleCode: 'basic',
      filters: {
        schoolId: FIXTURE_SCHOOL_ID,
        grade: fixture.gradeLabel,
        room: String(FIXTURE_ROOM_ID),
      },
    });
    const rosterRows = parseCsv(roster.csv);
    assert(roster.completed.exportedRowCount === 4, 'filtered roster row count must be 4');
    assert(rosterRows.length === 4, 'filtered roster CSV must contain exactly 4 rows');
    assert(
      rosterRows.every(
        (row) =>
          row.school_name === 'โรงเรียนทดสอบส่งออก' &&
          row.grade === fixture.gradeLabel &&
          row.room === String(FIXTURE_ROOM_ID),
      ),
      'filtered roster CSV contains rows outside the requested school/grade/room',
    );
    assert(roster.csv.includes('student_uuid'), 'downloaded CSV missing header');
    assert(!roster.csv.includes('PersonID_Onec'), 'downloaded CSV exposed national id header');
    assert(!roster.csv.includes('PassportNumber_Onec'), 'downloaded CSV exposed passport header');

    const [artifactBeforeReplay] = await dataSource.query(
      `
        SELECT artifact_storage_key, artifact_sha256
        FROM data_export_job
        WHERE id = $1::uuid
      `,
      [roster.jobId],
    );
    await dataExportsService.processJob(roster.jobId);
    const [artifactAfterReplay] = await dataSource.query(
      `
        SELECT artifact_storage_key, artifact_sha256,
               (SELECT COUNT(*)::int FROM data_export_job_event
                WHERE job_id = $1::uuid AND event_code = 'COMPLETED') AS completion_count
        FROM data_export_job
        WHERE id = $1::uuid
      `,
      [roster.jobId],
    );
    const replayDownload = await requestText(
      baseUrl,
      `/data-exports/jobs/${roster.jobId}/download`,
      exporterCookie,
    );
    assert(replayDownload.status === 200, 'replay download must remain available');
    assert(replayDownload.text === roster.csv, 'duplicate worker replay changed artifact bytes');
    assert(
      artifactAfterReplay.artifact_storage_key === artifactBeforeReplay.artifact_storage_key &&
        artifactAfterReplay.artifact_sha256 === artifactBeforeReplay.artifact_sha256,
      'duplicate worker replay created or changed the artifact',
    );
    assert(Number(artifactAfterReplay.completion_count) === 1, 'job must have one COMPLETED event');

    console.log('smoke:data-export ok');
  } finally {
    await cleanupDataFixture(dataSource, fixture?.personUuids ?? []).catch(() => null);
    await disableActors(dataSource).catch(() => null);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
