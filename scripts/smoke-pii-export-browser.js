const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run PII export browser smoke with NODE_ENV=production');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9241);
const REQUESTER_USERNAME = 'pii_export_browser_requester';
const APPROVER_USERNAME = 'pii_export_browser_approver';
const PERSON_UUID = '21000000-0000-4000-8000-000000000001';
const STUDENT_UUID = '21000000-0000-4000-8000-000000000002';
const STUDENT_PERSON_ID = '1234567890123';
const SCHOOL_ID = 10010002;
// Shared smoke fixture grade used by roster/account browser smokes.
const GRADE_LEVEL_ID = 423;
const ROOM_ID = 1;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorMessage(error) {
  if (error instanceof AggregateError) {
    return error.errors.map((cause) => cause?.message || String(cause)).join(' | ');
  }
  return error?.message || String(error);
}

async function waitFor(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(lastError ? `${message}: ${errorMessage(lastError)}` : message);
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function openChrome() {
  assert(fs.existsSync(CHROME_PATH), 'Google Chrome executable was not found');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-pii-export-chrome-'));
  const processRef = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      return response.ok;
    } catch {
      return false;
    }
  }, 'Chrome DevTools endpoint did not start');

  const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((res) => res.json());
  const target = targets.find((item) => item.type === 'page');
  assert(target?.webSocketDebuggerUrl, 'Chrome page target was not available');
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return { client, processRef, userDataDir };
}

