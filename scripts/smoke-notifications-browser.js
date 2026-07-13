const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9231;
const USERNAME = 'notifications_browser_smoke';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorMessage(error) {
  if (error instanceof AggregateError) {
    return error.errors.map((cause) => cause?.message || String(cause)).join(' | ');
  }
  return error?.message || String(error);
}

function returningRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

async function waitFor(check, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(message);
}

async function collectInitialBellDiagnostics(client) {
  return evaluate(
    client,
    `JSON.stringify({
      path: location.pathname,
      body: document.body.innerText.slice(0, 800),
      hasUserStorage: Boolean(localStorage.getItem('sts_user') || sessionStorage.getItem('sts_user')),
      hasAdminAccess: localStorage.getItem('admin_access') === 'true' || sessionStorage.getItem('admin_access') === 'true',
      buttons: [...document.querySelectorAll('button')].map((button) => ({
        label: button.getAttribute('aria-label'),
        text: button.textContent?.trim().slice(0, 80),
      })).slice(0, 20),
    })`,
  );
}

async function collectNotificationFetchDiagnostics(client) {
  return evaluate(
    client,
    `fetch('${BACKEND_URL}/api/notifications?limit=10', { credentials: 'include' })
      .then(async (response) => ({
        status: response.status,
        body: await response.text().then((text) => text.slice(0, 800)),
      }))
      .then((result) => JSON.stringify(result))
      .catch((error) => JSON.stringify({ error: error?.message || String(error) }))`,
  );
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-notifications-chrome-'));
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

async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error('Browser expression failed');
  return result.result?.value;
}

async function navigate(client, url) {
  await client.call('Page.navigate', { url });
  await waitFor(
    async () => (await evaluate(client, 'document.readyState')) === 'complete',
    `Page did not finish loading: ${url}`,
  );
}

async function upsertFixture(dataSource, passwordHash) {
  const permissions = [
    'home',
    'review-cases',
    'import-data',
    'manage-student-accounts',
    'attendance-dashboard',
  ];
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [USERNAME]);
  if (existing) {
    const [updated] = returningRows(
      await dataSource.query(
        `UPDATE users
         SET password = $2, status = 'ACTIVE', permissions = $3::jsonb, role = 'ADMIN',
             data_scope = '{"global":true}'::jsonb, data_origin_code = 'AUTOMATED_TEST',
             must_change_password = FALSE, deactivated_at = NULL, deactivated_by = NULL,
             deactivation_reason_code = NULL, deactivation_note = NULL
         WHERE id = $1
         RETURNING id`,
        [existing.id, passwordHash, JSON.stringify(permissions)],
      ),
    );
    assert(updated?.id, 'Updating notification browser fixture did not return a user id');
    return updated.id;
  }
  const [created] = returningRows(
    await dataSource.query(
      `INSERT INTO users
         (username, password, "FirstName", "LastName", status, permissions, role,
          data_scope, must_change_password, data_origin_code)
       VALUES ($1, $2, 'Notification', 'Browser Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
               '{"global":true}'::jsonb, FALSE, 'AUTOMATED_TEST')
       RETURNING id`,
      [USERNAME, passwordHash, JSON.stringify(permissions)],
    ),
  );
  assert(created?.id, 'Creating notification browser fixture did not return a user id');
  return created.id;
}

async function seedNotifications(dataSource, userId, refPrefix) {
  await dataSource.query(
    `INSERT INTO notifications
       (recipient_user_id, type_code, title, body, ref_entity, ref_id, created_at)
     VALUES
       ($1, 'CASE_CREATED', 'Browser smoke case', 'Scoped case notification', 'case', $2, now()),
       ($1, 'IMPORT_COMPLETED', 'Browser smoke import', 'Import completed', 'import', $3,
        now() - interval '1 minute'),
       ($1, 'STUDENT_ACCOUNT_BATCH_COMPLETED', 'Browser smoke account batch',
        'Account batch completed', 'student-account-batch', $4, now() - interval '2 minutes')`,
    [userId, `${refPrefix}-case`, `${refPrefix}-import`, `${refPrefix}-account`],
  );
}

