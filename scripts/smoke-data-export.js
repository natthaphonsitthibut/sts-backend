const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run data export smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

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

async function upsertActor(dataSource, username, permissions) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
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

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);

  try {
    await disableActors(dataSource);
    const exporterId = await upsertActor(dataSource, 'data_export_smoke_exporter', [
      'export-data',
      'students',
      'dashboard',
      'attendance-dashboard',
      'review-cases',
      'import-data',
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

    const created = await postJson(baseUrl, '/data-exports/jobs', exporterCookie, {
      datasetCode: 'student_roster_basic',
      fieldBundleCode: 'basic',
      filters: {},
    });
    assert(created.status === 202, `create job returned ${created.status}`);
    const jobId = created.body?.data?.id;
    assert(jobId, 'create job did not return id');
    assert(!JSON.stringify(created.body).includes('artifact_storage_key'), 'job response leaked storage key');

    const completed = await waitFor(async () => {
      const status = await requestJson(baseUrl, `/data-exports/jobs/${jobId}`, exporterCookie);
      assert(status.status === 200, `job status returned ${status.status}`);
      if (status.body.data.status === 'FAILED') {
        throw new Error(status.body.data.failureSummary || 'data export job failed');
      }
      return status.body.data.status === 'COMPLETED' ? status.body.data : null;
    }, 'data export job did not complete');
    assert(completed.exportedRowCount >= 0, 'completed job must include row count');

    const downloaded = await requestText(
      baseUrl,
      `/data-exports/jobs/${jobId}/download`,
      exporterCookie,
    );
    assert(downloaded.status === 200, `download returned ${downloaded.status}`);
    assert(downloaded.text.includes('student_uuid'), 'downloaded CSV missing header');
    assert(!downloaded.text.includes('PersonID_Onec'), 'downloaded CSV exposed national id header');
    assert(!downloaded.text.includes('PassportNumber_Onec'), 'downloaded CSV exposed passport header');

    console.log('smoke:data-export ok');
  } finally {
    await disableActors(dataSource).catch(() => null);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
