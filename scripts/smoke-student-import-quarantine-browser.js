const { createHash, randomUUID } = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run import-quarantine browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9239);

const SMOKE_KEY = 'import-quarantine-browser-smoke';
const ADMIN_USERNAME = 'import_quarantine_browser_admin';
const SCHOOL_ID = 10010002;
const GRADE_LEVEL_ID = 423;
const RAW_IDENTIFIER = '9700000000041'; // must be masked in the UI, never shown raw
const SEEDED_REASONS = [
  { code: 'DUPLICATE_ROW_IN_FILE', label: 'แถวซ้ำในไฟล์' },
  { code: 'GRADE_NOT_FOUND', label: 'ไม่พบชั้นเรียนในข้อมูลหลัก' },
  { code: 'ROOM_NOT_FOUND', label: 'ไม่พบห้องเรียนในข้อมูลหลัก' },
  { code: 'UNMAPPED_STUDENT_STATUS', label: 'สถานะนักเรียนยังไม่จับคู่' },
  { code: 'IDENTIFIER_CONFLICT', label: 'เลขนี้ตรงกับหลายโปรไฟล์ในระบบ' },
];
// Filter to a reason whose row offers the inline "แก้ไขข้อมูล" edit drawer
// (DUPLICATE_ROW_IN_FILE is reject-only, so use GRADE_NOT_FOUND).
const FILTER_REASON = SEEDED_REASONS[1];

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-quarantine-chrome-'));
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

// Every quarantine row prints a "สาเหตุ:" reason line (once per row in the
// mobile cards) regardless of which resolution actions it offers — an
// action-agnostic per-row count (IDENTIFIER_CONFLICT rows have no edit button).
async function rowCount(client) {
  return Number(
    await evaluate(client, `(document.body.innerText.match(/สาเหตุ:/g) || []).length`),
  );
}

async function selectReasonFilter(client, code) {
  await evaluate(
    client,
    `(() => {
      const trigger = document.querySelector('[aria-label="กรองตามสาเหตุ"]');
      if (!trigger) throw new Error('Reason filter not found');
      const select = trigger.parentElement?.querySelector('select');
      if (!select) throw new Error('Hidden native reason select not found');
      const values = [...select.querySelectorAll('option')].map((option) => option.value);
      if (!values.includes(${JSON.stringify(code)})) {
        throw new Error('Reason option missing (' + ${JSON.stringify(code)} + '); have: ' + values.join(','));
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, ${JSON.stringify(code)});
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

async function cleanupSeed(dataSource) {
  await dataSource.query(
    `DELETE FROM student_import_quarantine_rows q
     USING student_import_batches b
     WHERE q.batch_id = b.id AND b.scope_snapshot->>'smoke_key' = $1`,
    [SMOKE_KEY],
  );
  await dataSource.query(`DELETE FROM student_import_batches WHERE scope_snapshot->>'smoke_key' = $1`, [SMOKE_KEY]);
  await dataSource.query(
    `UPDATE users SET status = 'DISABLED', deactivated_at = COALESCE(deactivated_at, NOW()),
       deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
       deactivation_note = COALESCE(deactivation_note, 'Import quarantine browser smoke fixture')
     WHERE username = $1`,
    [ADMIN_USERNAME],
  );
}

async function upsertAdmin(dataSource, passwordHash) {
  const permissions = ['home', 'import-data'];
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [ADMIN_USERNAME]);
  if (existing) {
    await dataSource.query(
      `UPDATE users SET password = $2, "FirstName" = 'Import', "LastName" = 'Quarantine Browser',
         status = 'ACTIVE', permissions = $3::jsonb, role = 'ADMIN', data_scope = '{"global":true}'::jsonb,
         must_change_password = FALSE, deactivated_at = NULL, deactivated_by = NULL,
         deactivation_reason_code = NULL, deactivation_note = NULL, data_origin_code = 'AUTOMATED_TEST'
       WHERE id = $1`,
      [existing.id, passwordHash, JSON.stringify(permissions)],
    );
    return existing.id;
  }
  const [created] = returningRows(
    await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions, role,
         data_scope, must_change_password, data_origin_code)
       VALUES ($1, $2, 'Import', 'Quarantine Browser', 'ACTIVE', $3::jsonb, 'ADMIN',
               '{"global":true}'::jsonb, FALSE, 'AUTOMATED_TEST')
       RETURNING id`,
      [ADMIN_USERNAME, passwordHash, JSON.stringify(permissions)],
    ),
  );
  return created.id;
}