async function closeChrome(chrome) {
  if (!chrome) return;
  try {
    chrome.client.close();
  } catch {
    // best-effort cleanup only
  }
  if (chrome.processRef && !chrome.processRef.killed) {
    chrome.processRef.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => chrome.processRef.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }
  if (chrome.userDataDir) {
    fs.rmSync(chrome.userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(detail || 'Browser expression failed');
  }
  return result.result?.value;
}

async function navigate(client, url) {
  await client.call('Page.navigate', { url });
  await waitFor(
    async () => (await evaluate(client, 'document.readyState')) === 'complete',
    `Page did not finish loading: ${url}`,
  );
}

async function bodyText(client) {
  return String(await evaluate(client, 'document.body.innerText'));
}

async function capture(client, outputPath) {
  const result = await client.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
}

async function fillField(client, selector, value) {
  await evaluate(
    client,
    `(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      if (!field) throw new Error('Field not found: ${selector}');
      field.focus();
      field.select();
    })()`,
  );
  await client.call('Input.insertText', { text: value });
}

async function clickByText(client, label, message) {
  await evaluate(
    client,
    `(() => {
      const target = [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim().includes(${JSON.stringify(label)}));
      if (!target) throw new Error(${JSON.stringify(message)});
      target.click();
    })()`,
  );
}

function createSessionCookie(sessionCookieService, userId) {
  let captured = null;
  sessionCookieService.setSession(
    {
      cookie: (name, value, options) => {
        captured = { name, value, options };
      },
    },
    userId,
  );
  assert(captured, 'Session cookie was not created');
  return captured;
}

async function loginInBrowser(client, user, sessionCookie) {
  await navigate(client, `${FRONTEND_URL}/admin-access`);
  await client.call('Network.setCookie', {
    name: sessionCookie.name,
    value: sessionCookie.value,
    url: BACKEND_URL,
    httpOnly: true,
    sameSite: 'Lax',
  });
  await evaluate(
    client,
    `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(user))});
     localStorage.setItem('admin_access', 'true');`,
  );
}

async function clearBrowserSession(client) {
  await evaluate(
    client,
    `(async () => {
      await fetch(${JSON.stringify(`${BACKEND_URL}/api/users/logout`)}, {
        method: 'POST',
        credentials: 'include'
      }).catch(() => null);
      localStorage.removeItem('sts_user');
      localStorage.removeItem('admin_access');
      sessionStorage.removeItem('sts_user');
      sessionStorage.removeItem('admin_access');
    })()`,
  );
}

async function upsertStudentFixture(dataSource) {
  const [school] = await dataSource.query(`SELECT id FROM schools WHERE id = $1`, [SCHOOL_ID]);
  assert(school, `Smoke school ${SCHOOL_ID} is missing`);

  await dataSource.query(
    `
      INSERT INTO student_person (person_uuid, identity_status)
      VALUES ($1::uuid, 'ACTIVE')
      ON CONFLICT (person_uuid) DO UPDATE
      SET identity_status = 'ACTIVE', merged_into = NULL, deleted_at = NULL, deleted_by = NULL
    `,
    [PERSON_UUID],
  );

  await dataSource.query(
    `
      INSERT INTO student_term (
        student_uuid, person_uuid, "PersonID_Onec", "PassportNumber_Onec",
        "FirstName_Onec", "LastName_Onec", "SchoolID_Onec", "GradeLevelID_Onec",
        "RoomID_Onec", "StudentStatusID_Onec", "AcademicYear_Onec", "Semester_Onec",
        "ProvinceNameThai_Onec", "DistrictNameThai_Onec", "SubDistrictNameThai_Onec",
        "PostalCode_Onec", deleted_at, deleted_by
      )
      VALUES (
        $1::uuid, $2::uuid, $3, 'AA123456', 'Smoke', 'PII Export Browser', $4, $5,
        $6, 10, 2569, 1, 'กรุงเทพมหานคร', 'ดอนเมือง', 'สีกัน', '10210', NULL, NULL
      )
      ON CONFLICT (student_uuid) DO UPDATE
      SET person_uuid = EXCLUDED.person_uuid,
          "PersonID_Onec" = EXCLUDED."PersonID_Onec",
          "PassportNumber_Onec" = EXCLUDED."PassportNumber_Onec",
          "FirstName_Onec" = EXCLUDED."FirstName_Onec",
          "LastName_Onec" = EXCLUDED."LastName_Onec",
          "SchoolID_Onec" = EXCLUDED."SchoolID_Onec",
          "GradeLevelID_Onec" = EXCLUDED."GradeLevelID_Onec",
          "RoomID_Onec" = EXCLUDED."RoomID_Onec",
          "StudentStatusID_Onec" = 10,
          "AcademicYear_Onec" = EXCLUDED."AcademicYear_Onec",
          "Semester_Onec" = EXCLUDED."Semester_Onec",
          "ProvinceNameThai_Onec" = EXCLUDED."ProvinceNameThai_Onec",
          "DistrictNameThai_Onec" = EXCLUDED."DistrictNameThai_Onec",
          "SubDistrictNameThai_Onec" = EXCLUDED."SubDistrictNameThai_Onec",
          "PostalCode_Onec" = EXCLUDED."PostalCode_Onec",
          deleted_at = NULL,
          deleted_by = NULL
    `,
    [STUDENT_UUID, PERSON_UUID, STUDENT_PERSON_ID, SCHOOL_ID, GRADE_LEVEL_ID, ROOM_ID],
  );
}

async function upsertActor(dataSource, passwordHash, username, firstName, dataScope) {
  const permissions = ['home', 'students'];
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = $3,
            "LastName" = 'PII Export Browser',
            status = 'ACTIVE',
            permissions = $4::jsonb,
            role = 'ADMIN',
            data_scope = $5::jsonb,
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            affiliation = 'Automated PII export browser smoke',
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
        WHERE id = $1
      `,
      [existing.id, passwordHash, firstName, JSON.stringify(permissions), JSON.stringify(dataScope)],
    );
    return existing.id;
  }

  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code, email, phone
      )
      VALUES (
        $1, $2, $3, 'PII Export Browser', 'ACTIVE', $4::jsonb, 'ADMIN',
        $5::jsonb, FALSE, 'Automated PII export browser smoke', 'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [username, passwordHash, firstName, JSON.stringify(permissions), JSON.stringify(dataScope)],
  );
  return row.id;
}

async function disableActors(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated PII export browser smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [[REQUESTER_USERNAME, APPROVER_USERNAME]],
  );
}

async function cancelSmokeRequests(dataSource, requestIds) {
  if (requestIds.length === 0) {
    return;
  }
  await dataSource.query(
    `
      UPDATE pii_export_requests
      SET status = 'CANCELLED',
          download_token_hash = NULL,
          download_expires_at = NULL,
          updated_at = NOW()
      WHERE id = ANY($1::uuid[])
    `,
    [requestIds],
  );
}

async function latestRequest(dataSource, requesterId) {
  const [row] = await dataSource.query(
    `
      SELECT id, status, scope_snapshot
      FROM pii_export_requests
      WHERE requester_user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [requesterId],
  );
  return row || null;
}

async function eventCount(dataSource, requestId, action) {
  const [row] = await dataSource.query(
    `
      SELECT COUNT(*)::int AS count
      FROM pii_export_events
      WHERE request_id = $1::uuid
        AND action = $2
    `,
    [requestId, action],
  );
  return Number(row?.count ?? 0);
}

