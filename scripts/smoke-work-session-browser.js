const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { hashToken } = require('../dist/common/utils/helpers');
const { VisitWorkSessionsService } = require('../dist/visit-work-sessions/visit-work-sessions.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run work-session browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5173';
const BROWSER_BACKEND_URL = process.env.SMOKE_BROWSER_BACKEND_URL || BACKEND_URL;
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9248);
const REVIEWER_USERNAME = 'work_session_browser_reviewer';
const NO_PERMISSION_USERNAME = 'work_session_browser_no_permission';
const FIXTURE_MARKER = 'WORK_SESSION_SMOKE_FIXTURE';
const PING_LAT = 18.796143;
const PING_LNG = 98.979263;

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-work-session-chrome-'));
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

async function cleanup(dataSource) {
  const caseIds = await dataSource.query(
    `SELECT id FROM cases WHERE reason_flagged = $1`,
    [FIXTURE_MARKER],
  );
  if (caseIds.length > 0) {
    const ids = caseIds.map((row) => row.id);
    await dataSource.query(
      `DELETE FROM visit_work_sessions WHERE task_link_id IN (
        SELECT tl.id FROM task_links tl JOIN tasks t ON t.id = tl.task_id WHERE t.case_id = ANY($1::int[])
      )`,
      [ids],
    );
    await dataSource.query(
      `DELETE FROM task_links WHERE task_id IN (SELECT id FROM tasks WHERE case_id = ANY($1::int[]))`,
      [ids],
    );
    await dataSource.query(`DELETE FROM tasks WHERE case_id = ANY($1::int[])`, [ids]);
    await dataSource.query(`DELETE FROM cases WHERE id = ANY($1::int[])`, [ids]);
  }
}

async function disableActors(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated work-session browser smoke fixture')
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
            "FirstName" = 'Work Session',
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
            affiliation = 'Automated work-session browser smoke',
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
        $1, $2, 'Work Session', 'Browser Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'Automated work-session browser smoke',
        'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [username, passwordHash, JSON.stringify(permissions)],
  );
  return row;
}

