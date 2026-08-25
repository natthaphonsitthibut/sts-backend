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
  throw new Error('Refusing to run presentation-data browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9264);
const USERNAME_PREFIX = 'presentation_browser_probe';
const ALLOWED_USERNAME = `${USERNAME_PREFIX}_allowed`;
const DENIED_USERNAME = `${USERNAME_PREFIX}_denied`;
const PRESENTATION_DOMAIN = 'school.sts.local';
const FORBIDDEN_PATTERN =
  /(sts-demo\.ac\.th|\bdemo\b|\bsmoke\b|\btest\b|\bsample\b|\bfake\b|ข้อมูลสาธิต|ข้อมูลทดสอบ)/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorMessage(error) {
  if (error instanceof AggregateError) {
    return error.errors.map((cause) => cause?.message || String(cause)).join(' | ');
  }
  return error?.message || String(error);
}

async function waitFor(check, message, timeoutMs = 25_000) {
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-presentation-chrome-'));
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
      return (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).ok;
    } catch {
      return false;
    }
  }, 'Chrome DevTools endpoint did not start');

  const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((response) =>
    response.json(),
  );
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
    // Best-effort cleanup only.
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

async function upsertActor(dataSource, passwordHash, actor) {
  const [existing] = await dataSource.query('SELECT id FROM users WHERE username = $1', [
    actor.username,
  ]);
  if (existing) {
    await dataSource.query(
      `UPDATE users
       SET password = $2,
           "FirstName" = $3,
           "LastName" = $4,
           status = 'ACTIVE',
           permissions = $5::jsonb,
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
       WHERE id = $1`,
      [
        existing.id,
        passwordHash,
        actor.firstName,
        actor.lastName,
        JSON.stringify(actor.permissions),
      ],
    );
    return Number(existing.id);
  }

  const [created] = await dataSource.query(
    `INSERT INTO users (
       username, password, "FirstName", "LastName", status, permissions, role,
       data_scope, must_change_password, data_origin_code, email, phone
     )
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5::jsonb, 'ADMIN',
             '{"global":true}'::jsonb, FALSE, 'AUTOMATED_TEST', NULL, NULL)
     RETURNING id`,
    [
      actor.username,
      passwordHash,
      actor.firstName,
      actor.lastName,
      JSON.stringify(actor.permissions),
    ],
  );
  return Number(created.id);
}

async function disableActors(dataSource) {
  await dataSource.query(
    `UPDATE users
     SET status = 'DISABLED',
         deactivated_at = COALESCE(deactivated_at, now()),
         deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
         deactivation_note = COALESCE(
           deactivation_note,
           'Retained automated presentation browser fixture'
         )
     WHERE username LIKE $1
       AND data_origin_code = 'AUTOMATED_TEST'`,
    [`${USERNAME_PREFIX}%`],
  );
}

function userShape(id, actor) {
  return {
    id,
    username: actor.username,
    FirstName: actor.firstName,
    LastName: actor.lastName,
    roles: ['ADMIN'],
    permissions: actor.permissions,
    data_scope: { global: true },
    must_change_password: false,
  };
}

async function apiStatus(sessionCookie, pathName) {
  return (
    await fetch(`${BACKEND_URL}${pathName}`, {
      headers: { cookie: `${sessionCookie.name}=${sessionCookie.value}` },
    })
  ).status;
}

async function assertPage(client, url, expectedText, label) {
  await navigate(client, url);
  await waitFor(
    async () => (await bodyText(client)).includes(expectedText),
    `${label} did not render`,
  );
  const text = await bodyText(client);
  assert(!FORBIDDEN_PATTERN.test(text), `${label} exposed a forbidden presentation marker`);
  return text;
}

async function assertNoRootOverflow(client, label) {
  const dimensions = await evaluate(
    client,
    `({ viewport: innerWidth, document: document.documentElement.scrollWidth })`,
  );
  assert(
    dimensions.document <= dimensions.viewport + 1,
    `${label} overflowed the mobile viewport: ${JSON.stringify(dimensions)}`,
  );
}

