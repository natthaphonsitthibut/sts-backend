const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { AuditLogService } = require('../dist/audit-log/audit-log.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run entity-history browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9237);
const ADMIN_USERNAME = 'entity_history_browser_admin';
// Thai labels for the users-domain audit actions (mirrors USER_AUDIT_ACTION_OPTIONS).
const USER_ACTION_LABELS = [
  'สร้างผู้ใช้งาน', 'แก้ไขผู้ใช้งาน', 'ปิดใช้งานผู้ใช้งาน',
  'เปิดใช้งานผู้ใช้งานอีกครั้ง', 'ออกรหัสชั่วคราวใหม่', 'ปิดหรือลบผู้ใช้งาน',
];
const LINK_ACTIONS = ['TASK_CREATE', 'TASK_DELETE', 'LINK_LOCK', 'LINK_UNLOCK', 'DELEGATION'];
const ALL_PERMISSIONS = [
  'home', 'dashboard', 'students', 'edit-students', 'review-cases', 'close-case',
  'forward-case', 'student-self', 'create', 'import-data', 'attendance-dashboard',
  'attendance', 'manage-users-list', 'manage-users-hard-delete',
  'manage-student-accounts', 'manage-role-groups', 'login-links', 'settings',
  'audit-log',
];

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-history-chrome-'));
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

async function capture(client, outputPath) {
  const result = await client.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
}

async function bodyText(client) {
  return String(await evaluate(client, 'document.body.innerText'));
}

async function detailLinkCount(client) {
  return Number(
    await evaluate(
      client,
      `[...document.querySelectorAll('a,button')].filter((node) => node.textContent.trim() === 'ดูรายละเอียด').length`,
    ),
  );
}

async function upsertAdmin(dataSource, passwordHash) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [ADMIN_USERNAME]);
  if (existing) {
    const [updated] = returningRows(
      await dataSource.query(
        `UPDATE users
         SET password = $2, status = 'ACTIVE', role = 'ADMIN', permissions = $3::jsonb,
             data_scope = '{"global":true}'::jsonb, "PersonID_Onec" = '1000000000010',
             "FirstName" = 'History', "LastName" = 'Browser Smoke',
             data_origin_code = 'DEMO', must_change_password = FALSE,
             deactivated_at = NULL, deactivated_by = NULL,
             deactivation_reason_code = NULL, deactivation_note = NULL
         WHERE id = $1
         RETURNING id`,
        [existing.id, passwordHash, JSON.stringify(ALL_PERMISSIONS)],
      ),
    );
    assert(updated?.id, 'Updating history admin fixture did not return an id');
    return updated.id;
  }
  const [created] = returningRows(
    await dataSource.query(
      `INSERT INTO users
         (username, password, "FirstName", "LastName", "PersonID_Onec", status, permissions, role,
          data_scope, must_change_password, data_origin_code)
       VALUES ($1, $2, 'History', 'Browser Smoke', '1000000000010', 'ACTIVE', $3::jsonb, 'ADMIN',
               '{"global":true}'::jsonb, FALSE, 'DEMO')
       RETURNING id`,
      [ADMIN_USERNAME, passwordHash, JSON.stringify(ALL_PERMISSIONS)],
    ),
  );
  assert(created?.id, 'Creating history admin fixture did not return an id');
  return created.id;
}

async function disableAdmin(dataSource, id) {
  if (!id) return;
  await dataSource.query(
    `UPDATE users
     SET status = 'DISABLED', deactivated_at = now(),
         deactivation_reason_code = 'OTHER', deactivation_note = 'Browser smoke fixture',
         data_origin_code = 'AUTOMATED_TEST'
     WHERE id = $1 AND username = $2`,
    [id, ADMIN_USERNAME],
  );
}

