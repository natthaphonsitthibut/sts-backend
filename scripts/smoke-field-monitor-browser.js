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
  throw new Error('Refusing to run field-monitor browser smoke with NODE_ENV=production');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5173';
const BROWSER_BACKEND_URL =
  process.env.SMOKE_BROWSER_BACKEND_URL || BACKEND_URL.replace('127.0.0.1', 'localhost');
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9234);
const REVIEWER_USERNAME = 'field_monitor_browser_reviewer';
const NO_PERMISSION_USERNAME = 'field_monitor_browser_no_permission';

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-field-monitor-chrome-'));
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
  await navigate(client, `${FRONTEND_URL}/admin-access`);
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
  await navigate(client, `${FRONTEND_URL}/admin-access`);
  await waitFor(
    async () => String(await evaluate(client, 'location.pathname')).startsWith('/admin-access'),
    'Logout did not return to admin access',
  );
}

async function cleanup(dataSource, phones) {
  await dataSource.query(`DELETE FROM field_followers WHERE phone = ANY($1::text[])`, [phones]);
}

async function disableActors(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated field-monitor browser smoke fixture')
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
            "FirstName" = 'Field Monitor',
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
            affiliation = 'Automated field-monitor browser smoke',
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
        $1, $2, 'Field Monitor', 'Browser Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'Automated field-monitor browser smoke',
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
  const password = `FieldMonitorBrowser-${suffix}-Password`;
  const realPhone = `08${String(Date.now()).slice(-8)}`;
  const honeypotPhone = `09${String(Date.now()).slice(-8)}`;
  const applicantFirstName = `FieldMonitorSmoke${suffix.slice(0, 8)}`;
  const applicantLastName = 'Applicant';
  const applicantProvince = `จังหวัดทดสอบ${suffix.slice(0, 6)}`;
  let chrome;

  try {
    await cleanup(dataSource, [realPhone, honeypotPhone]);
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
      FirstName: 'Field Monitor',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home', 'field-monitor'],
      data_scope: { global: true },
      must_change_password: false,
    };
    const noPermissionUser = {
      id: noPermissionActor.id,
      username: NO_PERMISSION_USERNAME,
      FirstName: 'Field Monitor',
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

    // 1. Anonymous public application — no login, no cookie.
    await navigate(client, `${FRONTEND_URL}/apply/field-follower`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'สมัคร อสม./ผู้ติดตามภาคสนาม',
        ),
      'Public application form did not render',
    );
    await fillInput(client, '#follower-first-name', applicantFirstName);
    await fillInput(client, '#follower-last-name', applicantLastName);
    await fillInput(client, '#follower-phone', realPhone);
    await fillInput(client, '#follower-province', applicantProvince);
    await fillInput(client, '#follower-district', 'อำเภอทดสอบ');
    await fillInput(client, '#follower-sub-district', 'ตำบลทดสอบ');
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'ส่งใบสมัคร')`,
      'Submit button was not found',
    );
    try {
      await waitFor(
        async () =>
          String(await evaluate(client, 'document.body.innerText')).includes('ส่งใบสมัครสำเร็จ'),
        'Success confirmation did not render after submit',
      );
    } catch (waitError) {
      console.error('Apply page body at failure:', await evaluate(client, 'document.body.innerText'));
      throw waitError;
    }

    const [applied] = await dataSource.query(
      `SELECT id, status, applied_via FROM field_followers WHERE phone = $1`,
      [realPhone],
    );
    assert(applied, 'Application did not persist to field_followers');
    assert(applied.status === 'APPLIED', 'New application did not default to APPLIED');
    assert(applied.applied_via === 'PUBLIC_FORM', 'applied_via did not default to PUBLIC_FORM');
    const followerId = applied.id;

    // 2. Honeypot — a filled hidden field must silently no-op, not insert a row.
    await navigate(client, `${FRONTEND_URL}/apply/field-follower`);
    await fillInput(client, '#follower-first-name', 'HoneypotBot');
    await fillInput(client, '#follower-last-name', 'ShouldNotPersist');
    await fillInput(client, '#follower-phone', honeypotPhone);
    await fillInput(client, '#follower-website', 'http://spam.example');
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'ส่งใบสมัคร')`,
      'Submit button was not found for honeypot attempt',
    );
    try {
      await waitFor(
        async () =>
          String(await evaluate(client, 'document.body.innerText')).includes('ส่งใบสมัครสำเร็จ'),
        'Honeypot submission did not show the same success response',
      );
    } catch (waitError) {
      console.error('Honeypot page body at failure:', await evaluate(client, 'document.body.innerText'));
      throw waitError;
    }
    const [honeypotRow] = await dataSource.query(
      `SELECT id FROM field_followers WHERE phone = $1`,
      [honeypotPhone],
    );
    assert(!honeypotRow, 'Honeypot submission incorrectly persisted a row');

    // 3. Permission gate — a user without field-monitor is forbidden.
    await loginInBrowser(client, noPermissionUser, noPermissionSession);
    await navigate(client, `${FRONTEND_URL}/field-followers`);
    try {
      await waitFor(
        async () =>
          (await evaluate(client, 'location.pathname')) === '/forbidden' &&
          String(await evaluate(client, 'document.body.innerText')).includes('ไม่มีสิทธิ์เข้าถึง'),
        'No-permission user was not blocked from field-followers review',
      );
    } catch (waitError) {
      console.error('No-permission pathname:', await evaluate(client, 'location.pathname'));
      console.error('No-permission body:', await evaluate(client, 'document.body.innerText'));
      console.error(
        'No-permission stored user:',
        await evaluate(client, `localStorage.getItem('sts_user')`),
      );
      throw waitError;
    }
    await logoutInBrowser(client);

    // 4. Reviewer sees the applicant, filtered by the unique test province.
    await loginInBrowser(client, reviewerUser, reviewerSession);
    await navigate(client, `${FRONTEND_URL}/field-followers`);
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === '/field-followers' &&
        String(await evaluate(client, 'document.body.innerText')).includes(
          'ตรวจสอบใบสมัคร อสม./ผู้ติดตาม',
        ),
      'Field-followers review page did not render for reviewer',
    );
    await fillInput(client, 'input[placeholder="จังหวัด"]', applicantProvince);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(applicantFirstName),
      'Applicant did not appear in filtered review list',
    );

    // 5. Approve the applicant.
    await click(
      client,
      `(() => {
        const row = [...document.querySelectorAll('tr')]
          .find((node) => node.textContent.includes(${JSON.stringify(applicantFirstName)}));
        return row
          ? [...row.querySelectorAll('button')].find((button) => button.textContent.trim() === 'อนุมัติ')
          : null;
      })()`,
      'Approve button was not found for applicant row',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('อนุมัติผู้สมัคร'),
      'Approve confirm dialog did not render',
    );
    await click(
      client,
      `(() => {
        const dialog = [...document.querySelectorAll('section')]
          .find((section) => section.textContent.includes('อนุมัติผู้สมัคร'));
        return dialog
          ? [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === 'อนุมัติ')
          : null;
      })()`,
      'Approve confirm button was not found',
    );
    await waitFor(async () => {
      const [row] = await dataSource.query(`SELECT status FROM field_followers WHERE id = $1`, [
        followerId,
      ]);
      return row?.status === 'ACTIVE';
    }, 'Approve did not persist to ACTIVE in the database');

    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `(() => {
              const row = [...document.querySelectorAll('tr')]
                .find((node) => node.textContent.includes(${JSON.stringify(applicantFirstName)}));
              return Boolean(row && row.textContent.includes('ใช้งานได้'));
            })()`,
          ),
        ),
      'Approved status badge did not refresh in the review list',
    );
    await capture(client, '/tmp/sts-field-monitor-desktop.png');

    const [reviewed] = await dataSource.query(
      `SELECT status, reviewed_by_user_id, reviewed_at FROM field_followers WHERE id = $1`,
      [followerId],
    );
    assert(reviewed.status === 'ACTIVE', 'Reviewed status did not persist as ACTIVE');
    assert(
      Number(reviewed.reviewed_by_user_id) === Number(reviewerActor.id),
      'reviewed_by_user_id did not record the reviewer',
    );
    assert(reviewed.reviewed_at, 'reviewed_at was not stamped');

    const [applyAudit] = await dataSource.query(
      `SELECT action FROM audit_log WHERE action = 'FIELD_FOLLOWER_APPLY' AND target_id = $1`,
      [String(followerId)],
    );
    assert(applyAudit, 'FIELD_FOLLOWER_APPLY audit entry was not recorded');

    const [reviewAudit] = await dataSource.query(
      `SELECT metadata FROM audit_log WHERE action = 'FIELD_FOLLOWER_REVIEW' AND target_id = $1`,
      [String(followerId)],
    );
    assert(reviewAudit, 'FIELD_FOLLOWER_REVIEW audit entry was not recorded');
    assert(
      reviewAudit.metadata?.reviewAction === 'APPROVE',
      'FIELD_FOLLOWER_REVIEW audit entry did not record the APPROVE action',
    );

    // 6. Mobile card layout.
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/field-followers`);
    await waitFor(
      async () => Boolean(await evaluate(client, `Boolean(document.querySelector('input[placeholder="จังหวัด"]'))`)),
      'Mobile province filter did not render',
    );
    await fillInput(client, 'input[placeholder="จังหวัด"]', applicantProvince);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(applicantFirstName) &&
        String(await evaluate(client, 'document.body.innerText')).includes('ใช้งานได้'),
      'Mobile field-followers page did not render the approved applicant',
    );
    await capture(client, '/tmp/sts-field-monitor-mobile.png');

    console.log(
      'field-monitor browser smoke passed (public apply, honeypot no-op, permission gate, review list filter, approve action, desktop/mobile)',
    );
  } finally {
    await closeChrome(chrome);
    try {
      await cleanup(dataSource, [realPhone, honeypotPhone]);
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