function includesStringish(values, expected) {
  return Array.isArray(values) && values.map(String).includes(String(expected));
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  const sessionCookieService = app.get(SessionCookieService);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = `PiiExportBrowser-${suffix}-Password`;
  const requestIds = [];
  let chrome;

  try {
    await upsertStudentFixture(dataSource);
    await disableActors(dataSource);
    const requesterId = await upsertActor(
      dataSource,
      await passwordService.hash(password),
      REQUESTER_USERNAME,
      'Requester',
      {
        school_ids: [SCHOOL_ID],
        grade_levels: [GRADE_LEVEL_ID],
        room_ids: [String(ROOM_ID)],
      },
    );
    const approverId = await upsertActor(
      dataSource,
      await passwordService.hash(password),
      APPROVER_USERNAME,
      'Approver',
      { global: true },
    );

    const requesterUser = {
      id: requesterId,
      username: REQUESTER_USERNAME,
      FirstName: 'Requester',
      LastName: 'PII Export Browser',
      roles: ['ADMIN'],
      permissions: ['home', 'students'],
      data_scope: {
        school_ids: [SCHOOL_ID],
        grade_levels: [GRADE_LEVEL_ID],
        room_ids: [String(ROOM_ID)],
      },
      must_change_password: false,
    };
    const approverUser = {
      id: approverId,
      username: APPROVER_USERNAME,
      FirstName: 'Approver',
      LastName: 'PII Export Browser',
      roles: ['ADMIN'],
      permissions: ['home', 'students'],
      data_scope: { global: true },
      must_change_password: false,
    };

    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await loginInBrowser(client, requesterUser, createSessionCookie(sessionCookieService, requesterId));
    await navigate(client, `${FRONTEND_URL}/students`);
    await waitFor(
      async () =>
        (await bodyText(client)).includes('ส่งออกข้อมูลส่วนบุคคล') &&
        (await bodyText(client)).includes('ส่งคำขอ'),
      'PII export panel did not render for requester',
    );
    await fillField(client, '#pii-export-note', 'Browser smoke request for export verification');
    await clickByText(client, 'ส่งคำขอ', 'Create export request button was not found');
    try {
      await waitFor(
        async () => (await bodyText(client)).includes('ส่งคำขอแล้ว'),
        'Requester did not see create success',
      );
    } catch (error) {
      throw new Error(`${errorMessage(error)}\nBody:\n${await bodyText(client)}`);
    }
    const request = await latestRequest(dataSource, requesterId);
    assert(request?.id, 'Created PII export request was not found in database');
    requestIds.push(request.id);
    assert(request.status === 'PENDING', `Created request status was ${request.status}`);
    assert(
      includesStringish(request.scope_snapshot?.grade_levels, GRADE_LEVEL_ID),
      'Created request scope did not include the selected grade level',
    );
    assert(
      includesStringish(request.scope_snapshot?.room_ids, ROOM_ID),
      'Created request scope did not include the selected room',
    );
    assert((await eventCount(dataSource, request.id, 'REQUEST')) === 1, 'REQUEST event was not created');
    assert(
      !(await bodyText(client)).includes(STUDENT_PERSON_ID),
      'Requester UI leaked the full national id',
    );
    await capture(client, '/tmp/sts-pii-export-requester-desktop.png');

    await clearBrowserSession(client);
    await loginInBrowser(client, approverUser, createSessionCookie(sessionCookieService, approverId));
    await navigate(client, `${FRONTEND_URL}/students`);
    await waitFor(
      async () =>
        (await bodyText(client)).includes('ส่งออกข้อมูลส่วนบุคคล') &&
        (await bodyText(client)).includes('อนุมัติ'),
      'Approver did not see the pending export request',
    );
    await clickByText(client, 'อนุมัติ', 'Approve export request button was not found');
    await waitFor(
      async () =>
        (await bodyText(client)).includes('ลิงก์ดาวน์โหลดแสดงครั้งเดียว') &&
        (await bodyText(client)).includes('ดาวน์โหลด CSV'),
      'Download token banner did not render after approval',
    );
    assert((await eventCount(dataSource, request.id, 'APPROVE')) === 1, 'APPROVE event was not created');
    await clickByText(client, 'ดาวน์โหลด CSV', 'Download CSV button was not found');
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT status, downloaded_at FROM pii_export_requests WHERE id = $1::uuid`,
        [request.id],
      );
      return row?.status === 'DOWNLOADED' && Boolean(row.downloaded_at);
    }, 'Download did not mark the export request as downloaded');
    assert((await eventCount(dataSource, request.id, 'DOWNLOAD')) === 1, 'DOWNLOAD event was not created');
    await capture(client, '/tmp/sts-pii-export-approver-desktop.png');

    await clearBrowserSession(client);
    await loginInBrowser(client, requesterUser, createSessionCookie(sessionCookieService, requesterId));
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/students`);
    await waitFor(
      async () =>
        (await bodyText(client)).includes('ส่งออกข้อมูลส่วนบุคคล') &&
        (await bodyText(client)).includes('ดาวน์โหลดแล้ว'),
      'Mobile PII export panel did not render downloaded request',
    );
    await capture(client, '/tmp/sts-pii-export-mobile.png');

    console.log(
      'PII export browser smoke passed (request UI, approve token, CSV download, audit events, desktop/mobile)',
    );
  } finally {
    await closeChrome(chrome);
    try {
      await cancelSmokeRequests(dataSource, requestIds.filter(Boolean));
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
  console.error(errorMessage(error));
  process.exitCode = 1;
});