async function login(password) {
  const response = await fetch(`${BACKEND_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password }),
  });
  assert(response.status === 201, `History fixture login returned ${response.status}`);
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

async function createCompletedStudentAccountJob(session) {
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  const response = await fetch(`${BACKEND_URL}/api/users/student-accounts/batch-jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ schoolId: 10010002, grade: 'ม.6', room: 999 }),
  });
  const body = await response.json();
  assert(response.status === 201, `Student-account batch enqueue returned ${response.status}`);
  const jobId = body?.data?.id;
  assert(jobId, 'Student-account batch enqueue did not return a job id');

  let completedJob;
  await waitFor(async () => {
    const detailResponse = await fetch(
      `${BACKEND_URL}/api/users/student-accounts/batch-jobs/${jobId}`,
      { headers: { cookie } },
    );
    if (!detailResponse.ok) return false;
    completedJob = (await detailResponse.json())?.data;
    return completedJob?.status === 'COMPLETED';
  }, 'Student-account batch job did not complete');
  return completedJob;
}

async function waitForHistoryPanel(client, panelTitle) {
  await waitFor(async () => {
    const text = await bodyText(client);
    return text.includes(panelTitle) && (await detailLinkCount(client)) > 0;
  }, `History panel "${panelTitle}" did not render with rows`);
}

