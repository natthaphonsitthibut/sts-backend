const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { FILE_STORAGE_ADAPTER } = require('../dist/files/storage/file-storage.types');

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
const PROFILE_PHOTO_ONLY = process.env.SMOKE_PROFILE_PHOTO_ONLY === 'true';
const USER_CONTACT_ADDRESS_ONLY = process.env.SMOKE_USER_CONTACT_ADDRESS_ONLY === 'true';
const ADMIN_USERNAME = 'account_lifecycle_browser_admin';
const TEACHER_USERNAME = 'account_lifecycle_browser_teacher';
const TEACHER_DISPLAY_NAME = 'Account Browser Teacher';
const PROFILE_PHOTO_KEY = 'user-photos/account-lifecycle-browser/profile.png';
const PROFILE_PHOTO_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

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
      option.click();
    })()`,
  );
  await waitFor(
    async () =>
      (await evaluate(
        client,
        `document.querySelector(${JSON.stringify(selector)})?.value || ''`,
      )) === label,
    `Combobox option did not apply: ${selector}`,
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
    `document.querySelector('form button[type="submit"]')`,
    'Login submit button was not found',
  );

  if (shouldSucceed) {
    try {
      await waitFor(
        async () =>
          String(await evaluate(client, 'localStorage.getItem("sts_user") || ""')).includes(username) &&
          !String(await evaluate(client, 'location.pathname')).startsWith('/login'),
        `Login did not succeed for ${username}`,
      );
    } catch (error) {
      if (process.env.SMOKE_DEBUG === 'true') {
        console.log(await evaluate(client, 'location.href'));
        console.log(await evaluate(client, 'localStorage.getItem("sts_user") || ""'));
        console.log(await evaluate(client, 'document.body.innerText'));
      }
      throw error;
    }
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
  const storage = app.get(FILE_STORAGE_ADAPTER);
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
      permissions: ['home', 'manage-users-list', 'attendance'],
      role: 'ADMIN',
      dataScope: { global: true },
    });
    const teacher = await upsertUser(dataSource, {
      username: TEACHER_USERNAME,
      passwordHash: await passwordService.hash(teacherPassword),
      firstName: 'Account Browser',
      lastName: 'Teacher',
      permissions: ['home', 'attendance'],
      role: 'EXECUTIVE',
      dataScope: { global: true },
    });
    await storage.save(PROFILE_PHOTO_BYTES, PROFILE_PHOTO_KEY);
    await dataSource.query(
      `UPDATE users SET photo_storage_key = $2, data_origin_code = 'OPERATIONAL' WHERE id = $1`,
      [teacher.id, PROFILE_PHOTO_KEY],
    );
    assert(admin.id !== teacher.id, 'Admin and teacher fixtures unexpectedly share an id');

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

    await loginWithForm(client, ADMIN_USERNAME, adminPassword, true);
    if (USER_CONTACT_ADDRESS_ONLY) {
      await navigate(client, `${FRONTEND_URL}/manage-users/new`);
      await waitFor(
        async () =>
          Boolean(
            await evaluate(
              client,
              `Boolean(
                document.querySelector('#line_id') &&
                document.querySelector('#address_line') &&
                document.querySelector('#address_latitude') &&
                document.querySelector('#address_longitude')
              )`,
            ),
          ),
        'Add-user contact and address fields did not render',
      );
      await navigate(client, `${FRONTEND_URL}/manage-users/${teacher.id}/edit`);
      await waitFor(
        async () =>
          Boolean(
            await evaluate(
              client,
              `Boolean(
                document.querySelector('#line_id') &&
                document.querySelector('#address_line') &&
                document.querySelector('#address_latitude') &&
                document.querySelector('#address_longitude')
              )`,
            ),
          ),
        'User contact and address fields did not render',
      );
      await setInputValue(client, '#email', 'account.browser@example.invalid');
      await setInputValue(client, '#phone', '0812345678');
      await setInputValue(client, '#PersonID_Onec', String(teacher.id).padStart(13, '9'));
      await setInputValue(client, '#line_id', 'account.browser.line');
      await setInputValue(client, '#address_line', '99/1');
      await setInputValue(client, '#address_latitude', '13.756300');
      await setInputValue(client, '#address_longitude', '100.501800');
      await click(
        client,
        `document.querySelector('form button[type="submit"]')`,
        'User form submit button was not found',
      );
      if (process.env.SMOKE_DEBUG === 'true') {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        console.log(
          await evaluate(
            client,
            `[...document.querySelectorAll('[aria-invalid="true"]')].map((element) => ({ id: element.id, value: element.value }))`,
          ),
        );
        console.log(await evaluate(client, 'document.body.innerText'));
      }
      await waitFor(async () => {
        const [row] = await dataSource.query(
          `
            SELECT line_id, address_line, address_latitude, address_longitude
            FROM users
            WHERE id = $1
          `,
          [teacher.id],
        );
        return (
          row?.line_id === 'account.browser.line' &&
          row.address_line === '99/1' &&
          Number(row.address_latitude) === 13.7563 &&
          Number(row.address_longitude) === 100.5018
        );
      }, 'User LINE and address fields did not persist');

      await navigate(client, `${FRONTEND_URL}/manage-users/${teacher.id}`);
      await waitFor(
        async () =>
          String(await evaluate(client, 'document.body.innerText')).includes('account.browser.line'),
        'User detail did not render the saved LINE ID',
      );
      await click(
        client,
        `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('ดูที่อยู่และแผนที่'))`,
        'Reveal user address button was not found',
      );
      await chooseComboboxOption(client, '#user-address-reason', 'ตรวจสอบ/แก้ไขข้อมูล');
      await click(
        client,
        `(() => {
          const reasonField = document.querySelector('#user-address-reason');
          const dialog = reasonField?.closest('[role="dialog"]');
          return dialog
            ? [...dialog.querySelectorAll('button')].find((button) => button.textContent.includes('แสดง'))
            : null;
        })()`,
        'Reveal user address submit button was not found',
      );
      if (process.env.SMOKE_DEBUG === 'true') {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        console.log(await evaluate(client, 'document.body.innerText'));
      }
      await waitFor(
        async () => {
          const body = String(await evaluate(client, 'document.body.innerText'));
          return body.includes('99/1') && body.includes('พิกัดที่อยู่ผู้ใช้งาน');
        },
        'User address map did not render after the audited reveal',
      );
      console.log('user contact/address browser smoke passed (LINE, address fields, persistence, audited detail map)');
      return;
    }
    await navigate(client, `${FRONTEND_URL}/manage-users`);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('จัดการผู้ใช้งาน'),
      'Manage users page did not render',
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('input[placeholder="ค้นหา"]'))`,
          ),
        ),
      'Manage users search input did not render',
    );
    await setInputValue(client, 'input[placeholder="ค้นหา"]', TEACHER_DISPLAY_NAME);
    if (process.env.SMOKE_DEBUG === 'true') {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      console.log(await evaluate(client, 'document.body.innerText'));
    }
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('a[href="/manage-users/${teacher.id}"]'))`,
          ),
        ),
      'Teacher fixture did not appear in manage users search',
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `(() => {
              const link = document.querySelector('a[href="/manage-users/${teacher.id}"]');
              const image = link?.querySelector('img[data-avatar-image]');
              return Boolean(
                image &&
                image.complete &&
                image.naturalWidth > 0 &&
                image.src.includes('/api/users/${teacher.id}/photo?v=') &&
                !image.src.includes(${JSON.stringify(PROFILE_PHOTO_KEY)})
              );
            })()`,
          ),
        ),
      'Managed-user profile photo did not load through the guarded URL',
    );
    if (PROFILE_PHOTO_ONLY) {
      console.log('managed-user profile photo browser smoke passed');
      return;
    }
    await click(
      client,
      `document.querySelector('button[aria-label^="ปิดใช้งานผู้ใช้งาน "]')`,
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

    await loginWithForm(client, ADMIN_USERNAME, adminPassword, true);
    await navigate(client, `${FRONTEND_URL}/manage-users`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('input[placeholder="ค้นหา"]'))`,
          ),
        ),
      'Manage users search input did not render after re-login',
    );
    await setInputValue(client, 'input[placeholder="ค้นหา"]', TEACHER_DISPLAY_NAME);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('a[href="/manage-users/${teacher.id}"]'))`,
          ),
        ),
      'Disabled teacher fixture did not appear in manage users search',
    );
    await click(
      client,
      `document.querySelector('button[aria-label^="เปิดใช้งานผู้ใช้งาน "]')`,
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
      await dataSource.query(
        `UPDATE users
         SET photo_storage_key = NULL,
             data_origin_code = 'AUTOMATED_TEST',
             line_id = NULL,
             address_line = NULL,
             address_village_no = NULL,
             address_street = NULL,
             address_soi = NULL,
             address_trok = NULL,
             address_sub_district = NULL,
             address_district = NULL,
             address_province = NULL,
             address_postal_code = NULL,
             address_latitude = NULL,
             address_longitude = NULL
         WHERE username = $1`,
        [TEACHER_USERNAME],
      );
      await storage.delete(PROFILE_PHOTO_KEY).catch(() => undefined);
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
