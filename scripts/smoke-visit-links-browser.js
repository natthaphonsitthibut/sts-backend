const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { TokenEncryptionService } = require('../dist/common/crypto/token-encryption.service');
const { hashToken } = require('../dist/common/utils/helpers');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run visit-links browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9247);
const SCHOOL_ID = 10010002;
const USERNAME = 'visit_links_browser_reviewer';
const SCREENSHOTS = {
  desktop: '/tmp/sts-visit-links-desktop.png',
  mobile: '/tmp/sts-visit-links-mobile.png',
};

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
    this.events = [];
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        this.events.push(message);
        return;
      }
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-visit-links-chrome-'));
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
  const permissions = ['home', 'review-cases', 'attendance'];
  const dataScope = { school_ids: [SCHOOL_ID], own_only: true };
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [USERNAME]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'Visit Links',
            "LastName" = 'Browser Smoke',
            status = 'ACTIVE',
            permissions = $3::jsonb,
            role = 'ADMIN',
            data_scope = $4::jsonb,
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
      [existing.id, passwordHash, JSON.stringify(permissions), JSON.stringify(dataScope)],
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
        $1, $2, 'Visit Links', 'Browser Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        $4::jsonb, FALSE, 'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [USERNAME, passwordHash, JSON.stringify(permissions), JSON.stringify(dataScope)],
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
          deactivation_note = COALESCE(deactivation_note, 'Retained automated visit-links browser smoke fixture')
      WHERE username = $1
        AND data_origin_code = 'AUTOMATED_TEST'
    `,
    [USERNAME],
  );
}

function browserUser(id) {
  return {
    id,
    username: USERNAME,
    FirstName: 'Visit Links',
    LastName: 'Browser Smoke',
    roles: ['ADMIN'],
    permissions: ['home', 'review-cases', 'attendance'],
    data_scope: { school_ids: [SCHOOL_ID], own_only: true },
    must_change_password: false,
  };
}

async function seedVisitLink(dataSource, tokenEncryption, actorId, input) {
  const caseIdLabel = crypto.randomUUID().slice(0, 8);
  const token = crypto.randomBytes(24).toString('base64url');
  const taskId = crypto.randomUUID();
  const linkId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
  const [caseRow] = await dataSource.query(
    `
      INSERT INTO cases (
        student_name, student_first_name, student_last_name, student_school,
        student_address, reason_flagged, status, school_id, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'IN_PROGRESS', $7, $8, $8)
      RETURNING id
    `,
    [
      input.studentName,
      input.studentFirstName,
      input.studentLastName,
      'โรงเรียนทดสอบระบบ',
      `บ้านทดสอบ ${caseIdLabel}`,
      'VISIT_LINK_BROWSER_SMOKE',
      SCHOOL_ID,
      actorId,
    ],
  );
  const caseId = Number(caseRow.id);
  await dataSource.query(
    `
      INSERT INTO tasks (id, case_id, task_type, target_grade, target_room, status, target_school_id)
      VALUES ($1, $2, 'VISIT', 'ม.1', '1', 'IN_PROGRESS', $3)
    `,
    [taskId, caseId, SCHOOL_ID],
  );
  await dataSource.query(
    `
      INSERT INTO task_links (
        id, task_id, parent_link_id, token_hash, token_encrypted, delegation_depth,
        assigned_to_name, assigned_to_phone, assigned_to_email, expires_at, opens_at,
        status, admin_locked, created_by, updated_by
      )
      VALUES ($1, $2, NULL, $3, $4, 0, $5, NULL, $6, $7, $8, 'ACTIVE', 0, $9, $9)
    `,
    [
      linkId,
      taskId,
      hashToken(token),
      tokenEncryption.encrypt(token),
      input.assignee,
      input.email,
      expiresAt,
      input.opensAt,
      actorId,
    ],
  );
  return {
    caseId,
    taskId,
    linkId,
    magicLink: `${FRONTEND_URL}/task/${token}`,
  };
}

async function cleanupFixture(dataSource, fixture) {
  if (!fixture) return;
  const linkIds = fixture.links.map((link) => link.linkId);
  const taskIds = fixture.links.map((link) => link.taskId);
  const caseIds = fixture.links.map((link) => link.caseId);
  if (linkIds.length > 0) {
    await dataSource.query(`DELETE FROM task_links WHERE id = ANY($1::uuid[])`, [linkIds]);
  }
  if (taskIds.length > 0) {
    await dataSource.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [taskIds]);
  }
  if (caseIds.length > 0) {
    await dataSource.query(`DELETE FROM cases WHERE id = ANY($1::int[])`, [caseIds]);
  }
}

async function seedFixture(dataSource, tokenEncryption, actorId) {
  await dataSource.query(
    `
      DELETE FROM task_links
      WHERE assigned_to_name IN ('Visit Active Assignee', 'Visit Scheduled Assignee')
    `,
  );
  await dataSource.query(
    `
      DELETE FROM tasks
      WHERE id NOT IN (SELECT task_id FROM task_links)
        AND task_type = 'VISIT'
        AND case_id IN (
          SELECT id FROM cases WHERE reason_flagged = 'VISIT_LINK_BROWSER_SMOKE'
        )
    `,
  );
  await dataSource.query(
    `DELETE FROM cases WHERE reason_flagged = 'VISIT_LINK_BROWSER_SMOKE'`,
  );

  const active = await seedVisitLink(dataSource, tokenEncryption, actorId, {
    studentName: 'VISIT Smoke Active',
    studentFirstName: 'VISIT Smoke',
    studentLastName: 'Active',
    assignee: 'Visit Active Assignee',
    email: 'visit-active@example.invalid',
    opensAt: null,
  });
  const scheduled = await seedVisitLink(dataSource, tokenEncryption, actorId, {
    studentName: 'VISIT Smoke Scheduled',
    studentFirstName: 'VISIT Smoke',
    studentLastName: 'Scheduled',
    assignee: 'Visit Scheduled Assignee',
    email: 'visit-scheduled@example.invalid',
    opensAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
  });
  return { links: [active, scheduled] };
}

async function clickRowButton(client, rowText, buttonText) {
  await evaluate(
    client,
    `(() => {
      const row = Array.from(document.querySelectorAll('tr')).find((item) =>
        item.innerText.includes(${JSON.stringify(rowText)})
      );
      if (!row) throw new Error('Could not find row: ${rowText}');
      const button = Array.from(row.querySelectorAll('button')).find((item) =>
        item.innerText.includes(${JSON.stringify(buttonText)}) ||
        item.getAttribute('aria-label')?.includes(${JSON.stringify(buttonText)})
      );
      if (!button) throw new Error('Could not find button ${buttonText} in row ${rowText}');
      button.click();
      return true;
    })()`,
  );
}

async function waitForRowButton(client, rowText, buttonText) {
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const row = Array.from(document.querySelectorAll('tr')).find((item) =>
              item.innerText.includes(${JSON.stringify(rowText)})
            );
            return Boolean(row && Array.from(row.querySelectorAll('button')).some((item) =>
              item.innerText.includes(${JSON.stringify(buttonText)}) ||
              item.getAttribute('aria-label')?.includes(${JSON.stringify(buttonText)})
            ));
          })()`,
        ),
      ),
    `Row button did not appear: ${rowText} / ${buttonText}`,
  );
}