async function selectAction(client, value) {
  // The base Select renders a custom trigger button carrying the id plus a
  // hidden native <select> (with the real onChange) as its sibling. Drive the
  // native select so React state updates exactly as a real change would.
  await evaluate(
    client,
    `(() => {
      const trigger = document.getElementById('audit-action');
      if (!trigger) throw new Error('Action filter trigger not found');
      const select = trigger.parentElement?.querySelector('select');
      if (!select) throw new Error('Hidden native action select not found');
      const values = [...select.querySelectorAll('option')].map((option) => option.value);
      if (!values.includes(${JSON.stringify(value)})) {
        throw new Error('Action option missing (' + ${JSON.stringify(value)} + '); have: ' + values.join(','));
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, ${JSON.stringify(value)});
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

async function verifyActionFilters(client, context) {
  for (const action of LINK_ACTIONS) {
    await selectAction(client, action);
    await waitFor(async () => {
      const text = await bodyText(client);
      return !text.includes('กำลังอัปเดต') && !text.includes('กำลังโหลดประวัติ');
    }, `${context}: filter ${action} did not finish`);
    assert(!(await bodyText(client)).includes('โหลดประวัติไม่สำเร็จ'), `${context}: ${action} returned an error`);
  }
  await selectAction(client, '');
}

async function recordLinkHistoryFixtures(auditLog, adminId, suffix) {
  const fixtureIds = {
    LOGIN: `history-login-${suffix}`,
    ATTENDANCE: `history-attendance-${suffix}`,
    VISIT: `history-visit-${suffix}`,
  };
  for (const [taskType, targetId] of Object.entries(fixtureIds)) {
    await auditLog.record({
      action: 'LINK_LOCK',
      actorUserId: adminId,
      actorLabel: ADMIN_USERNAME,
      targetType: 'task_link',
      targetId,
      metadata: { taskType, scope: { global: true } },
    });
  }
  return fixtureIds;
}

function assertNoSecretLeak(text, context) {
  // A raw national ID shows as a standalone 13-digit number. Exclude 13-digit
  // runs that are part of a longer token (e.g. the millisecond-timestamp suffix
  // on AUTOMATED_TEST fixture labels like "…-smoke-1782321788918").
  assert(
    !/(?<![\w-])\d{13}(?![\w-])/.test(text),
    `${context}: a raw 13-digit national ID appears in the history view`,
  );
  assert(!/password/i.test(text), `${context}: the word "password" leaked into the history view`);
  assert(
    !text.includes('รหัสผ่านชั่วคราว') && !text.includes('token_hash') && !text.includes('otp'),
    `${context}: a credential/secret token leaked into the history view`,
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  const auditLog = app.get(AuditLogService);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = `History-${suffix}-Password`;
  let chrome;
  let adminId;

  try {
    const studentHistoryOnly = process.env.SMOKE_STUDENT_HISTORY_ONLY === '1';
    adminId = await upsertAdmin(dataSource, await passwordService.hash(password));
    if (studentHistoryOnly) {
      const [existingStudentHistoryFixture] = await dataSource.query(
        `SELECT id FROM audit_log
         WHERE actor_user_id = $1
           AND target_type = 'student'
           AND target_id LIKE 'automated-student-history-%'
         LIMIT 1`,
        [adminId],
      );
      if (!existingStudentHistoryFixture) {
        await auditLog.record({
          action: 'STUDENT_UPDATE',
          actorUserId: adminId,
          actorLabel: ADMIN_USERNAME,
          targetType: 'student',
          targetId: 'automated-student-history-browser',
          metadata: {
            fieldCount: 1,
            fields: ['automated_history_check'],
            dataOriginCode: 'AUTOMATED_TEST',
          },
        });
      }
    }
    const linkFixtureIds = await recordLinkHistoryFixtures(auditLog, adminId, suffix);
    const [attendanceLink] = await dataSource.query(
      `SELECT tl.id
       FROM task_links tl
       JOIN tasks t ON t.id = tl.task_id
       WHERE t.task_type = 'ATTENDANCE'
         AND t.deleted_at IS NULL
         AND tl.deleted_at IS NULL
       ORDER BY tl.created_at DESC
       LIMIT 1`,
    );
    assert(attendanceLink?.id, 'No attendance link is available for detail-history smoke');
    await auditLog.record({
      action: 'LINK_LOCK',
      actorUserId: adminId,
      actorLabel: ADMIN_USERNAME,
      targetType: 'task_link',
      targetId: String(attendanceLink.id),
      metadata: { taskType: 'ATTENDANCE', scope: { global: true } },
    });
    const session = await login(password);
    const completedJob = studentHistoryOnly ? null : await createCompletedStudentAccountJob(session);

    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
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

    if (studentHistoryOnly) {
      await navigate(client, `${FRONTEND_URL}/students/history`);
      await waitForHistoryPanel(client, 'ประวัติข้อมูลนักเรียน');
      assertNoSecretLeak(await bodyText(client), 'Student history');
      console.log('student history browser smoke passed');
      return;
    }

    assert(completedJob?.id, 'Student-account batch fixture did not return a job id');

    // --- Users history: shared audit panel renders, filters, and never leaks ---
    await navigate(client, `${FRONTEND_URL}/manage-users/history`);
    await waitForHistoryPanel(client, 'ประวัติผู้ใช้งาน');

    const unfilteredRows = await detailLinkCount(client);
    assert(unfilteredRows > 0, 'Users history panel showed no audit rows');
    assertNoSecretLeak(await bodyText(client), 'Users history (unfiltered)');
    await capture(client, '/tmp/sts-entity-history-users-desktop.png');

    // Narrow to a single action; the shared panel must re-query and shrink.
    await selectAction(client, 'USER_UPDATE');
    await waitFor(async () => {
      const rows = await detailLinkCount(client);
      return rows > 0 && rows < unfilteredRows;
    }, 'Action filter USER_UPDATE did not narrow the users history');

    // Every row's action badge (table cells carry title=actionLabel) must now be
    // the filtered action only. Reading the badge titles avoids false hits from
    // the hidden native <select> that still holds every option label.
    const rowActionLabels = JSON.parse(
      await evaluate(
        client,
        `JSON.stringify([...document.querySelectorAll('[title]')]
          .map((node) => node.getAttribute('title'))
          .filter((title) => ${JSON.stringify(USER_ACTION_LABELS)}.includes(title)))`,
      ),
    );
    assert(rowActionLabels.length > 0, 'No action badges were found after filtering');
    assert(
      rowActionLabels.every((label) => label === 'แก้ไขผู้ใช้งาน'),
      `Filtered users history still shows other actions: ${[...new Set(rowActionLabels)].join(', ')}`,
    );
    assertNoSecretLeak(await bodyText(client), 'Users history (filtered)');

    // --- Student-account history: a real background job produces enqueue + outcome rows ---
    await navigate(client, `${FRONTEND_URL}/manage-student-accounts/history`);
    await waitFor(async () => {
      const text = await bodyText(client);
      return text.includes('สั่งสร้างบัญชีนักเรียน') && text.includes('สร้างบัญชีนักเรียนเสร็จ');
    }, 'Student-account history did not show the enqueue/completed event pair');
    await selectAction(client, 'STUDENT_ACCOUNT_BATCH_COMPLETED');
    await waitFor(async () => {
      const text = await bodyText(client);
      return text.includes('สร้างบัญชีนักเรียนเสร็จ') && text.includes('สร้างสำเร็จ: 0');
    }, 'Completed student-account batch filter did not show result counts');

    await selectAction(client, '');
    await waitFor(
      async () => (await bodyText(client)).includes('สั่งสร้างบัญชีนักเรียน'),
      'Student-account history did not reset to all actions',
    );
    await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('tr')]
          .find((node) => node.textContent.includes('สั่งสร้างบัญชีนักเรียน'));
        const link = row?.querySelector('a');
        if (!link) throw new Error('Batch enqueue detail link was not found');
        link.click();
      })()`,
    );
    await waitFor(async () => {
      const url = String(await evaluate(client, 'location.href'));
      const text = await bodyText(client);
      return url.includes(`jobId=${encodeURIComponent(completedJob.id)}`) && text.includes('รายละเอียดงาน');
    }, 'Batch enqueue detail link did not open the real job details');

    // --- Link histories: each page gets its own taskType and every backend action stays valid ---
    for (const page of [
      { path: '/login-links/history', title: 'ประวัติลิงก์เข้าสู่ระบบ', taskType: 'LOGIN' },
      { path: '/attendance-links/history', title: 'ประวัติลิงก์เช็คชื่อ', taskType: 'ATTENDANCE' },
      { path: '/visit-links/history', title: 'ประวัติลิงก์ลงพื้นที่', taskType: 'VISIT' },
    ]) {
      await navigate(client, `${FRONTEND_URL}${page.path}`);
      await waitFor(async () => (await bodyText(client)).includes(page.title), `${page.title} did not render`);
      await waitFor(async () => (await bodyText(client)).includes(linkFixtureIds[page.taskType]), `${page.title} did not show its own fixture`);
      const pageText = await bodyText(client);
      for (const [otherType, otherId] of Object.entries(linkFixtureIds)) {
        if (otherType !== page.taskType) {
          assert(!pageText.includes(otherId), `${page.title} leaked ${otherType} history`);
        }
      }
      await verifyActionFilters(client, page.title);
    }

    await navigate(client, `${FRONTEND_URL}/attendance-links/${attendanceLink.id}`);
    await waitFor(
      async () => (await bodyText(client)).includes('ประวัติลิงก์นี้'),
      'Attendance link detail history did not render',
    );
    for (const action of ['LINK_LOCK', 'LINK_UNLOCK']) {
      await selectAction(client, action);
      await waitFor(async () => {
        const text = await bodyText(client);
        return !text.includes('กำลังอัปเดต') && !text.includes('กำลังโหลดประวัติ');
      }, `Attendance detail filter ${action} did not finish`);
      assert(
        !(await bodyText(client)).includes('โหลดประวัติไม่สำเร็จ'),
        `Attendance detail filter ${action} returned an error`,
      );
    }

    // --- Cases history: same shared panel wired to a different domain ---
    await navigate(client, `${FRONTEND_URL}/cases/history`);
    await waitForHistoryPanel(client, 'ประวัติเคสช่วยเหลือนักเรียน');
    assertNoSecretLeak(await bodyText(client), 'Cases history');
    await capture(client, '/tmp/sts-entity-history-cases-desktop.png');

    // --- Mobile render of the users history ---
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/manage-users/history`);
    await waitForHistoryPanel(client, 'ประวัติผู้ใช้งาน');
    await capture(client, '/tmp/sts-entity-history-users-mobile.png');

    console.log(
      'entity history browser smoke passed (shared audit panel, real batch outcome pair/detail link, filters, no secret leak, desktop/mobile)',
    );
  } finally {
    await closeChrome(chrome);
    await disableAdmin(dataSource, adminId);
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
