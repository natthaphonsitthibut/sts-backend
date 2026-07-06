const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run student-accounts browser smoke with NODE_ENV=production');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9238);

const ADMIN_USERNAME = 'student_accounts_browser_admin';
const PERSON_UUID = '10000000-0000-4000-8000-000000000101';
const STUDENT_UUID = '10000000-0000-4000-8000-000000000102';
const STUDENT_PERSON_ID = 'SMOKE-STUDENT-ACCT-BROWSER-001';
const PAGE_SELECTION_USERNAME_PREFIX = 'student_accounts_browser_page_';
const PAGE_SELECTION_COUNT = 22;
const SCHOOL_ID = 10010002;
// grade_levels.id for label 'ม.6' — the candidate query filters by gl.label, so
// the fixture's GradeLevelID_Onec must resolve to this exact grade row.
const GRADE_LEVEL_ID = 423;
const GRADE_LABEL = 'ม.6';
// A room with no other roster rows so the pilot fixture is the ONLY generate
// candidate — keeps the smoke deterministic and never touches real students.
const ROOM_ID = 99;

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-accounts-chrome-'));
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
  const result = await client.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
}

async function bodyText(client) {
  return String(await evaluate(client, 'document.body.innerText'));
}

async function reissueButtonCount(client) {
  return Number(
    await evaluate(
      client,
      `[...document.querySelectorAll('[aria-label]')]
        .filter((node) => node.getAttribute('aria-label').startsWith('ออกรหัสชั่วคราวใหม่ให้')).length`,
    ),
  );
}

async function setSearch(client, value) {
  await waitFor(
    async () =>
      await evaluate(
        client,
        `Boolean(document.querySelector('input[placeholder="ค้นหาชื่อหรือ username..."]'))`,
      ),
    'Management search input did not mount',
  );
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('input[placeholder="ค้นหาชื่อหรือ username..."]');
      if (!input) throw new Error('Management search input not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

async function selectedBulkCount(client) {
  const text = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((node) => node.textContent.includes('ออกรหัสที่เลือก'));
      return button?.textContent || '';
    })()`,
  );
  const match = String(text).match(/\((\d+)\)/);
  return match ? Number(match[1]) : 0;
}

async function clickFirstStudentAccountCheckbox(client) {
  const clicked = await evaluate(
    client,
    `(() => {
      const checkbox = [...document.querySelectorAll('input[type="checkbox"][aria-label^="เลือกบัญชีของ"]')]
        .find((node) => !node.checked && node.offsetParent !== null);
      if (!checkbox) return false;
      checkbox.click();
      return true;
    })()`,
  );
  assert(clicked, 'No selectable student-account row checkbox was found');
}

async function clickNextPage(client) {
  const clicked = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('button[aria-label="หน้าถัดไป"]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`,
  );
  assert(clicked, 'Next page button was not available');
}