async function searchForStudent(client, fullName) {
  await waitFor(
    async () =>
      await evaluate(
        client,
        `Boolean(document.querySelector('input[placeholder^="ค้นหา"]'))`,
      ),
    'Student search input was not available',
  );
  const updated = await evaluate(
    client,
    `(() => {
      const input = document.querySelector('input[placeholder^="ค้นหา"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(fullName)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  assert(updated, 'Student search input was not available');
  await waitFor(
    async () => (await bodyText(client)).includes(fullName),
    'Replacement student did not render',
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
    `PresentationBrowser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const allowedActor = {
    username: ALLOWED_USERNAME,
    firstName: 'ณัฐกานต์',
    lastName: 'ตรวจข้อมูล',
    permissions: ['home', 'teachers', 'manage-users-list', 'students'],
  };
  const deniedActor = {
    username: DENIED_USERNAME,
    firstName: 'ปาริชาติ',
    lastName: 'จำกัดสิทธิ์',
    permissions: ['home'],
  };
  let chrome;

  try {
    await disableActors(dataSource);
    const allowedId = await upsertActor(dataSource, passwordHash, allowedActor);
    const deniedId = await upsertActor(dataSource, passwordHash, deniedActor);
    const allowedCookie = createSessionCookie(sessionCookieService, allowedId);
    const deniedCookie = createSessionCookie(sessionCookieService, deniedId);
    const [targetSchool] = await dataSource.query(
      `SELECT membership.school_id
       FROM school_teacher_memberships membership
       JOIN teachers teacher ON teacher.id = membership.teacher_id
       WHERE membership.deleted_at IS NULL
         AND membership.membership_status = 'ACTIVE'
         AND membership.ended_on IS NULL
         AND lower(split_part(teacher.email, '@', 2)) = $1
       ORDER BY membership.school_id
       LIMIT 1`,
      [PRESENTATION_DOMAIN],
    );
    assert(targetSchool?.school_id, 'No school contains a canonical presentation teacher');

    const allowedChecks = [
      `/api/teachers?schoolId=${targetSchool.school_id}&page=1&limit=20`,
      '/api/users?excludeRole=TEACHER%2CSTUDENT&page=1&limit=20',
      '/api/students?page=1&limit=20',
    ];
    for (const endpoint of allowedChecks) {
      assert((await apiStatus(allowedCookie, endpoint)) === 200, `Allowed API failed: ${endpoint}`);
      assert(
        (await apiStatus(deniedCookie, endpoint)) === 403,
        `Denied API was not refused: ${endpoint}`,
      );
    }

    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await client.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          const backendUrl = ${JSON.stringify(BACKEND_URL)};
          const rewrite = (url) => {
            if (typeof url !== 'string') return url;
            const parsed = new URL(url, window.location.origin);
            if (!parsed.pathname.startsWith('/api/')) return url;
            if (
              parsed.pathname === '/api/teachers' &&
              sessionStorage.getItem('presentation-fail-teachers') === 'true'
            ) {
              return 'http://127.0.0.1:9' + parsed.pathname + parsed.search;
            }
            return backendUrl + parsed.pathname + parsed.search;
          };
          const originalOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            return originalOpen.call(this, method, rewrite(url), ...rest);
          };
        })();
      `,
    });
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await loginInBrowser(client, userShape(allowedId, allowedActor), allowedCookie);

    await assertPage(client, FRONTEND_URL, 'นักเรียนทั้งหมด', 'home dashboard');

    const teacherUrl = `${FRONTEND_URL}/teachers?schoolId=${targetSchool.school_id}`;
    await assertPage(client, teacherUrl, 'จัดการข้อมูลครู', 'teacher list');
    await waitFor(
      async () => (await bodyText(client)).includes(`@${PRESENTATION_DOMAIN}`),
      'Canonical teacher email did not render',
    );
    assert(
      !FORBIDDEN_PATTERN.test(await bodyText(client)),
      'Teacher list exposed a forbidden marker',
    );

    await assertPage(client, `${FRONTEND_URL}/manage-users`, 'จัดการผู้ใช้งาน', 'user list');
    await waitFor(
      async () => await evaluate(client, "Boolean(document.querySelector('tbody tr'))"),
      'User table did not render',
    );
    assert(!FORBIDDEN_PATTERN.test(await bodyText(client)), 'User list exposed a forbidden marker');

    await assertPage(client, `${FRONTEND_URL}/students`, 'รายชื่อนักเรียน', 'student list');
    await searchForStudent(client, 'ภาณุพงศ์ อินทร์ประเสริฐ');
    assert(
      !FORBIDDEN_PATTERN.test(await bodyText(client)),
      'Student list exposed a forbidden marker',
    );

    await evaluate(
      client,
      "sessionStorage.setItem('presentation-fail-teachers', 'true')",
    );
    await navigate(client, `${teacherUrl}&errorProbe=1`);
    await waitFor(
      async () => (await bodyText(client)).includes('ไม่สามารถโหลดข้อมูลครูได้'),
      'Teacher list did not expose a recoverable error state',
      35_000,
    );
    await evaluate(client, "sessionStorage.removeItem('presentation-fail-teachers')");
    const retried = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((candidate) => candidate.textContent.includes('ลองโหลดอีกครั้ง'));
        if (!button) return false;
        button.click();
        return true;
      })()`,
    );
    assert(retried, 'Teacher error state did not provide a retry action');
    await waitFor(
      async () => (await bodyText(client)).includes(`@${PRESENTATION_DOMAIN}`),
      'Teacher list did not recover after retry',
    );

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    for (const [url, text, label] of [
      [FRONTEND_URL, 'นักเรียนทั้งหมด', 'mobile home'],
      [teacherUrl, 'จัดการข้อมูลครู', 'mobile teachers'],
      [`${FRONTEND_URL}/manage-users`, 'จัดการผู้ใช้งาน', 'mobile users'],
      [`${FRONTEND_URL}/students`, 'รายชื่อนักเรียน', 'mobile students'],
    ]) {
      await assertPage(client, url, text, label);
      await assertNoRootOverflow(client, label);
    }

    await loginInBrowser(client, userShape(deniedId, deniedActor), deniedCookie);
    await navigate(client, teacherUrl);
    await waitFor(
      async () => String(await evaluate(client, 'location.pathname')) === '/forbidden',
      'Denied browser user reached the teacher list',
    );

    console.log(
      JSON.stringify({
        status: 'presentation_data_browser_smoke_passed',
        allowedApi: allowedChecks.length,
        deniedApi: allowedChecks.length,
        desktopSurfaces: 4,
        errorRetry: true,
        mobileSurfaces: 4,
        fixtureCleanup: 'pending_finally',
      }),
    );
  } finally {
    await clientSafeUnblock(chrome);
    await closeChrome(chrome);
    await disableActors(dataSource);
    await app.close();
  }
}

async function clientSafeUnblock(chrome) {
  if (!chrome?.client) return;
  try {
    await chrome.client.call('Network.setBlockedURLs', { urls: [] });
  } catch {
    // Cleanup must continue even if Chrome already exited.
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
