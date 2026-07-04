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
  throw new Error('Refusing to run student-status browser smoke with NODE_ENV=production');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5173';
const BROWSER_BACKEND_URL =
  process.env.SMOKE_BROWSER_BACKEND_URL || BACKEND_URL.replace('127.0.0.1', 'localhost');
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9233);
const SETTINGS_USERNAME = 'student_status_browser_settings';
const NO_PERMISSION_USERNAME = 'student_status_browser_no_permission';

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-student-status-chrome-'));
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

async function setChecked(client, labelText, checked) {
  await evaluate(
    client,
    `(() => {
      const label = [...document.querySelectorAll('label')]
        .find((node) => node.textContent.includes(${JSON.stringify(labelText)}));
      const input = label?.querySelector('input[type="checkbox"]');
      if (!input) throw new Error('Checkbox not found: ${labelText}');
      if (input.checked !== ${JSON.stringify(checked)}) {
        input.click();
      }
    })()`,
  );
}

async function selectValue(client, selector, value) {
  await evaluate(
    client,
    `(() => {
      const trigger = document.querySelector(${JSON.stringify(selector)});
      if (!trigger) throw new Error('Select trigger not found: ${selector}');
      trigger.click();
    })()`,
  );
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const trigger = document.querySelector(${JSON.stringify(selector)});
            return Boolean(trigger?.parentElement?.querySelector('[role="listbox"]'));
          })()`,
        ),
      ),
    `Select options did not open: ${selector}`,
  );
  await evaluate(
    client,
    `(() => {
      const trigger = document.querySelector(${JSON.stringify(selector)});
      const container = trigger?.parentElement;
      const hiddenSelect = container?.querySelector('select');
      const option = hiddenSelect
        ? [...hiddenSelect.options].find((item) => item.value === ${JSON.stringify(value)})
        : null;
      const label = option?.textContent?.trim() || ${JSON.stringify(value)};
      const button = container
        ? [...container.querySelectorAll('[role="listbox"] button[role="option"]')]
            .find((item) => item.textContent.trim() === label)
        : null;
      if (!button) throw new Error('Select option not found: ${selector}=${value}');
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    })()`,
  );
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const trigger = document.querySelector(${JSON.stringify(selector)});
            const hiddenSelect = trigger?.parentElement?.querySelector('select');
            return hiddenSelect?.value === ${JSON.stringify(value)};
          })()`,
        ),
      ),
    `Select value did not update: ${selector}`,
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

async function cleanup(dataSource) {
  await dataSource.query(`DELETE FROM student_status WHERE source_system = 'SMOKE_BROWSER'`);
}

