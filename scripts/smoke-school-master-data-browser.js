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
  throw new Error('Refusing to run school master-data browser smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const BROWSER_BACKEND_URL = process.env.SMOKE_BROWSER_BACKEND_URL || BACKEND_URL;
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9252);
const USERNAME = 'school_master_browser_importer';
const MISSING_SCHOOL_ID = 99999991;

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-school-master-chrome-'));
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
  fs.rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

async function upsertActor(dataSource, passwordHash) {
  const permissions = ['home', 'import-data'];
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [USERNAME]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'School Master',
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
            affiliation = 'Automated school master-data browser smoke',
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
        WHERE id = $1
      `,
      [existing.id, passwordHash, JSON.stringify(permissions)],
    );
    return existing;
  }
  const [created] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code, email, phone
      )
      VALUES (
        $1, $2, 'School Master', 'Browser Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'Automated school master-data browser smoke',
        'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [USERNAME, passwordHash, JSON.stringify(permissions)],
  );
  return created;
}

async function disableActor(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated smoke fixture')
      WHERE username = $1
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-school-master-file-'));
  const csvPath = path.join(tempDir, 'unknown-school.csv');
  fs.writeFileSync(
    csvPath,
    `PersonID_Onec,AcademicYear_Onec,Semester_Onec,SchoolID_Onec\n9900000000001,2569,1,${MISSING_SCHOOL_ID}\n`,
  );
  let chrome;

  try {
    const password = `SchoolMasterBrowser-${Date.now()}-Password`;
    const actor = await upsertActor(dataSource, await passwordService.hash(password));
    const user = {
      id: actor.id,
      username: USERNAME,
      FirstName: 'School Master',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home', 'import-data'],
      data_scope: { global: true },
      must_change_password: false,
    };
    const sessionCookie = createSessionCookie(sessionCookieService, actor.id);
    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await client.call('DOM.enable');
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await loginInBrowser(client, user, sessionCookie);
    await navigate(client, `${FRONTEND_URL}/import-data`);
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === '/import-data' &&
        String(await evaluate(client, 'document.body.innerText')).includes('รายละเอียดการนำเข้า'),
      'Import page did not load',
    );

    const fileInputObject = await client.call('Runtime.evaluate', {
      expression: 'document.querySelector(\'input[type="file"]\')',
      returnByValue: false,
    });
    assert(fileInputObject.result?.objectId, 'Import file input was not found');
    await client.call('DOM.setFileInputFiles', {
      objectId: fileInputObject.result.objectId,
      files: [csvPath],
    });
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('unknown-school.csv'),
      'Selected import filename was not rendered',
    );
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.textContent.includes('ตรวจสอบไฟล์'));
        if (!button) throw new Error('Preview button not found');
        button.click();
      })()`,
    );
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return text.includes('พบโรงเรียนที่ยังไม่มีในข้อมูลหลัก') && text.includes(String(MISSING_SCHOOL_ID));
      },
      'Missing-school onboarding warning did not render',
    );
    const uiState = await evaluate(
      client,
      `(() => {
        const importButton = [...document.querySelectorAll('button')]
          .filter((item) => item.textContent.trim() === 'นำเข้าข้อมูล')
          .at(-1);
        return {
          importDisabled: Boolean(importButton?.disabled),
          hasLegacyInput: Boolean(document.querySelector('[id^="missing-school-"]')),
          hasLegacyCopy: document.body.innerText.includes('ระบบจะสร้างเฉพาะโรงเรียน'),
        };
      })()`,
    );
    assert(uiState.importDisabled, 'Import button stayed enabled for an unknown school');
    assert(!uiState.hasLegacyInput, 'Legacy manual-school input is still rendered');
    assert(!uiState.hasLegacyCopy, 'Legacy automatic school-creation copy is still rendered');

    const directApiStatus = await evaluate(
      client,
      `(async () => {
        const response = await fetch(
          ${JSON.stringify(`${BROWSER_BACKEND_URL}/api/master-data/schools?page=1&limit=20`)},
          { credentials: 'include' }
        );
        return response.status;
      })()`,
    );
    assert(directApiStatus === 403, `Direct school API returned ${directApiStatus}, expected 403`);

    console.log('school master-data browser smoke passed');
  } finally {
    try {
      await closeChrome(chrome);
      await disableActor(dataSource);
      fs.rmSync(tempDir, { recursive: true, force: true });
    } finally {
      await app.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
