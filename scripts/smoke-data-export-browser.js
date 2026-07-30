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
  throw new Error('Refusing to run data export browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9251);
const USERNAME = 'data_export_browser_smoke_admin';

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-data-export-chrome-'));
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
    fs.rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

async function loadClassroomContext(sessionCookie) {
  const headers = {
    Cookie: `${sessionCookie.name}=${sessionCookie.value}`,
  };
  const readData = async (path) => {
    const response = await fetch(`${BACKEND_URL}/api${path}`, { headers });
    assert(response.ok, `Lookup API failed: ${path} (${response.status})`);
    const payload = await response.json();
    return payload?.data ?? payload;
  };

  const [schools, grades] = await Promise.all([
    readData('/attendance/schools?limit=50'),
    readData('/attendance/grade-levels'),
  ]);
  for (const school of schools) {
    for (const grade of grades) {
      const rooms = await readData(
        `/attendance/rooms?schoolId=${encodeURIComponent(school.id)}&grade=${encodeURIComponent(grade.label)}`,
      );
      if (rooms.length > 0) {
        return {
          schoolId: String(school.id),
          grade: grade.label,
          room: rooms[0],
        };
      }
    }
  }
  throw new Error('Smoke fixture has no selectable school, grade, and room combination');
}

async function loginInBrowser(client, user, sessionCookie) {
  await navigate(client, `${FRONTEND_URL}/login`);
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

async function upsertActor(dataSource, passwordHash) {
  const permissions = [
    'home',
    'dashboard',
    'students',
    'attendance-dashboard',
    'review-cases',
    'import-data',
    'export-data',
    'manage-school-structure',
    'manage-student-observations',
  ];
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [USERNAME]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'Data Export',
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
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
        WHERE id = $1
      `,
      [existing.id, passwordHash, JSON.stringify(permissions)],
    );
    return Number(existing.id);
  }

  const [created] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, data_origin_code, email, phone
      )
      VALUES (
        $1, $2, 'Data Export', 'Browser Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [USERNAME, passwordHash, JSON.stringify(permissions)],
  );
  return Number(created.id);
}

async function disableActor(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated data export browser smoke fixture')
      WHERE username = $1
        AND data_origin_code = 'AUTOMATED_TEST'
    `,
    [USERNAME],
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  const sessionCookieService = app.get(SessionCookieService);
  const passwordHash = await passwordService.hash(
    `DataExportBrowser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  let chrome;

  try {
    await disableActor(dataSource);
    const userId = await upsertActor(dataSource, passwordHash);
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

    const sessionCookie = createSessionCookie(sessionCookieService, userId);
    const classroomContext = await loadClassroomContext(sessionCookie);
    await loginInBrowser(
      client,
      {
        id: userId,
        username: USERNAME,
        FirstName: 'Data Export',
        LastName: 'Browser Smoke',
        roles: ['ADMIN'],
        permissions: [
          'home',
          'dashboard',
          'students',
          'attendance-dashboard',
          'review-cases',
          'import-data',
          'export-data',
          'manage-school-structure',
          'manage-student-observations',
        ],
        data_scope: { global: true },
        must_change_password: false,
      },
      sessionCookie,
    );

    await navigate(client, `${FRONTEND_URL}/cases`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Array.from(document.querySelectorAll('button')).some((button) => button.textContent.includes('ส่งออกตามตัวกรองนี้'))`,
          ),
        ),
      'Cases export action did not render',
    );
    await evaluate(
      client,
      `Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent.includes('ส่งออกตามตัวกรองนี้'))?.click()`,
    );
    await waitFor(
      async () => {
        const url = new URL(await evaluate(client, 'window.location.href'));
        return url.pathname === '/data-exports' && url.searchParams.get('dataset') === 'case_summary';
      },
      'Cases export action did not preserve its export context',
    );

    await navigate(client, `${FRONTEND_URL}/data-exports`);
    const initialCatalog = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/data-exports/catalog`)}, {
          credentials: 'include'
        });
        const text = await response.text();
        return { status: response.status, text: text.slice(0, 300) };
      })()`,
    );
    try {
      await waitFor(async () => {
        const text = await bodyText(client);
        return (
          text.includes('ส่งออกข้อมูล') &&
          text.includes('รายชื่อนักเรียนพื้นฐาน') &&
          text.includes('สร้างงานส่งออก')
        );
      }, 'Data export center did not render');
    } catch (error) {
      const href = await evaluate(client, 'window.location.href');
      const text = (await bodyText(client)).slice(0, 500);
      throw new Error(
        `${errorMessage(error)}; url=${href}; catalog=${JSON.stringify(initialCatalog)}; body=${text}`,
      );
    }

    const text = await bodyText(client);
    assert(text.includes('รายชื่อนักเรียนพื้นฐาน'), 'Student roster export card was missing');
    assert(text.includes('สร้างงานส่งออก'), 'Queued export action was missing');

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await capture(client, '/tmp/sts-data-export-mobile.png');
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const catalogStatus = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/data-exports/catalog`)}, {
          credentials: 'include'
        });
        const payload = await response.json();
        return { status: response.status, count: Array.isArray(payload.data) ? payload.data.length : 0 };
      })()`,
    );
    assert(catalogStatus.status === 200, `Catalog API returned ${catalogStatus.status}`);
    assert(catalogStatus.count >= 1, 'Catalog API returned no export items');

    const contextStartedAt = new Date();
    const contextUrl = new URL(`${FRONTEND_URL}/data-exports`);
    contextUrl.searchParams.set('dataset', 'student_roster_basic');
    contextUrl.searchParams.set('schoolId', classroomContext.schoolId);
    contextUrl.searchParams.set('grade', classroomContext.grade);
    contextUrl.searchParams.set('room', classroomContext.room);
    await navigate(client, contextUrl.toString());
    try {
      await waitFor(async () => {
        const values = await evaluate(
          client,
          `({
            text: document.body.innerText,
            schoolId: document.querySelector('#export-student_roster_basic-schoolId')?.value,
            grade: document.querySelector('#export-student_roster_basic-grade')?.value,
            room: document.querySelector('#export-student_roster_basic-room')?.value
          })`,
        );
        return (
          values.text.includes('นำตัวกรองจากหน้าต้นทางมาแล้ว') &&
          // Combobox renders the selected label, not its persisted option value.
          // The completed job assertion below remains the source of truth for IDs.
          Boolean(values.schoolId) &&
          values.grade === classroomContext.grade &&
          values.room === `ห้อง ${classroomContext.room}`
        );
      }, 'Typed source context did not populate the export form');
    } catch (error) {
      const values = await evaluate(
        client,
        `({
          schoolId: document.querySelector('#export-student_roster_basic-schoolId')?.value,
          grade: document.querySelector('#export-student_roster_basic-grade')?.value,
          room: document.querySelector('#export-student_roster_basic-room')?.value
        })`,
      );
      throw new Error(`${errorMessage(error)}; values=${JSON.stringify(values)}`);
    }

    const clicked = await evaluate(
      client,
      `(() => {
        const input = document.querySelector('#export-student_roster_basic-schoolId');
        const card = input?.closest('[data-export-dataset-code="student_roster_basic"]');
        const button = [...(card?.querySelectorAll('button') || [])]
          .find((candidate) => candidate.textContent?.includes('สร้างงานส่งออก'));
        if (!button) return false;
        button.click();
        return true;
      })()`,
    );
    assert(clicked === true, 'Could not submit the source-context export card');

    let submittedJob;
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `
          SELECT id, status, filter_snapshot, exported_row_count
          FROM data_export_job
          WHERE requested_by = $1
            AND created_at >= $2::timestamptz
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [userId, contextStartedAt.toISOString()],
      );
      if (!row) return false;
      if (row.status === 'FAILED') throw new Error('Source-context export job failed');
      submittedJob = row;
      return row.status === 'COMPLETED';
    }, 'Source-context export job did not complete');
    assert(
      String(submittedJob.filter_snapshot.schoolId) === classroomContext.schoolId &&
        submittedJob.filter_snapshot.grade === classroomContext.grade &&
        submittedJob.filter_snapshot.room === classroomContext.room,
      'Submitted export job did not preserve typed source-context filters',
    );

    console.log('smoke:data-export-browser ok');
  } finally {
    await closeChrome(chrome);
    await disableActor(dataSource).catch(() => null);
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