async function seedQuarantine(dataSource, actorId) {
  const [batch] = returningRows(
    await dataSource.query(
      `INSERT INTO student_import_batches (
         target, source_sha256, scope_snapshot, status, total_rows,
         quarantined_rows, completed_at, created_by, updated_by
       ) VALUES ('student_term', $1, $2::jsonb, 'PARTIAL', $3, $3, NOW(), $4, $4)
       RETURNING id`,
      [
        createHash('sha256').update(randomUUID()).digest('hex'),
        JSON.stringify({ smoke_key: SMOKE_KEY }),
        SEEDED_REASONS.length,
        actorId,
      ],
    ),
  );
  for (const [index, reason] of SEEDED_REASONS.entries()) {
    await dataSource.query(
      `INSERT INTO student_import_quarantine_rows (
         batch_id, school_id, source_row_number, row_fingerprint, reason_code, mapped_values, created_by, updated_by
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
      [
        batch.id,
        SCHOOL_ID,
        index + 2,
        createHash('sha256').update(`${batch.id}:${index}`).digest('hex'),
        reason.code,
        JSON.stringify({
          PersonID_Onec: RAW_IDENTIFIER,
          FirstName_Onec: 'Quarantine',
          LastName_Onec: `Row ${index + 1}`,
          SchoolID_Onec: SCHOOL_ID,
          GradeLevelID_Onec: GRADE_LEVEL_ID,
          RoomID_Onec: index + 1,
          AcademicYear_Onec: 2599,
          Semester_Onec: 1,
        }),
        actorId,
      ],
    );
  }
  return batch.id;
}

async function login(password) {
  const response = await fetch(`${BACKEND_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password }),
  });
  assert(response.status === 201, `Quarantine fixture login returned ${response.status}`);
  const user = await response.json();
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  assert(setCookie, 'Login did not return a session cookie');
  const [cookiePair] = setCookie.split(';');
  const separator = cookiePair.indexOf('=');
  return { user, cookieName: cookiePair.slice(0, separator), cookieValue: cookiePair.slice(separator + 1) };
}

async function waitForQuarantineList(client) {
  // Edit action per row signals the seeded rows rendered, unlike reason-label
  // text which also appears in the hidden filter <select>.
  await waitFor(
    async () => (await rowCount(client)) >= SEEDED_REASONS.length,
    'Quarantine list did not render the seeded rows',
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = `Quarantine-${suffix}-Password`;
  let chrome;

  try {
    await cleanupSeed(dataSource);
    const adminId = await upsertAdmin(dataSource, await passwordService.hash(password));
    await seedQuarantine(dataSource, adminId);
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

    await navigate(client, `${FRONTEND_URL}/admin-access`);
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(session.user))});
       localStorage.setItem('admin_access', 'true');`,
    );

    // --- Quarantine list renders the seeded rows with reason labels ---
    await navigate(client, `${FRONTEND_URL}/import-data/quarantine`);
    await waitForQuarantineList(client);
    const listText = await bodyText(client);
    for (const reason of SEEDED_REASONS) {
      assert(listText.includes(reason.label), `Quarantine list missing reason label "${reason.label}"`);
    }
    // The raw national ID must be masked (e.g. ••••0041), never printed in full.
    assert(!listText.includes(RAW_IDENTIFIER), 'Quarantine list leaked the raw national ID');
    const unfilteredRows = await rowCount(client);
    await capture(client, '/tmp/sts-import-quarantine-list-desktop.png');

    // --- Reason filter narrows the list ---
    await selectReasonFilter(client, FILTER_REASON.code);
    await waitFor(async () => {
      const rows = await rowCount(client);
      return rows > 0 && rows < unfilteredRows;
    }, 'Reason filter did not narrow the quarantine list');
    assert((await bodyText(client)).includes(FILTER_REASON.label), 'Filtered list lost the target reason');

    // Reset the filter so the full list (with editable rows) returns.
    await selectReasonFilter(client, '');
    await waitFor(async () => (await rowCount(client)) >= SEEDED_REASONS.length, 'Clearing the reason filter did not restore the list');

    // --- Inline edit drawer opens on an editable row and stays PII-safe ---
    await waitFor(
      async () =>
        await evaluate(
          client,
          `Boolean([...document.querySelectorAll('a,button')].find((node) => node.textContent.trim() === 'แก้ไขข้อมูล'))`,
        ),
      'No editable quarantine row was available',
    );
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('a,button')].find((node) => node.textContent.trim() === 'แก้ไขข้อมูล');
        if (!button) throw new Error('No edit action to open');
        button.click();
      })()`,
    );
    await waitFor(
      async () => (await bodyText(client)).includes('แก้ไขข้อมูลก่อนนำเข้า'),
      'Quarantine edit drawer did not open',
    );
    assert(!(await bodyText(client)).includes(RAW_IDENTIFIER), 'Quarantine edit drawer leaked the raw national ID');
    await capture(client, '/tmp/sts-import-quarantine-edit-desktop.png');

    // --- Mobile render of the list ---
    await client.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate(client, `${FRONTEND_URL}/import-data/quarantine`);
    await waitForQuarantineList(client);
    await capture(client, '/tmp/sts-import-quarantine-list-mobile.png');

    console.log(
      'import quarantine browser smoke passed (seeded rows render with reason labels, reason filter narrows, masked identifier, PII-safe detail, desktop/mobile)',
    );
  } finally {
    await closeChrome(chrome);
    await cleanupSeed(dataSource);
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