async function clickButtonByText(client, buttonText) {
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `Array.from(document.querySelectorAll('button')).some((item) =>
            item.innerText.trim() === ${JSON.stringify(buttonText)}
          )`,
        ),
      ),
    `Button did not appear: ${buttonText}`,
  );
  await evaluate(
    client,
    `(() => {
      const button = Array.from(document.querySelectorAll('button')).find((item) =>
        item.innerText.trim() === ${JSON.stringify(buttonText)}
      );
      if (!button) throw new Error('Could not find button: ${buttonText}');
      button.click();
      return true;
    })()`,
  );
}

async function clickConfirmDialogButton(client, titleText, buttonText) {
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const dialog = Array.from(document.querySelectorAll('section')).find((item) =>
              item.innerText.includes(${JSON.stringify(titleText)})
            );
            return Boolean(dialog && Array.from(dialog.querySelectorAll('button')).some((item) =>
              item.innerText.trim() === ${JSON.stringify(buttonText)}
            ));
          })()`,
        ),
      ),
    `Confirm dialog button did not appear: ${titleText} / ${buttonText}`,
  );
  await evaluate(
    client,
    `(() => {
      const dialog = Array.from(document.querySelectorAll('section')).find((item) =>
        item.innerText.includes(${JSON.stringify(titleText)})
      );
      if (!dialog) throw new Error('Could not find dialog: ${titleText}');
      const button = Array.from(dialog.querySelectorAll('button')).find((item) =>
        item.innerText.trim() === ${JSON.stringify(buttonText)}
      );
      if (!button) throw new Error('Could not find dialog button: ${buttonText}');
      button.click();
      return true;
    })()`,
  );
}

function assertNoConsoleErrors(client) {
  const errors = client.events.filter((event) => {
    if (event.method === 'Runtime.exceptionThrown') return true;
    if (event.method === 'Log.entryAdded') {
      return event.params?.entry?.level === 'error';
    }
    return false;
  });
  assert(
    errors.length === 0,
    `Browser console/runtime errors were emitted: ${JSON.stringify(errors.slice(0, 3))}`,
  );
}

async function assertSummary(client, expected) {
  const text = await bodyText(client);
  for (const [label, value] of Object.entries(expected)) {
    const pattern = new RegExp(`${label}\\s+${value}`);
    assert(pattern.test(text), `Expected summary ${label}=${value}\n${text.slice(0, 1_500)}`);
  }
}

async function fetchVisitLinkState(client, linkId) {
  return evaluate(
    client,
    `(async () => {
      const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/tasks/visit-links?limit=20`)}, {
        credentials: 'include'
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(\`visit-links API failed: \${response.status} \${body.slice(0, 500)}\`);
      }
      const payload = JSON.parse(body);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const link = rows.find((item) => String(item.id) === ${JSON.stringify(String(linkId))});
      if (!link) {
        throw new Error(\`Seeded link was not returned by visit-links API: ${String(linkId)}\`);
      }
      return {
        adminLocked: link.admin_locked,
        state: link.link_state,
        summary: payload.summary || null
      };
    })()`,
  );
}

