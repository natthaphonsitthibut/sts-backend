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
  throw new Error('Refusing to run field-monitor map browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5173';
const BROWSER_BACKEND_URL = process.env.SMOKE_BROWSER_BACKEND_URL || BACKEND_URL;
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9246);
const REVIEWER_USERNAME = 'field_monitor_map_browser_reviewer';
const NO_PERMISSION_USERNAME = 'field_monitor_map_browser_no_permission';
const FIXTURE_MARKER = 'FIELD_MONITOR_MAP_SMOKE_FIXTURE';
const FIXTURE_LAT = 18.796143;
const FIXTURE_LNG = 98.979263;

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-field-monitor-map-chrome-'));
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
  chrome?.client.close();
  if (chrome?.processRef) {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2_000);
      chrome.processRef.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      chrome.processRef.kill('SIGTERM');
    });
  }
  if (chrome?.userDataDir) {
    try {
      fs.rmSync(chrome.userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch {
      // Temp Chrome profile cleanup must not hide the smoke result.
    }
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

async function fillInput(client, selector, value) {
  await waitFor(
    async () =>
      Boolean(await evaluate(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)),
    `Input did not appear: ${selector}`,
    5_000,
  );
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) throw new Error('Input not found: ${selector}');
      input.focus();
      input.select();
    })()`,
  );
  await client.call('Input.insertText', { text: value });
}

async function click(client, expression, message) {
  await waitFor(
    async () => Boolean(await evaluate(client, `Boolean(${expression})`)),
    message,
    5_000,
  );
  await evaluate(
    client,
    `(() => {
      const target = ${expression};
      if (!target) throw new Error(${JSON.stringify(message)});
      target.click();
    })()`,
  );
}

async function capture(client, outputPath) {
  const result = await client.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
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
  await navigate(client, `${FRONTEND_URL}/login`);
  await client.call('Network.setCookie', {
    name: sessionCookie.name,
    value: sessionCookie.value,
    url: BROWSER_BACKEND_URL,
    httpOnly: true,
    sameSite: 'Lax',
  });
  await evaluate(
    client,
    `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(user))});
     localStorage.setItem('admin_access', 'true');`,
  );
}

async function logoutInBrowser(client) {
  await evaluate(
    client,
    `(async () => {
      await fetch(${JSON.stringify(`${BROWSER_BACKEND_URL}/api/users/logout`)}, {
        method: 'POST',
        credentials: 'include'
      }).catch(() => null);
      localStorage.removeItem('sts_user');
      localStorage.removeItem('admin_access');
      sessionStorage.removeItem('sts_user');
      sessionStorage.removeItem('admin_access');
    })()`,
  );
  await navigate(client, `${FRONTEND_URL}/login`);
  await waitFor(
    async () => String(await evaluate(client, 'location.pathname')).startsWith('/login'),
    'Logout did not return to login',
  );
}

async function pickFixtureStudent(dataSource) {
  const [row] = await dataSource.query(`
    SELECT s.student_uuid,
           (s."FirstName_Onec" || ' ' || s."LastName_Onec") AS full_name,
           s."SchoolID_Onec" AS school_id
    FROM student_term s
    JOIN student_current_enrollment_resolution e
      ON e.person_uuid = s.person_uuid
     AND e.selected_student_uuid = s.student_uuid
     AND e.resolution_state = 'ACTIVE'
    WHERE s."SchoolID_Onec" IS NOT NULL
    ORDER BY s.student_uuid
    LIMIT 1
  `);
  assert(row, 'No currently-enrolled student with a school was found to use as a map fixture');
  return row;
}

async function cleanup(dataSource) {
  await dataSource.query(`DELETE FROM cases WHERE reason_flagged = $1`, [FIXTURE_MARKER]);
}

async function disableActors(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated field-monitor map browser smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [[REVIEWER_USERNAME, NO_PERMISSION_USERNAME]],
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
            "FirstName" = 'Field Monitor Map',
            "LastName" = 'Browser Smoke',
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
            affiliation = 'Automated field-monitor map browser smoke',
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
        $1, $2, 'Field Monitor Map', 'Browser Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'Automated field-monitor map browser smoke',
        'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [username, passwordHash, JSON.stringify(permissions)],
  );
  return row;
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
  const password = `FieldMonitorMapBrowser-${suffix}-Password`;
  let chrome;

  try {
    await cleanup(dataSource);
    const fixtureStudent = await pickFixtureStudent(dataSource);
    const [fixtureCase] = await dataSource.query(
      `
        INSERT INTO cases (student_uuid, student_name, school_id, status, reason_flagged, student_lat, student_lng, created_at)
        VALUES ($1, $2, $3, 'OPEN', $4, $5, $6, now())
        RETURNING id
      `,
      [
        fixtureStudent.student_uuid,
        fixtureStudent.full_name,
        fixtureStudent.school_id,
        FIXTURE_MARKER,
        FIXTURE_LAT,
        FIXTURE_LNG,
      ],
    );
    assert(fixtureCase, 'Fixture case row was not inserted');

    const reviewerActor = await upsertActor(
      dataSource,
      await passwordService.hash(password),
      REVIEWER_USERNAME,
      ['home', 'students', 'field-monitor'],
    );
    const noPermissionActor = await upsertActor(
      dataSource,
      await passwordService.hash(password),
      NO_PERMISSION_USERNAME,
      ['home', 'students'],
    );
    const reviewerUser = {
      id: reviewerActor.id,
      username: REVIEWER_USERNAME,
      FirstName: 'Field Monitor Map',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home', 'students', 'field-monitor'],
      data_scope: { global: true },
      must_change_password: false,
    };
    const noPermissionUser = {
      id: noPermissionActor.id,
      username: NO_PERMISSION_USERNAME,
      FirstName: 'Field Monitor Map',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home', 'students'],
      data_scope: { global: true },
      must_change_password: false,
    };
    const reviewerSession = createSessionCookie(sessionCookieService, reviewerActor.id);
    const noPermissionSession = createSessionCookie(sessionCookieService, noPermissionActor.id);

    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // 1. Permission gate — no field-monitor permission is forbidden.
    await loginInBrowser(client, noPermissionUser, noPermissionSession);
    await navigate(client, `${FRONTEND_URL}/field-monitor-map`);
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === '/forbidden' &&
        String(await evaluate(client, 'document.body.innerText')).includes('ไม่มีสิทธิ์เข้าถึง'),
      'No-permission user was not blocked from the field-monitor map',
    );
    await logoutInBrowser(client);

    // 2. Empty state on open — no pins until a child is explicitly picked.
    await loginInBrowser(client, reviewerUser, reviewerSession);
    await navigate(client, `${FRONTEND_URL}/field-monitor-map`);
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === '/field-monitor-map' &&
        String(await evaluate(client, 'document.body.innerText')).includes(
          'เลือกเด็กเสี่ยงจากรายการเพื่อดูตำแหน่งบ้านบนแผนที่',
        ),
      'Field-monitor map did not render its empty state',
    );

    // 3. Pick the fixture student from the in-page picker.
    const [firstName] = fixtureStudent.full_name.split(' ');
    await fillInput(client, 'input[placeholder="พิมพ์ชื่อนักเรียนเพื่อค้นหา"]', firstName);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          fixtureStudent.full_name,
        ),
      'Fixture student did not appear in the risk-child picker',
    );
    await click(
      client,
      `document.querySelector(${JSON.stringify(`[aria-label="เลือก ${fixtureStudent.full_name}"]`)})`,
      'Fixture student checkbox was not found',
    );

    // 4. Pin renders (real Google Maps key is configured) with no
    // "missing coordinates" warning, and the URL carries the selection.
    await waitFor(
      async () =>
        !String(await evaluate(client, 'document.body.innerText')).includes(
          'ยังไม่มีพิกัดบ้านในระบบ',
        ) && Boolean(await evaluate(client, `Boolean(document.querySelector('[data-sts-map-surface]'))`)),
      'Map surface with a resolved pin did not render',
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'location.search')).includes(fixtureStudent.student_uuid),
      'Selection was not reflected in the URL query string',
    );
    await capture(client, '/tmp/sts-field-monitor-map-desktop.png');

    // 5. Audit trail — FIELD_MAP_VIEW recorded with count + refs only.
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `
          SELECT metadata FROM audit_log
          WHERE action = 'FIELD_MAP_VIEW'
            AND actor_user_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [reviewerActor.id],
      );
      return Boolean(row?.metadata?.studentUuidRefs?.includes(fixtureStudent.student_uuid));
    }, 'FIELD_MAP_VIEW audit entry with the student ref was not recorded');

    // 6. Remove the child — pin and URL clear back to empty state.
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'เอาออก')`,
      'Remove-selection button was not found',
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'เลือกเด็กเสี่ยงจากรายการเพื่อดูตำแหน่งบ้านบนแผนที่',
        ) && String(await evaluate(client, 'location.search')) === '',
      'Removing the selection did not clear the map back to empty',
    );

    // 7. Entry point (b): student list cross-page multi-select → "ดูบนแผนที่".
    await navigate(client, `${FRONTEND_URL}/students`);
    await fillInput(client, 'input[placeholder="ค้นหาชื่อนักเรียน..."]', firstName);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          fixtureStudent.full_name,
        ),
      'Fixture student did not appear in the student list',
    );
    await click(
      client,
      `document.querySelector(${JSON.stringify(`[aria-label="เลือก ${fixtureStudent.full_name}"]`)})`,
      'Student list row checkbox was not found',
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim().startsWith('ดูบนแผนที่'))`,
      '"ดูบนแผนที่" button was not found on the student list',
    );
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === '/field-monitor-map' &&
        String(await evaluate(client, 'location.search')).includes(fixtureStudent.student_uuid),
      'The student-list entry point did not deep-link into the map with the selection',
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          fixtureStudent.full_name,
        ),
      'The deep-linked selection did not resolve to the real student name',
    );

    console.log(
      'field-monitor map browser smoke passed (permission gate, empty state, in-page picker, pin render, audit, remove, list deep-link)',
    );
  } finally {
    await closeChrome(chrome);
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
  console.error(errorMessage(error));
  process.exitCode = 1;
});