async function disableActors(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated student-status browser smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [[SETTINGS_USERNAME, NO_PERMISSION_USERNAME]],
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
            "FirstName" = 'Student Status',
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
            affiliation = 'Automated student-status browser smoke',
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
        $1, $2, 'Student Status', 'Browser Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'Automated student-status browser smoke',
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
  const password = `StudentStatusBrowser-${suffix}-Password`;
  const code = 970000 + (Date.now() % 20_000);
  const label = `สถานะ browser smoke ${suffix}`;
  const updatedLabel = `สถานะ browser smoke updated ${suffix}`;
  let chrome;

  try {
    await cleanup(dataSource);
    const settingsActor = await upsertActor(dataSource, await passwordService.hash(password), SETTINGS_USERNAME, [
      'home',
      'settings',
    ]);
    const noPermissionActor = await upsertActor(dataSource, await passwordService.hash(password), NO_PERMISSION_USERNAME, [
      'home',
    ]);
    const settingsUser = {
      id: settingsActor.id,
      username: SETTINGS_USERNAME,
      FirstName: 'Student Status',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home', 'settings'],
      data_scope: { global: true },
      must_change_password: false,
    };
    const noPermissionUser = {
      id: noPermissionActor.id,
      username: NO_PERMISSION_USERNAME,
      FirstName: 'Student Status',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home'],
      data_scope: { global: true },
      must_change_password: false,
    };
    const settingsSession = createSessionCookie(sessionCookieService, settingsActor.id);
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

    await loginInBrowser(client, noPermissionUser, noPermissionSession);
    await navigate(client, `${FRONTEND_URL}/settings/student-statuses`);
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === '/forbidden' &&
        String(await evaluate(client, 'document.body.innerText')).includes('ไม่มีสิทธิ์เข้าถึง'),
      'No-permission user was not blocked from student statuses',
    );

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

    await loginInBrowser(client, settingsUser, settingsSession);
    await navigate(client, `${FRONTEND_URL}/settings/student-statuses`);
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === '/settings/student-statuses' &&
        String(await evaluate(client, 'document.body.innerText')).includes('ข้อมูลพื้นฐานสถานะนักเรียน') &&
        String(await evaluate(client, 'document.body.innerText')).includes('เพิ่มสถานะ'),
      'Student statuses page did not render for settings user',
    );

    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('เพิ่มสถานะ'))`,
      'Create student status button was not found',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('เพิ่มสถานะนักเรียน'),
      'Create status dialog did not render',
    );
    await fillInput(client, '#student-status-code', String(code));
    await fillInput(client, '#student-status-label', label);
    await selectValue(client, '#student-status-category', 'ACTIVE');
    await fillInput(client, '#student-status-source', 'SMOKE_BROWSER');
    await selectValue(client, '#student-status-badge', 'success');
    await fillInput(client, '#student-status-sort', '32000');
    await setChecked(client, 'เข้าสู่ระบบได้', true);
    await setChecked(client, 'เป็นสถานะสิ้นสุด', false);
    await setChecked(client, 'ควรพิจารณาติดตาม', false);
    await setChecked(client, 'เปิดใช้งาน', true);
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'บันทึก')`,
      'Dialog save button was not found',
    );
    await waitFor(
      async () => !String(await evaluate(client, 'document.body.innerText')).includes('เพิ่มสถานะนักเรียน'),
      'Create status dialog did not close after save',
    );

    await fillInput(client, 'input[placeholder="ค้นหารหัส ชื่อ หมวด หรือระบบต้นทาง..."]', String(code));
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes(label),
      'Created status did not appear in filtered list',
    );

    await click(
      client,
      `[...document.querySelectorAll('button')]
        .find((button) => button.getAttribute('aria-label') === ${JSON.stringify(`แก้ไข ${label}`)})`,
      'Edit status button was not found',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('แก้ไขสถานะนักเรียน'),
      'Edit status dialog did not render',
    );
    await fillInput(client, '#student-status-label', updatedLabel);
    await selectValue(client, '#student-status-category', 'WITHDRAWN');
    await selectValue(client, '#student-status-badge', 'warning');
    await fillInput(client, '#student-status-sort', '32001');
    await setChecked(client, 'เข้าสู่ระบบได้', false);
    await setChecked(client, 'เป็นสถานะสิ้นสุด', true);
    await setChecked(client, 'ควรพิจารณาติดตาม', true);
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'บันทึก')`,
      'Dialog save button was not found for edit',
    );
    await waitFor(
      async () =>
        !String(await evaluate(client, 'document.body.innerText')).includes('แก้ไขสถานะนักเรียน') &&
        String(await evaluate(client, 'document.body.innerText')).includes(updatedLabel),
      'Updated status did not appear after edit',
    );

    await click(
      client,
      `[...document.querySelectorAll('button')]
        .find((button) => button.getAttribute('aria-label') === ${JSON.stringify(`ปิดใช้งาน ${updatedLabel}`)})`,
      'Disable status button was not found',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('ปิดใช้งานสถานะนี้?'),
      'Disable confirm dialog did not render',
    );
    await click(
      client,
      `(() => {
        const dialog = [...document.querySelectorAll('section')]
          .find((section) => section.textContent.includes('ปิดใช้งานสถานะนี้?'));
        return dialog
          ? [...dialog.querySelectorAll('button')]
              .find((button) => button.textContent.trim() === 'ปิดใช้งาน')
          : null;
      })()`,
      'Disable confirm button was not found',
    );
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT is_enabled FROM student_status WHERE code = $1`,
        [code],
      );
      return row?.is_enabled === false;
    }, 'Disable did not persist in the database');
    await capture(client, '/tmp/sts-student-statuses-desktop.png');

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/settings/student-statuses`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('input[placeholder="ค้นหารหัส ชื่อ หมวด หรือระบบต้นทาง..."]'))`,
          ),
        ),
      'Mobile search input did not render',
    );
    await fillInput(client, 'input[placeholder="ค้นหารหัส ชื่อ หมวด หรือระบบต้นทาง..."]', String(code));
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(updatedLabel) &&
        String(await evaluate(client, 'document.body.innerText')).includes('รหัส'),
      'Mobile student statuses page did not render the saved status',
    );
    await capture(client, '/tmp/sts-student-statuses-mobile.png');

    const [persisted] = await dataSource.query(
      `
        SELECT code, label_th, category, badge_variant, is_active_for_login,
               is_terminal, requires_followup, is_enabled, source_system, sort_order
        FROM student_status
        WHERE code = $1
      `,
      [code],
    );
    assert(persisted?.label_th === updatedLabel, 'Updated status label did not persist');
    assert(persisted.category === 'WITHDRAWN', 'Updated status category did not persist');
    assert(persisted.badge_variant === 'warning', 'Updated status badge did not persist');
    assert(persisted.is_active_for_login === false, 'Login policy did not persist');
    assert(persisted.is_terminal === true, 'Terminal policy did not persist');
    assert(persisted.requires_followup === true, 'Follow-up policy did not persist');
    assert(persisted.is_enabled === false, 'Disable flag did not persist');
    assert(persisted.source_system === 'SMOKE_BROWSER', 'Source system did not persist');
    assert(Number(persisted.sort_order) === 32001, 'Sort order did not persist');

    console.log(
      'student statuses browser smoke passed (permission gate, create/search/edit/disable, desktop/mobile)',
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