async function waitForVisitLinkState(client, linkId, expectedState, message) {
  await waitFor(async () => {
    const result = await fetchVisitLinkState(client, linkId);
    if (result.state !== expectedState) {
      throw new Error(
        `Expected link state ${expectedState}, got ${JSON.stringify(result)}`,
      );
    }
    return true;
  }, message);
}

function countAdminLockResponses(client) {
  return client.events.filter(
    (event) =>
      event.method === 'Network.responseReceived' &&
      String(event.params?.response?.url || '').includes('/api/task-links/') &&
      String(event.params?.response?.url || '').includes('/admin-lock'),
  ).length;
}

async function waitForAdminLockResponse(client, previousCount, message) {
  await waitFor(async () => {
    const responses = client.events.filter(
      (event) =>
        event.method === 'Network.responseReceived' &&
        String(event.params?.response?.url || '').includes('/api/task-links/') &&
        String(event.params?.response?.url || '').includes('/admin-lock'),
    );
    if (responses.length <= previousCount) {
      throw new Error('No admin-lock network response was observed');
    }
    const response = responses[responses.length - 1].params.response;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`admin-lock returned HTTP ${response.status}`);
    }
    return true;
  }, message);
}

async function assertVisitLinksPage(client) {
  await navigate(client, `${FRONTEND_URL}/visit-links`);
  try {
    await waitFor(
      async () => {
        const text = await bodyText(client);
        return (
          text.includes('ลิงก์ลงพื้นที่') &&
          text.includes('VISIT Smoke Active') &&
          text.includes('VISIT Smoke Scheduled')
        );
      },
      'Visit links page did not render seeded rows',
    );
  } catch (error) {
    const pathname = await evaluate(client, 'location.pathname + location.search').catch(
      () => '(unknown)',
    );
    const text = await bodyText(client).catch(() => '(body unavailable)');
    const errors = client.events
      .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
      .slice(0, 5);
    throw new Error(
      `${errorMessage(error)}; path=${pathname}; body=${text.slice(0, 2_000)}; events=${JSON.stringify(errors)}`,
    );
  }
  const text = await bodyText(client);
  assert(text.includes('รอเปิด'), `Scheduled badge was not rendered\n${text.slice(0, 1_500)}`);
  assert(text.includes('ใช้งาน'), `Active badge was not rendered\n${text.slice(0, 1_500)}`);
  await assertSummary(client, {
    'ทั้งหมด': 2,
    'รอเปิด': 1,
    'ใช้งาน': 1,
    'หมดอายุ': 0,
  });
}

