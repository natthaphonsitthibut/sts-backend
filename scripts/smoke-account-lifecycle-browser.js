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
  throw new Error('Refusing to run account lifecycle browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5173';
const BROWSER_BACKEND_URL =
  process.env.SMOKE_BROWSER_BACKEND_URL || BACKEND_URL.replace('127.0.0.1', 'localhost');
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9234);
const ADMIN_USERNAME = 'account_lifecycle_browser_admin';
const TEACHER_USERNAME = 'account_lifecycle_browser_teacher';

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-account-lifecycle-chrome-'));
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
      fs.rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
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

async function setInputValue(client, selector, value) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) throw new Error('Input not found: ${selector}');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) {
        setter.call(input, ${JSON.stringify(value)});
      } else {
        input.value = ${JSON.stringify(value)};
      }
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
  await waitFor(
    async () =>
      (await evaluate(
        client,
        `document.querySelector(${JSON.stringify(selector)})?.value || ''`,
      )) === value,
    `Input value did not update: ${selector}`,
  );
}

async function click(client, expression, message) {
  await evaluate(
    client,
    `(() => {
      const target = ${expression};
      if (!target) throw new Error(${JSON.stringify(message)});
      target.click();
    })()`,
  );
}

async function chooseComboboxOption(client, selector, label) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) throw new Error('Combobox not found: ${selector}');
      input.click();
    })()`,
  );
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const input = document.querySelector(${JSON.stringify(selector)});
            return Boolean(input?.parentElement?.querySelector('ul button'));
          })()`,
        ),
      ),
    `Combobox options did not open: ${selector}`,
  );
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const option = input?.parentElement
        ? [...input.parentElement.querySelectorAll('ul button')]
            .find((button) => button.textContent.trim() === ${JSON.stringify(label)})
        : null;
      if (!option) throw new Error('Combobox option not found: ${label}');
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    })()`,
  );
}

async function clearBrowserSession(client) {
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

async function loginAdminSession(client, user, sessionCookie) {
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

async function loginWithForm(client, username, password, shouldSucceed) {
  await navigate(client, `${FRONTEND_URL}/login`);
  await waitFor(
    async () => Boolean(await evaluate(client, 'Boolean(document.querySelector("#username"))')),
    `Login form did not render for ${username}`,
  );
  await fillInput(client, '#username', username);
  await fillInput(client, '#password', password);
  await click(
    client,
    `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'เข้าสู่ระบบ')`,
    'Login submit button was not found',
  );

  if (shouldSucceed) {
    await waitFor(
      async () =>
        String(await evaluate(client, 'localStorage.getItem("sts_user") || ""')).includes(username) &&
        !String(await evaluate(client, 'location.pathname')).startsWith('/login'),
      `Login did not succeed for ${username}`,
    );
    return;
  }

  await waitFor(
    async () =>
      String(await evaluate(client, 'document.body.innerText')).includes('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง') &&
      !String(await evaluate(client, 'localStorage.getItem("sts_user") || ""')).includes(username),
    `Disabled login was not rejected for ${username}`,
  );
}

async function upsertUser(
  dataSource,
  { username, passwordHash, firstName, lastName, permissions, role, dataScope },
) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = $3,
            "LastName" = $4,
            status = 'ACTIVE',
            permissions = $5::jsonb,
            role = $6,
            data_scope = $7::jsonb,
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            affiliation = 'Automated account lifecycle browser smoke',
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
        WHERE id = $1
      `,
      [
        existing.id,
        passwordHash,
        firstName,
        lastName,
        JSON.stringify(permissions),
        role,
        JSON.stringify(dataScope),
      ],
    );
    return existing;
  }

  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code, email, phone
      )
      VALUES ($1, $2, $3, $4, 'ACTIVE', $5::jsonb, $6, $7::jsonb, FALSE, $8, 'AUTOMATED_TEST', NULL, NULL)
      RETURNING id
    `,
    [
      username,
      passwordHash,
      firstName,
      lastName,
      JSON.stringify(permissions),
      role,
      JSON.stringify(dataScope),
      'Automated account lifecycle browser smoke',
    ],
  );
  return row;
}

async function disableUsers(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated account lifecycle browser smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [[ADMIN_USERNAME, TEACHER_USERNAME]],
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
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminPassword = `AdminBrowser-${suffix}-Password`;
  const teacherPassword = `TeacherBrowser-${suffix}-Password`;
  let chrome;

  try {
    const admin = await upsertUser(dataSource, {
      username: ADMIN_USERNAME,
      passwordHash: await passwordService.hash(adminPassword),
      firstName: 'Account Browser',
      lastName: 'Admin',
      permissions: ['home', 'manage-users-list'],
      role: 'ADMIN',
      dataScope: { global: true },
    });
    const teacher = await upsertUser(dataSource, {
      username: TEACHER_USERNAME,
      passwordHash: await passwordService.hash(teacherPassword),
      firstName: 'Account Browser',
      lastName: 'Teacher',
      permissions: ['home', 'attendance'],
      role: 'TEACHER',
      dataScope: { school_ids: [10010002] },
    });
    assert(admin.id !== teacher.id, 'Admin and teacher fixtures unexpectedly share an id');

    const adminUser = {
      id: admin.id,
      username: ADMIN_USERNAME,
      FirstName: 'Account Browser',
      LastName: 'Admin',
      roles: ['ADMIN'],
      permissions: ['home', 'manage-users-list'],
      data_scope: { global: true },
      must_change_password: false,
    };
    const adminSession = createSessionCookie(sessionCookieService, admin.id);

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

    await loginWithForm(client, TEACHER_USERNAME, teacherPassword, true);
    await clearBrowserSession(client);

    await loginAdminSession(client, adminUser, adminSession);
    await navigate(client, `${FRONTEND_URL}/manage-users`);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('จัดการรายชื่อผู้ใช้งาน'),
      'Manage users page did not render',
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('input[placeholder="ค้นหาชื่อหรือ username..."]'))`,
          ),
        ),
      'Manage users search input did not render',
    );
    await setInputValue(client, 'input[placeholder="ค้นหาชื่อหรือ username..."]', TEACHER_USERNAME);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes(TEACHER_USERNAME),
      'Teacher fixture did not appear in manage users search',
    );
    await click(
      client,
      `[...document.querySelectorAll('button[aria-label="ปิดใช้งานผู้ใช้งาน"]')][0]`,
      'Deactivate user button was not found',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('ปิดใช้งานบัญชี'),
      'Deactivate account dialog did not render',
    );
    await chooseComboboxOption(client, '#account-deactivation-reason', 'อื่น ๆ');
    await fillInput(client, '#account-deactivation-note', 'Automated browser smoke test');
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'ปิดใช้งาน')`,
      'Deactivate confirm button was not found',
    );
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `
          SELECT status, deactivation_reason_code, deactivation_note
          FROM users WHERE id = $1
        `,
        [teacher.id],
      );
      return (
        row?.status === 'DISABLED' &&
        row.deactivation_reason_code === 'OTHER' &&
        row.deactivation_note === 'Automated browser smoke test'
      );
    }, 'Deactivate did not persist disabled status and reason metadata');

    await clearBrowserSession(client);
    await loginWithForm(client, TEACHER_USERNAME, teacherPassword, false);
    await clearBrowserSession(client);

    await loginAdminSession(client, adminUser, adminSession);
    await navigate(client, `${FRONTEND_URL}/manage-users`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('input[placeholder="ค้นหาชื่อหรือ username..."]'))`,
          ),
        ),
      'Manage users search input did not render after re-login',
    );
    await setInputValue(client, 'input[placeholder="ค้นหาชื่อหรือ username..."]', TEACHER_USERNAME);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes(TEACHER_USERNAME),
      'Disabled teacher fixture did not appear in manage users search',
    );
    await click(
      client,
      `[...document.querySelectorAll('button[aria-label="เปิดใช้งานผู้ใช้งาน"]')][0]`,
      'Reactivate user button was not found',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('เปิดใช้งานผู้ใช้งาน'),
      'Reactivate confirm dialog did not render',
    );
    await click(
      client,
      `(() => {
        const dialog = [...document.querySelectorAll('section')]
          .find((section) => section.textContent.includes('เปิดใช้งานผู้ใช้งาน'));
        return dialog
          ? [...dialog.querySelectorAll('button')]
              .find((button) => button.textContent.trim() === 'เปิดใช้งาน')
          : null;
      })()`,
      'Reactivate confirm button was not found',
    );
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `
          SELECT status, deactivated_at, deactivated_by, deactivation_reason_code, deactivation_note
          FROM users WHERE id = $1
        `,
        [teacher.id],
      );
      return (
        row?.status === 'ACTIVE' &&
        row.deactivated_at === null &&
        row.deactivated_by === null &&
        row.deactivation_reason_code === null &&
        row.deactivation_note === null
      );
    }, 'Reactivate did not restore active status and clear metadata');

    await clearBrowserSession(client);
    await loginWithForm(client, TEACHER_USERNAME, teacherPassword, true);

    console.log(
      'account lifecycle browser smoke passed (teacher login, UI deactivate, disabled login rejected, UI reactivate, login restored)',
    );
  } finally {
    await closeChrome(chrome);
    try {
      await disableUsers(dataSource);
    } finally {
      await app.close();
    }
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
