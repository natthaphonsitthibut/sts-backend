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
const ALL_PERMISSIONS = [
  'home', 'dashboard', 'students', 'manage-students', 'dashboard', 'dashboard',
  'dashboard', 'student-self', 'dashboard', 'import-data', 'attendance',
  'attendance', 'manage-users-list', 'manage-users-list',
  'manage-role-groups', 'settings',
  'audit-log', 'audit-log:all',
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

async function waitForHistoryPanel(client, panelTitle) {
  try {
    await waitFor(async () => {
      const text = await bodyText(client);
      return text.includes(panelTitle) && (await detailLinkCount(client)) > 0;
    }, `History panel "${panelTitle}" did not render with rows`);
  } catch (error) {
    const diagnostic = await evaluate(
      client,
      `JSON.stringify({ path: location.pathname, text: document.body.innerText.slice(0, 1200) })`,
    );
    throw new Error(`${errorMessage(error)}: ${diagnostic}`);
  }
}

async function comboboxOptions(client, inputId) {
  // The base Combobox is an <input>; focusing it opens a portalled <ul> of
  // option buttons. innerText's first line is the label (a description may follow).
  await evaluate(
    client,
    `(() => {
      const input = document.getElementById(${JSON.stringify(inputId)});
      if (!input) throw new Error('Combobox not found: ' + ${JSON.stringify(inputId)});
      input.blur();
    })()`,
  );
  // The input's blur closes the panel on a 120ms timer; let it lapse before
  // reopening, or it shuts the panel this focus just opened.
  await new Promise((resolve) => setTimeout(resolve, 250));
  await evaluate(
    client,
    `(() => {
      const input = document.getElementById(${JSON.stringify(inputId)});
      input.focus();
      input.click();
    })()`,
  );
  await waitFor(
    async () => (await evaluate(client, `document.querySelectorAll('ul.fixed button').length`)) > 0,
    `Combobox ${inputId} did not open`,
  );
  return JSON.parse(
    await evaluate(
      client,
      `JSON.stringify([...document.querySelectorAll('ul.fixed button')].map((button) => button.innerText.split('\\n')[0].trim()))`,
    ),
  );
}

async function pickComboboxOption(client, inputId, label) {
  const labels = await comboboxOptions(client, inputId);
  assert(labels.includes(label), `Option "${label}" missing from ${inputId}; have: ${labels.join(', ')}`);
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('ul.fixed button')]
        .find((entry) => entry.innerText.split('\\n')[0].trim() === ${JSON.stringify(label)});
      button.click();
    })()`,
  );
  try {
    await waitFor(
      async () => (await evaluate(client, `document.querySelectorAll('ul.fixed button').length`)) === 0,
      `Combobox ${inputId} did not close after picking "${label}"`,
    );
  } catch (error) {
    const diagnostic = await evaluate(
      client,
      `JSON.stringify({ active: document.activeElement?.id, value: document.getElementById(${JSON.stringify(inputId)})?.value, options: [...document.querySelectorAll('ul.fixed button')].map((b) => b.innerText).slice(0, 12) })`,
    );
    throw new Error(`${errorMessage(error)}: ${diagnostic}`);
  }
}

async function waitForAuditIdle(client, message) {
  await waitFor(async () => {
    const text = await bodyText(client);
    return !text.includes('กำลังอัปเดต') && !text.includes('กำลังโหลดประวัติ');
  }, message);
  assert(!(await bodyText(client)).includes('โหลดประวัติไม่สำเร็จ'), `${message}: the log returned an error`);
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
    adminId = await upsertAdmin(dataSource, await passwordService.hash(password));
    // Pick a school through the shared header so the student history remains
    // scoped even when the page no longer shows a school-first empty state.
    const [historySchool] = await dataSource.query(
      `SELECT id FROM schools ORDER BY id LIMIT 1`,
    );
    assert(historySchool?.id, 'History smoke needs at least one school in scope');
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
    const session = await login(password);

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

    // The tab moved under the management page; the retired path must redirect
    // rather than fall through to `students/:id` and ask for a student called
    // "history".
    await navigate(client, `${FRONTEND_URL}/students/history`);
    await waitFor(
      async () => (await evaluate(client, 'location.pathname')) === '/manage-students/history',
      'Retired student history path did not redirect to the management route',
    );
    // The school comes from the header's shared filter, not the URL.
    await evaluate(
      client,
      `localStorage.setItem('sts_school_filter', ${JSON.stringify(
        JSON.stringify({
          province: '',
          district: '',
          subDistrict: '',
          schoolId: String(historySchool.id),
          schoolName: '',
          userId: session.user.id,
        }),
      )}); true`,
    );
    await navigate(client, `${FRONTEND_URL}/manage-students/history`);
    await waitForHistoryPanel(client, 'ประวัติข้อมูลนักเรียน');
    assertNoSecretLeak(await bodyText(client), 'Student history (unfiltered)');
    await capture(client, '/tmp/sts-entity-history-students-desktop.png');

    // One หมวด only on this panel, so it offers no หมวด picker.
    assert(
      (await evaluate(client, `document.getElementById('audit-category') === null`)) === true,
      'Student history shows a category picker although it holds a single category',
    );
    await pickComboboxOption(client, 'audit-action', 'แก้ไขข้อมูลนักเรียน');
    await waitForAuditIdle(client, 'Action filter STUDENT_UPDATE did not finish');
    assert(
      (await evaluate(client, `new URLSearchParams(location.search).get('auditAction')`)) === 'STUDENT_UPDATE',
      'Picking an action did not reach the URL',
    );
    assertNoSecretLeak(await bodyText(client), 'Student history (filtered)');

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/manage-students/history`);
    await waitForHistoryPanel(client, 'ประวัติข้อมูลนักเรียน');
    await capture(client, '/tmp/sts-entity-history-students-mobile.png');

    await navigate(client, `${FRONTEND_URL}/council/audit-log`);
    await waitFor(async () => {
      const body = await bodyText(client);
      return body.includes('บันทึกการใช้งาน') && body.includes('รายการทั้งหมด') &&
        !body.includes('กำลังโหลดประวัติ');
    }, 'Council audit log did not render');
    assert(!(await bodyText(client)).includes('โหลดประวัติไม่สำเร็จ'), 'Council audit log returned an error');
    assertNoSecretLeak(await bodyText(client), 'Council audit log');
    await capture(client, '/tmp/sts-entity-history-council-mobile.png');

    // หมวด narrows ประเภท, and both reach the API as the backend's own vocabulary.
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    const categories = await comboboxOptions(client, 'audit-category');
    for (const label of ['ทุกหมวด', 'บัญชีผู้ใช้', 'นักเรียน', 'ลิงก์และสิทธิ์เข้าถึงของครู']) {
      assert(categories.includes(label), `Category "${label}" missing; have: ${categories.join(', ')}`);
    }
    await pickComboboxOption(client, 'audit-category', 'บัญชีผู้ใช้');
    await waitForAuditIdle(client, 'Category filter did not finish');
    assert(
      (await evaluate(client, `new URLSearchParams(location.search).get('auditCategory')`)) === 'accounts',
      'Picking a category did not reach the URL',
    );
    const accountActions = await comboboxOptions(client, 'audit-action');
    assert(accountActions.includes('สร้างผู้ใช้งาน'), 'Account category lost its own actions');
    assert(
      !accountActions.includes('เปิดเคส') && !accountActions.includes('แก้ไขข้อมูลนักเรียน'),
      `Account category still lists other categories' actions: ${accountActions.join(', ')}`,
    );
    // Headless Chrome fires no blur here, so close the panel by picking.
    await pickComboboxOption(client, 'audit-action', 'ทุกประเภท');
    await capture(client, '/tmp/sts-entity-history-council-category-desktop.png');

    const filtered = JSON.parse(
      await evaluate(
        client,
        `fetch(${JSON.stringify(`${BACKEND_URL}/api/audit-log?domain=all&category=accounts&limit=20`)}, { credentials: 'include' })
          .then((response) => response.json()).then((body) => JSON.stringify(body.data.map((entry) => entry.action)))`,
      ),
    );
    assert(filtered.length > 0, 'Category smoke needs at least one account event in the log');
    assert(
      filtered.every((action) => action.startsWith('USER_')),
      `category=accounts returned other categories: ${[...new Set(filtered)].join(', ')}`,
    );

    // The picked school has student events (the history panel above listed
    // them), so this หมวด must still show rows — and only its own.
    await pickComboboxOption(client, 'audit-category', 'นักเรียน');
    await waitForAuditIdle(client, 'Student category filter did not finish');
    assert((await detailLinkCount(client)) > 0, 'Student category shows no rows for a school with student history');
    const studentLabels = (await comboboxOptions(client, 'audit-action')).filter((label) => label !== 'ทุกประเภท');
    await pickComboboxOption(client, 'audit-action', 'ทุกประเภท');
    const shownTypes = JSON.parse(
      await evaluate(
        client,
        `JSON.stringify([...new Set([...document.querySelectorAll('table tbody tr td:nth-child(2)')].map((cell) => cell.innerText.trim()))])`,
      ),
    );
    assert(shownTypes.length > 0, 'Student category rows carry no type badge');
    assert(
      shownTypes.every((label) => studentLabels.includes(label)),
      `Student category shows other categories' rows: ${shownTypes.join(', ')}`,
    );
    await capture(client, '/tmp/sts-entity-history-council-students-desktop.png');

    // Opening a national id is one event in two linked places: the PDPA access
    // record and the row this page lists under its own category.
    const [revealStudent] = await dataSource.query(
      `SELECT student_uuid::text AS id FROM student_term
       WHERE "SchoolID_Onec" = $1 AND COALESCE("PersonID_Onec", '') <> ''
       ORDER BY student_uuid LIMIT 1`,
      [historySchool.id],
    );
    assert(revealStudent?.id, 'PDPA smoke needs a student with a national id in the picked school');
    const revealStatus = await evaluate(
      client,
      `fetch(${JSON.stringify(`${BACKEND_URL}/api/students/${revealStudent.id}/pii-reveal`)}, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_group: 'NATIONAL_ID', reason_code: 'VERIFY_DATA' }),
      }).then((response) => response.status)`,
    );
    assert(revealStatus === 200 || revealStatus === 201, `National id reveal answered ${revealStatus}`);
    // A reveal repeated inside the reveal window writes nothing new, so accept
    // the row an earlier run left within that window.
    const [linkedReveal] = await dataSource.query(
      `SELECT audit.action, audit.target_type, audit.metadata ->> 'reasonLabel' AS reason_label,
              audit.metadata -> 'scope' -> 'school_ids' ->> 0 AS school_id
       FROM pii_access_events event
       JOIN audit_log audit ON audit.id = event.audit_log_id
       WHERE event.actor_user_id = $1 AND audit.target_id = $2
         AND event.field_group = 'NATIONAL_ID'
         AND event.created_at > now() - interval '20 minutes'
       ORDER BY event.id DESC LIMIT 1`,
      [adminId, revealStudent.id],
    );
    assert(linkedReveal, 'National id reveal wrote no access record linked to an audit row');
    assert(
      linkedReveal.action === 'STUDENT_NATIONAL_ID_VIEW' && linkedReveal.target_type === 'student',
      `Reveal audit row is wrong: ${JSON.stringify(linkedReveal)}`,
    );
    assert(linkedReveal.reason_label === 'ตรวจสอบ/แก้ไขข้อมูล', 'Reveal audit row lost its reason');
    assert(
      String(linkedReveal.school_id) === String(historySchool.id),
      'Reveal audit row is not scoped to the student school',
    );

    await pickComboboxOption(client, 'audit-category', 'ข้อมูลส่วนบุคคล (PDPA)');
    await waitForAuditIdle(client, 'PDPA category filter did not finish');
    assert((await detailLinkCount(client)) > 0, 'PDPA category shows no rows after a reveal');
    const pdpaTypes = JSON.parse(
      await evaluate(
        client,
        `JSON.stringify([...new Set([...document.querySelectorAll('table tbody tr td:nth-child(2)')].map((cell) => cell.innerText.trim()))])`,
      ),
    );
    assert(
      pdpaTypes.includes('เปิดดูเลขบัตรประชาชนนักเรียน'),
      `PDPA category does not list the national id reveal: ${pdpaTypes.join(', ')}`,
    );
    assert(
      pdpaTypes.every((label) => label.startsWith('เปิดดู')),
      `PDPA category shows other categories' rows: ${pdpaTypes.join(', ')}`,
    );
    assertNoSecretLeak(await bodyText(client), 'Council audit log (PDPA category)');
    await capture(client, '/tmp/sts-entity-history-council-pdpa-desktop.png');

    console.log(
      'entity history browser smoke passed (student history, council audit with category filter and PDPA reveal rows, no secret leak, desktop/mobile)',
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