async function assertNoHorizontalOverflow(client) {
  const dimensions = await evaluate(
    client,
    `(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth
    }))()`,
  );
  assert(
    dimensions.scrollWidth <= dimensions.innerWidth + 1 &&
      dimensions.bodyScrollWidth <= dimensions.innerWidth + 1,
    `Mobile horizontal overflow detected: ${JSON.stringify(dimensions)}`,
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
  const tokenEncryption = app.get(TokenEncryptionService);
  const passwordHash = await passwordService.hash(
    `VisitLinksBrowser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  let chrome;
  let fixture = null;

  try {
    await disableActor(dataSource);
    const userId = await upsertActor(dataSource, passwordHash);
    fixture = await seedFixture(dataSource, tokenEncryption, userId);

    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await client.call('Log.enable');

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await loginInBrowser(
      client,
      browserUser(userId),
      createSessionCookie(sessionCookieService, userId),
    );
    await assertVisitLinksPage(client);
    await capture(client, SCREENSHOTS.desktop);

    const lockResponseCount = countAdminLockResponses(client);
    await clickRowButton(client, 'Visit Active Assignee', 'ปิดลิงก์');
    await clickConfirmDialogButton(client, 'ปิดลิงก์', 'ปิด');
    await waitForAdminLockResponse(
      client,
      lockResponseCount,
      'Lock action did not call the admin-lock endpoint',
    );
    await waitForVisitLinkState(
      client,
      fixture.links[0].linkId,
      'LOCKED',
      'Lock action did not update the active visit link row',
    );

    await navigate(client, `${FRONTEND_URL}/visit-links`);
    await waitForRowButton(client, 'Visit Active Assignee', 'เปิดลิงก์');

    const unlockResponseCount = countAdminLockResponses(client);
    await clickRowButton(client, 'Visit Active Assignee', 'เปิดลิงก์');
    await clickConfirmDialogButton(client, 'เปิดลิงก์', 'เปิด');
    await waitForAdminLockResponse(
      client,
      unlockResponseCount,
      'Unlock action did not call the admin-lock endpoint',
    );
    await waitForVisitLinkState(
      client,
      fixture.links[0].linkId,
      'ACTIVE',
      'Unlock action did not restore the active visit link row',
    );

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/visit-links`);
    await waitFor(
      async () => {
        const text = await bodyText(client);
        return text.includes('VISIT Smoke Active') && text.includes('VISIT Smoke Scheduled');
      },
      'Mobile visit links page did not render seeded rows',
    );
    await assertNoHorizontalOverflow(client);
    await capture(client, SCREENSHOTS.mobile);
    assertNoConsoleErrors(client);

    console.log(
      `visit-links browser smoke passed (scheduled/active summary, lock/unlock, desktop/mobile). screenshots: ${SCREENSHOTS.desktop}, ${SCREENSHOTS.mobile}`,
    );
  } finally {
    await closeChrome(chrome);
    try {
      await cleanupFixture(dataSource, fixture);
    } finally {
      try {
        await disableActor(dataSource);
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