async function apiLogin(username, password) {
  const response = await fetch(`${BACKEND_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const raw = await response.text();
  return { status: response.status, body: raw ? JSON.parse(raw) : null, setCookie: response.headers.get('set-cookie') };
}

async function upsertStudentFixture(dataSource) {
  const [school] = await dataSource.query(`SELECT id FROM schools WHERE id = $1`, [SCHOOL_ID]);
  assert(school, `Smoke school ${SCHOOL_ID} is missing in sts_smoke`);
  await dataSource.query(
    `INSERT INTO student_person (person_uuid, identity_status)
     VALUES ($1::uuid, 'ACTIVE')
     ON CONFLICT (person_uuid) DO UPDATE
     SET identity_status = 'ACTIVE', merged_into = NULL, deleted_at = NULL, deleted_by = NULL`,
    [PERSON_UUID],
  );
  await dataSource.query(
    `INSERT INTO student_term (
       student_uuid, person_uuid, "PersonID_Onec", "FirstName_Onec", "LastName_Onec",
       "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec", "StudentStatusID_Onec",
       "AcademicYear_Onec", "Semester_Onec", "ProvinceNameThai_Onec",
       "DistrictNameThai_Onec", "SubDistrictNameThai_Onec", deleted_at, deleted_by
     )
     VALUES ($1::uuid, $2::uuid, $3, 'Smoke', 'Student Browser', $4, $5, $6, 10,
             2569, 1, 'กรุงเทพมหานคร', 'ดอนเมือง', 'สีกัน', NULL, NULL)
     ON CONFLICT (student_uuid) DO UPDATE
     SET person_uuid = EXCLUDED.person_uuid, "PersonID_Onec" = EXCLUDED."PersonID_Onec",
         "FirstName_Onec" = EXCLUDED."FirstName_Onec", "LastName_Onec" = EXCLUDED."LastName_Onec",
         "SchoolID_Onec" = EXCLUDED."SchoolID_Onec", "GradeLevelID_Onec" = EXCLUDED."GradeLevelID_Onec",
         "RoomID_Onec" = EXCLUDED."RoomID_Onec", "StudentStatusID_Onec" = 10,
         "AcademicYear_Onec" = EXCLUDED."AcademicYear_Onec", "Semester_Onec" = EXCLUDED."Semester_Onec",
         deleted_at = NULL, deleted_by = NULL`,
    [STUDENT_UUID, PERSON_UUID, STUDENT_PERSON_ID, SCHOOL_ID, GRADE_LEVEL_ID, ROOM_ID],
  );
}

async function upsertPageSelectionFixtures(dataSource, passwordHash) {
  for (let index = 1; index <= PAGE_SELECTION_COUNT; index += 1) {
    const suffix = String(index).padStart(3, '0');
    const personUuid = `10000000-0000-4000-8000-000000001${suffix}`;
    const studentUuid = `10000000-0000-4000-8000-000000002${suffix}`;
    const username = `${PAGE_SELECTION_USERNAME_PREFIX}${suffix}`;
    const personId = `SMOKE-STUDENT-ACCT-BROWSER-PAGE-${suffix}`;

    await dataSource.query(
      `INSERT INTO student_person (person_uuid, identity_status)
       VALUES ($1::uuid, 'ACTIVE')
       ON CONFLICT (person_uuid) DO UPDATE
       SET identity_status = 'ACTIVE', merged_into = NULL, deleted_at = NULL, deleted_by = NULL`,
      [personUuid],
    );
    await dataSource.query(
      `INSERT INTO student_term (
         student_uuid, person_uuid, "PersonID_Onec", "FirstName_Onec", "LastName_Onec",
         "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec", "StudentStatusID_Onec",
         "AcademicYear_Onec", "Semester_Onec", "ProvinceNameThai_Onec",
         "DistrictNameThai_Onec", "SubDistrictNameThai_Onec", deleted_at, deleted_by
       )
       VALUES ($1::uuid, $2::uuid, $3, 'Smoke Page', $4, $5, $6, $7, 10,
               2569, 1, 'กรุงเทพมหานคร', 'ดอนเมือง', 'สีกัน', NULL, NULL)
       ON CONFLICT (student_uuid) DO UPDATE
       SET person_uuid = EXCLUDED.person_uuid,
           "PersonID_Onec" = EXCLUDED."PersonID_Onec",
           "FirstName_Onec" = EXCLUDED."FirstName_Onec",
           "LastName_Onec" = EXCLUDED."LastName_Onec",
           "SchoolID_Onec" = EXCLUDED."SchoolID_Onec",
           "GradeLevelID_Onec" = EXCLUDED."GradeLevelID_Onec",
           "RoomID_Onec" = EXCLUDED."RoomID_Onec",
           "StudentStatusID_Onec" = 10,
           "AcademicYear_Onec" = EXCLUDED."AcademicYear_Onec",
           "Semester_Onec" = EXCLUDED."Semester_Onec",
           deleted_at = NULL,
           deleted_by = NULL`,
      [studentUuid, personUuid, personId, `Selection ${suffix}`, SCHOOL_ID, GRADE_LEVEL_ID, ROOM_ID],
    );

    const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
      username,
    ]);
    if (existing) {
      await dataSource.query(
        `UPDATE users
         SET password = $2,
             "FirstName" = 'Smoke Page',
             "LastName" = $3,
             status = 'ACTIVE',
             permissions = '[]'::jsonb,
             role = 'STUDENT',
             data_scope = '{"own_only":true}'::jsonb,
             person_uuid = $4::uuid,
             must_change_password = TRUE,
             temporary_password_issued_at = NOW(),
             temporary_password_expires_at = NOW() + INTERVAL '7 days',
             deactivated_at = NULL,
             deactivated_by = NULL,
             deactivation_reason_code = NULL,
             deactivation_note = NULL,
             data_origin_code = 'AUTOMATED_TEST',
             email = NULL,
             phone = NULL
         WHERE id = $1`,
        [existing.id, passwordHash, `Selection ${suffix}`, personUuid],
      );
    } else {
      await dataSource.query(
        `INSERT INTO users (
           username, password, "FirstName", "LastName", status, permissions, role,
           data_scope, person_uuid, must_change_password, temporary_password_issued_at,
           temporary_password_expires_at, data_origin_code, email, phone
         )
         VALUES (
           $1, $2, 'Smoke Page', $3, 'ACTIVE', '[]'::jsonb, 'STUDENT',
           '{"own_only":true}'::jsonb, $4::uuid, TRUE, NOW(), NOW() + INTERVAL '7 days',
           'AUTOMATED_TEST', NULL, NULL
         )`,
        [username, passwordHash, `Selection ${suffix}`, personUuid],
      );
    }
  }
}

async function cleanupSmoke(dataSource) {
  // Disable (never DELETE) this smoke's rows: the pilot account accrues
  // immutable audit_log history, and deleting it would fire an ON DELETE audit
  // UPDATE that the append-only trigger rejects. Each run reactivates the
  // existing account instead of regenerating.
  await dataSource.query(
    `UPDATE users
     SET status = 'DISABLED',
         deactivated_at = COALESCE(deactivated_at, NOW()),
         deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
         deactivation_note = COALESCE(deactivation_note, 'Retained automated student account browser smoke fixture')
     WHERE username = $1
        OR username LIKE $3
        OR (role = 'STUDENT' AND person_uuid = $2::uuid)`,
    [ADMIN_USERNAME, PERSON_UUID, `${PAGE_SELECTION_USERNAME_PREFIX}%`],
  );
}

async function findStudentAccount(dataSource) {
  const [row] = await dataSource.query(
    `SELECT id, username FROM users WHERE role = 'STUDENT' AND person_uuid = $1::uuid ORDER BY id DESC LIMIT 1`,
    [PERSON_UUID],
  );
  return row || null;
}

async function upsertAdmin(dataSource, passwordHash) {
  const permissions = ['manage-student-accounts', 'manage-users-list'];
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [ADMIN_USERNAME]);
  if (existing) {
    await dataSource.query(
      `UPDATE users
       SET password = $2, "FirstName" = 'Student', "LastName" = 'Accounts Browser',
           status = 'ACTIVE', permissions = $3::jsonb, role = 'ADMIN',
           data_scope = '{"global":true}'::jsonb, must_change_password = FALSE,
           deactivated_at = NULL, deactivated_by = NULL,
           deactivation_reason_code = NULL, deactivation_note = NULL,
           data_origin_code = 'AUTOMATED_TEST'
       WHERE id = $1`,
      [existing.id, passwordHash, JSON.stringify(permissions)],
    );
    return existing.id;
  }
  const [row] = await dataSource.query(
    `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions, role,
       data_scope, must_change_password, data_origin_code)
     VALUES ($1, $2, 'Student', 'Accounts Browser', 'ACTIVE', $3::jsonb, 'ADMIN',
             '{"global":true}'::jsonb, FALSE, 'AUTOMATED_TEST')
     RETURNING id`,
    [ADMIN_USERNAME, passwordHash, JSON.stringify(permissions)],
  );
  return row.id;
}

async function clickConfirmButton(client, label) {
  const clicked = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((node) => node.textContent.trim() === ${JSON.stringify(label)});
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert(clicked, `Confirm button "${label}" was not found`);
}

// The reissued credential renders inline in a CredentialTable inside the
// "ออกรหัสใหม่แล้ว" panel: username in a plain mono cell, temp password in a
// bold mono cell. Scope to that panel so the management row's own @username
// (also mono) is never mistaken for the password.
async function readReissuedPassword(client) {
  return String(
    await evaluate(
      client,
      `(() => {
        const title = [...document.querySelectorAll('*')]
          .find((node) => node.children.length === 0 && node.textContent.trim().startsWith('ออกรหัสใหม่แล้ว'));
        if (!title) return '';
        let panel = title;
        for (let i = 0; i < 10 && panel.parentElement; i += 1) {
          panel = panel.parentElement;
          if (panel.querySelector('.font-mono.font-bold')) break;
        }
        const cell = [...panel.querySelectorAll('.font-mono.font-bold')]
          .find((node) => node.textContent.trim().length > 0);
        return cell ? cell.textContent.trim().replace(/^@/, '') : '';
      })()`,
    ),
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminPassword = `Accounts-${suffix}-Password`;
  let chrome;

  try {
    await upsertStudentFixture(dataSource);
    await cleanupSmoke(dataSource);
    const adminPasswordHash = await passwordService.hash(adminPassword);
    await upsertAdmin(dataSource, adminPasswordHash);
    await upsertPageSelectionFixtures(dataSource, adminPasswordHash);

    const adminSession = await apiLogin(ADMIN_USERNAME, adminPassword);
    assert(adminSession.status === 201, `Admin login returned ${adminSession.status}`);
    const cookie = adminSession.setCookie.split(';')[0];

    // Ensure exactly one ACTIVE pilot student account: reactivate the existing
    // one (cleanup disabled it) or generate a fresh one when none exists.
    let account = await findStudentAccount(dataSource);
    if (account) {
      const reactivate = await fetch(
        `${BACKEND_URL}/api/users/student-accounts/${account.id}/reactivate`,
        { method: 'POST', headers: { 'content-type': 'application/json', cookie } },
      );
      assert(reactivate.status === 201, `Reactivate returned ${reactivate.status}`);
    } else {
      const generateResponse = await fetch(`${BACKEND_URL}/api/users/student-accounts/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ schoolId: SCHOOL_ID, grade: GRADE_LABEL, room: ROOM_ID, limit: 1 }),
      });
      const generated = await generateResponse.json();
      assert(generateResponse.status === 201, `Generate returned ${generateResponse.status}`);
      assert(generated.createdCount === 1, `Generate created ${generated.createdCount} accounts, expected 1`);
      account = { id: generated.credentials?.[0]?.userId, username: generated.credentials?.[0]?.username };
    }
    assert(account?.id && account?.username, 'Could not resolve the pilot student account');
    const studentUsername = account.username;

    // Rotate once via the API to establish a known "current" password so the
    // UI reissue can be proven to rotate it again (and invalidate this one).
    const apiReissue = await fetch(
      `${BACKEND_URL}/api/users/student-accounts/${account.id}/reissue-temporary-password`,
      { method: 'POST', headers: { 'content-type': 'application/json', cookie } },
    );
    const apiReissueBody = await apiReissue.json();
    assert(apiReissue.status === 201 && apiReissueBody?.tempPassword, `API reissue returned ${apiReissue.status}`);
    const originalTempPassword = apiReissueBody.tempPassword;

    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await client.call('Network.setCookie', {
      name: adminSession.setCookie.split('=')[0],
      value: cookie.split('=').slice(1).join('='),
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });

    await navigate(client, `${FRONTEND_URL}/admin-access`);
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(adminSession.body))});
       localStorage.setItem('admin_access', 'true');`,
    );

    // --- Management list renders the pilot student, with status + pagination ---
    await navigate(client, `${FRONTEND_URL}/manage-student-accounts`);
    await waitFor(async () => (await bodyText(client)).includes('บัญชีนักเรียน'), 'Student accounts page did not render');
    await setSearch(client, PAGE_SELECTION_USERNAME_PREFIX);
    await waitFor(
      async () =>
        (await bodyText(client)).includes(PAGE_SELECTION_USERNAME_PREFIX) &&
        (await bodyText(client)).includes('แสดง 1-20 จาก 22 บัญชี'),
      'Cross-page selection fixture list did not render as two pages',
    );
    await clickFirstStudentAccountCheckbox(client);
    await waitFor(async () => (await selectedBulkCount(client)) === 1, 'Selecting page 1 did not update the bulk count');
    await clickNextPage(client);
    await waitFor(
      async () => (await bodyText(client)).includes('แสดง 21-22 จาก 22 บัญชี'),
      'Student account list did not navigate to page 2',
    );
    assert(
      (await selectedBulkCount(client)) === 1,
      'Bulk selection did not persist after moving to page 2',
    );
    await clickFirstStudentAccountCheckbox(client);
    await waitFor(async () => (await selectedBulkCount(client)) === 2, 'Selecting page 2 did not accumulate the bulk count');
    await capture(client, '/tmp/sts-student-accounts-cross-page-selection.png');

    await setSearch(client, studentUsername);
    // Search narrows to the generated account; confirm its row and reissue action.
    await waitFor(
      async () => (await bodyText(client)).includes(`@${studentUsername}`) && (await reissueButtonCount(client)) > 0,
      'Management list did not render the generated student account row',
    );
    assert((await bodyText(client)).includes('สถานะบัญชี'), 'Management list is missing the account-status column');
    // Pagination (rows-per-page control) confirms the list is a real paginated view.
    await waitFor(
      async () =>
        await evaluate(
          client,
          `Boolean(document.querySelector('[aria-label="จำนวนรายการต่อหน้า"]')) ||
           document.body.innerText.includes(' จาก ')`,
        ),
      'Management list did not render pagination',
    );
    await capture(client, '/tmp/sts-student-accounts-manage-desktop.png');

    // --- Staff list must exclude student accounts ---
    await navigate(client, `${FRONTEND_URL}/manage-users`);
    await waitFor(async () => (await bodyText(client)).includes('ผู้ใช้งาน'), 'Staff user list did not render');
    assert(
      !(await bodyText(client)).includes(studentUsername),
      'Staff user list leaked a student account',
    );

    // --- Reissue via the row action -> credential dialog reveals a new password ---
    await navigate(client, `${FRONTEND_URL}/manage-student-accounts`);
    await waitFor(async () => (await bodyText(client)).includes('บัญชีนักเรียน'), 'Student accounts page did not re-render');
    await setSearch(client, studentUsername);
    await waitFor(
      async () => (await bodyText(client)).includes(`@${studentUsername}`) && (await reissueButtonCount(client)) > 0,
      'Reissue button did not appear for the generated student',
    );
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('[aria-label]')]
          .find((node) => node.getAttribute('aria-label').startsWith('ออกรหัสชั่วคราวใหม่ให้'));
        if (!button) throw new Error('Reissue button not found');
        button.click();
      })()`,
    );
    // Reissue asks for confirmation before rotating.
    await waitFor(
      async () =>
        await evaluate(
          client,
          `Boolean([...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'ออกรหัสใหม่'))`,
        ),
      'Reissue confirmation dialog did not open',
    );
    await clickConfirmButton(client, 'ออกรหัสใหม่');
    await waitFor(
      async () => (await bodyText(client)).includes('ออกรหัสใหม่แล้ว') && (await readReissuedPassword(client)).length > 0,
      'Reissue did not reveal the rotated credential',
    );
    const newPassword = await readReissuedPassword(client);
    assert(newPassword !== originalTempPassword, 'Reissue did not rotate the temporary password');
    await capture(client, '/tmp/sts-student-accounts-reissue-desktop.png');

    // --- The revealed credential works end-to-end and forces a password change ---
    const reissuedLogin = await apiLogin(studentUsername, newPassword);
    assert(reissuedLogin.status === 201, `Student login with reissued password returned ${reissuedLogin.status}`);
    assert(reissuedLogin.body?.must_change_password === true, 'Reissued student login did not force a password change');
    const staleLogin = await apiLogin(studentUsername, originalTempPassword);
    assert(staleLogin.status !== 201, `Old password unexpectedly logged in with status ${staleLogin.status}`);

    // --- Mobile render of the management list ---
    await client.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate(client, `${FRONTEND_URL}/manage-student-accounts`);
    await setSearch(client, studentUsername);
    await waitFor(async () => (await bodyText(client)).includes(`@${studentUsername}`), 'Mobile management list did not render the student');
    await capture(client, '/tmp/sts-student-accounts-manage-mobile.png');

    console.log(
      'student accounts browser smoke passed (management render, cross-page selection, staff excludes students, UI reissue reveals rotated credential, student re-login forces change, desktop/mobile)',
    );
  } finally {
    await closeChrome(chrome);
    await cleanupSmoke(dataSource);
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