async function createFixtureLink(dataSource, assignedToName) {
  const [caseRow] = await dataSource.query(
    `
      INSERT INTO cases (student_name, status, reason_flagged, created_at)
      VALUES ($1, 'OPEN', $2, now())
      RETURNING id
    `,
    ['เด็กทดสอบ Work Session', FIXTURE_MARKER],
  );
  const taskId = crypto.randomUUID();
  await dataSource.query(
    `
      INSERT INTO tasks (id, case_id, task_type, status, created_at)
      VALUES ($1, $2, 'VISIT', 'IN_PROGRESS', now())
    `,
    [taskId, caseRow.id],
  );
  const linkId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  await dataSource.query(
    `
      INSERT INTO task_links (
        id, task_id, token_hash, assigned_to_name, status, otp_verified, expires_at, created_at
      )
      VALUES ($1, $2, $3, $4, 'ACTIVE', 1, now() + interval '1 day', now())
    `,
    [linkId, taskId, tokenHash, assignedToName],
  );
  return { linkId, taskId, caseId: caseRow.id, token };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  const sessionCookieService = app.get(SessionCookieService);
  const workSessionsService = app.get(VisitWorkSessionsService);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = `WorkSessionBrowser-${suffix}-Password`;
  const assignedToName = `ผู้ปฏิบัติงานทดสอบ ${suffix.slice(0, 8)}`;
  let chrome;

  try {
    await cleanup(dataSource);
    const fixture = await createFixtureLink(dataSource, assignedToName);

    const reviewerActor = await upsertActor(
      dataSource,
      await passwordService.hash(password),
      REVIEWER_USERNAME,
      ['home', 'field-monitor'],
    );
    const noPermissionActor = await upsertActor(
      dataSource,
      await passwordService.hash(password),
      NO_PERMISSION_USERNAME,
      ['home'],
    );
    const reviewerUser = {
      id: reviewerActor.id,
      username: REVIEWER_USERNAME,
      FirstName: 'Work Session',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home', 'field-monitor'],
      data_scope: { global: true },
      must_change_password: false,
    };
    const noPermissionUser = {
      id: noPermissionActor.id,
      username: NO_PERMISSION_USERNAME,
      FirstName: 'Work Session',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home'],
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
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.call('Browser.grantPermissions', {
      origin: FRONTEND_URL,
      permissions: ['geolocation'],
    });
    await client.call('Emulation.setGeolocationOverride', {
      latitude: PING_LAT,
      longitude: PING_LNG,
      accuracy: 10,
    });

    // 1. Guest opens the task, sees the work-session card with consent required.
    await navigate(client, `${FRONTEND_URL}/task/${fixture.token}`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'ช่วงปฏิบัติงานภาคสนาม',
        ),
      'Work-session card did not render on the guest task page',
    );
    const startDisabledBeforeConsent = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((b) => b.textContent.trim() === 'เริ่มปฏิบัติงาน');
        return Boolean(button?.disabled);
      })()`,
    );
    assert(startDisabledBeforeConsent, 'Start button was not disabled before consent was given');

    await evaluate(
      client,
      `(() => {
        const label = [...document.querySelectorAll('label')]
          .find((node) => node.textContent.includes('ยินยอมให้ระบบบันทึกตำแหน่ง'));
        const input = label?.querySelector('input[type="checkbox"]');
        if (!input) throw new Error('Consent checkbox not found');
        if (!input.checked) input.click();
      })()`,
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'เริ่มปฏิบัติงาน')`,
      'Start-session button was not found after consent',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('กำลังปฏิบัติงาน'),
      'Session did not show as active after start',
    );

    const [session] = await dataSource.query(
      `SELECT id, consent_at, ended_at FROM visit_work_sessions WHERE task_link_id = $1`,
      [fixture.linkId],
    );
    assert(session, 'visit_work_sessions row was not created');
    assert(session.consent_at, 'consent_at was not stamped');
    assert(!session.ended_at, 'New session should not already be ended');

    // 2. Ping loop fires immediately on start — verify a ping lands with the mocked coordinates.
    await waitFor(async () => {
      const [ping] = await dataSource.query(
        `SELECT lat, lng FROM visit_position_pings WHERE session_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
        [session.id],
      );
      return Boolean(ping) && Math.abs(ping.lat - PING_LAT) < 0.001 && Math.abs(ping.lng - PING_LNG) < 0.001;
    }, 'Position ping was not recorded with the mocked coordinates');

    // 3. Monitor sees the active session with the right assignee + last position.
    await loginInBrowser(client, reviewerUser, reviewerSession);
    await navigate(client, `${FRONTEND_URL}/work-session-monitor`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(assignedToName),
      'Monitor did not show the active work session',
    );
    await capture(client, '/tmp/sts-work-session-monitor-desktop.png');

    const [viewAudit] = await dataSource.query(
      `SELECT metadata FROM audit_log WHERE action = 'WORK_SESSION_VIEW' ORDER BY created_at DESC LIMIT 1`,
    );
    assert(viewAudit && viewAudit.metadata?.activeCount >= 1, 'WORK_SESSION_VIEW audit was not recorded');

    // 4. Permission gate.
    await logoutInBrowser(client);
    await loginInBrowser(client, noPermissionUser, noPermissionSession);
    await navigate(client, `${FRONTEND_URL}/work-session-monitor`);
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === '/forbidden' &&
        String(await evaluate(client, 'document.body.innerText')).includes('ไม่มีสิทธิ์เข้าถึง'),
      'No-permission user was not blocked from the work-session monitor',
    );
    await logoutInBrowser(client);

    // 5. Guest ends the session manually.
    await navigate(client, `${FRONTEND_URL}/task/${fixture.token}`);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('กำลังปฏิบัติงาน'),
      'Guest page did not resume showing the active session after reload',
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'จบการทำงาน')`,
      'End-session button was not found',
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('จบการปฏิบัติงาน'),
      'End-session confirm dialog did not render',
    );
    await click(
      client,
      `(() => {
        const dialog = [...document.querySelectorAll('section')]
          .find((section) => section.textContent.includes('จบการปฏิบัติงาน'));
        return dialog
          ? [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'จบการทำงาน')
          : null;
      })()`,
      'End-session confirm button was not found',
    );
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT ended_at, end_reason FROM visit_work_sessions WHERE id = $1`,
        [session.id],
      );
      return row?.end_reason === 'MANUAL' && Boolean(row.ended_at);
    }, 'Session did not end as MANUAL in the database');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'ยินยอมให้ระบบบันทึกตำแหน่ง',
        ),
      'Guest page did not return to the consent/start state after ending',
    );

    // 6. Monitor's history shows the ended session with the right reason label.
    await loginInBrowser(client, reviewerUser, reviewerSession);
    await navigate(client, `${FRONTEND_URL}/work-session-monitor`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(assignedToName) &&
        String(await evaluate(client, 'document.body.innerText')).includes('จบเอง'),
      'Monitor history did not show the manually-ended session',
    );
    await capture(client, '/tmp/sts-work-session-monitor-history.png');

    // 7. Timeout cron — start a second session, then simulate 31 minutes of silence.
    const secondFixture = await createFixtureLink(dataSource, `${assignedToName} รอบสอง`);
    await navigate(client, `${FRONTEND_URL}/task/${secondFixture.token}`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'ช่วงปฏิบัติงานภาคสนาม',
        ),
      'Work-session card did not render for the second fixture',
    );
    await evaluate(
      client,
      `(() => {
        const label = [...document.querySelectorAll('label')]
          .find((node) => node.textContent.includes('ยินยอมให้ระบบบันทึกตำแหน่ง'));
        const input = label?.querySelector('input[type="checkbox"]');
        if (!input) throw new Error('Consent checkbox not found (second fixture)');
        if (!input.checked) input.click();
      })()`,
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'เริ่มปฏิบัติงาน')`,
      'Start-session button was not found (second fixture)',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('กำลังปฏิบัติงาน'),
      'Second session did not start',
    );

    const futureNow = new Date(Date.now() + 31 * 60 * 1000);
    const { closed } = await workSessionsService.closeTimedOutSessions(futureNow);
    assert(closed >= 1, 'Timeout cron did not close the stale session');

    const [secondSession] = await dataSource.query(
      `SELECT end_reason, ended_at FROM visit_work_sessions WHERE task_link_id = $1`,
      [secondFixture.linkId],
    );
    assert(secondSession?.end_reason === 'TIMEOUT', 'Second session was not closed as TIMEOUT');

    // 8. Retention cron — pings older than 7 days get deleted, session metadata stays.
    await dataSource.query(
      `UPDATE visit_position_pings SET recorded_at = now() - interval '8 days' WHERE session_id = $1`,
      [session.id],
    );
    const { deleted } = await workSessionsService.cleanupExpiredPings();
    assert(deleted >= 1, 'Retention cron did not delete the aged-out ping');
    const [survivingSession] = await dataSource.query(
      `SELECT id FROM visit_work_sessions WHERE id = $1`,
      [session.id],
    );
    assert(survivingSession, 'Session metadata was wrongly deleted by ping retention cleanup');

    console.log(
      'work-session browser smoke passed (consent-gated start, ping, monitor view+audit, permission gate, manual end, history, timeout cron, ping retention cron)',
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