async function login(password) {
  const response = await fetch(`${BACKEND_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password }),
  });
  assert(response.status === 201, `Browser fixture login returned ${response.status}`);
  const user = await response.json();
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  assert(setCookie, 'Login did not return a session cookie');
  const [cookiePair] = setCookie.split(';');
  const separator = cookiePair.indexOf('=');
  return {
    user,
    cookieName: cookiePair.slice(0, separator),
    cookieValue: cookiePair.slice(separator + 1),
  };
}

async function capture(client, outputPath) {
  const result = await client.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
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

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const refPrefix = `browser-smoke-${suffix}`;
  const password = `Browser-${suffix}-Password`;
  let chrome;
  let userId;

  try {
    userId = await upsertFixture(dataSource, await passwordService.hash(password));
    await dataSource.query(`DELETE FROM notifications WHERE recipient_user_id = $1`, [userId]);
    await seedNotifications(dataSource, userId, refPrefix);
    const session = await login(password);

    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await client.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          const backendUrl = ${JSON.stringify(BACKEND_URL)};
          const rewrite = (url) =>
            typeof url === 'string' ? url.replace('http://127.0.0.1:3000', backendUrl) : url;
          const originalOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            return originalOpen.call(this, method, rewrite(url), ...rest);
          };
          const originalFetch = window.fetch;
          window.fetch = (input, init) =>
            originalFetch(typeof input === 'string' ? rewrite(input) : input, init);
        })();
      `,
    });
    await client.call('Network.setCookie', {
      name: session.cookieName,
      value: session.cookieValue,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });

    await navigate(client, `${FRONTEND_URL}/login`);
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(session.user))});
       localStorage.setItem('admin_access', 'true');`,
    );
    await navigate(client, `${FRONTEND_URL}/`);
    try {
      await waitFor(
        async () =>
          await evaluate(
            client,
            `Boolean(document.querySelector('button[aria-label*="รายการแจ้งเตือน (ใหม่ 3 รายการ)"]'))`,
          ),
        'Notification bell did not show unseen count 3',
      );
    } catch (error) {
      const pageDiagnostics = await collectInitialBellDiagnostics(client);
      const fetchDiagnostics = await collectNotificationFetchDiagnostics(client);
      throw new Error(
        `${errorMessage(error)}; page=${pageDiagnostics}; notifications=${fetchDiagnostics}`,
      );
    }

    await evaluate(
      client,
      `document.querySelector('button[aria-label*="รายการแจ้งเตือน"]')?.click()`,
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('Browser smoke import'),
      'Notification dropdown did not render fixtures',
    );
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT COUNT(*) FILTER (WHERE seen_at IS NOT NULL)::int AS seen_count
         FROM notifications WHERE recipient_user_id = $1`,
        [userId],
      );
      return row.seen_count === 3;
    }, 'Opening the bell did not persist seen state');

    await evaluate(
      client,
      `[...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes('ดูการแจ้งเตือนทั้งหมด'))?.click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === '/notifications' &&
        String(await evaluate(client, 'document.body.innerText')).includes('Browser smoke account batch'),
      'Full notification inbox did not render',
    );
    await capture(client, '/tmp/sts-notifications-desktop.png');

    await evaluate(
      client,
      `[...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes('Browser smoke import'))?.click()`,
    );
    await waitFor(
      async () => (await evaluate(client, 'location.pathname')) === '/import-data/history',
      'Import notification did not deep-link to history',
    );
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT read_at IS NOT NULL AS is_read FROM notifications WHERE ref_id = $1`,
        [`${refPrefix}-import`],
      );
      return row?.is_read === true;
    }, 'Opening the import notification did not persist read state');

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/notifications`);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('Browser smoke case'),
      'Mobile notification inbox did not render',
    );
    await capture(client, '/tmp/sts-notifications-mobile.png');

    console.log(
      'notification browser smoke passed (bell seen, inbox desktop/mobile, import deep-link/read)',
    );
  } finally {
    await closeChrome(chrome);
    if (userId) {
      await dataSource.query(`DELETE FROM notifications WHERE recipient_user_id = $1`, [userId]);
      await dataSource.query(
        `UPDATE users SET status = 'DISABLED', deactivated_at = now(),
            deactivation_reason_code = 'OTHER', deactivation_note = 'Browser smoke fixture'
         WHERE id = $1 AND username = $2`,
        [userId, USERNAME],
      );
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
