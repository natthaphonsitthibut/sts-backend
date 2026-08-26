const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run browser smoke in production');
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9262);
const ALLOWED_USERNAME = 'classroom_links_browser_allowed';
const DENIED_USERNAME = 'classroom_links_browser_denied';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(check, message, timeoutMs = 25_000) {
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
  // Accept a thunk so a red run reports what the page actually showed.
  const detail = typeof message === 'function' ? await message() : message;
  throw new Error(lastError ? `${detail}: ${lastError.message}` : detail);
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
  close() { this.socket.close(); }
}

async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function navigate(client, url) {
  await client.call('Page.navigate', { url });
  await waitFor(
    async () => (await evaluate(client, 'document.readyState')) === 'complete',
    `Page did not load: ${url}`,
  );
}

async function openChrome() {
  assert(fs.existsSync(CHROME_PATH), 'Google Chrome executable was not found');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-classroom-links-chrome-'));
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
    try { return (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).ok; }
    catch { return false; }
  }, 'Chrome DevTools endpoint did not start');
  const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((response) => response.json());
  const target = targets.find((item) => item.type === 'page');
  assert(target?.webSocketDebuggerUrl, 'Chrome page target was not available');
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return { client, processRef, userDataDir };
}

async function closeChrome(chrome) {
  chrome?.client.close();
  if (chrome?.processRef && chrome.processRef.exitCode === null) {
    const exited = new Promise((resolve) => chrome.processRef.once('exit', resolve));
    chrome.processRef.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  if (chrome?.userDataDir) {
    fs.rmSync(chrome.userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

function stopProcess(processRef) {
  if (processRef && !processRef.killed) processRef.kill('SIGTERM');
}

function createSessionCookie(service, userId) {
  let cookie;
  service.setSession({ cookie: (name, value) => { cookie = { name, value }; } }, userId);
  assert(cookie, 'Session cookie was not created');
  return cookie;
}

async function upsertActor(dataSource, username, permissions, schoolId) {
  const [row] = await dataSource.query(
    `INSERT INTO users (
       username, password, status, permissions, "FirstName", "LastName",
       role, data_scope, must_change_password, data_origin_code
     ) VALUES ($1, 'NOT_A_LOGIN_CREDENTIAL', 'ACTIVE', $2::jsonb,
       'ผู้ใช้งาน', 'Browser Smoke', 'ADMIN', $3::jsonb, FALSE, 'AUTOMATED_TEST')
     ON CONFLICT (username) DO UPDATE SET
       status = 'ACTIVE', permissions = EXCLUDED.permissions,
       role = 'ADMIN', data_scope = EXCLUDED.data_scope,
       must_change_password = FALSE, data_origin_code = 'AUTOMATED_TEST'
     RETURNING id`,
    [username, JSON.stringify(permissions), JSON.stringify({ school_ids: [schoolId] })],
  );
  return row;
}

async function login(client, user, cookie) {
  await navigate(client, `${FRONTEND_URL}/login`);
  await client.call('Network.setCookie', {
    name: cookie.name,
    value: cookie.value,
    url: BACKEND_URL,
    httpOnly: true,
    sameSite: 'Lax',
  });
  await evaluate(
    client,
    `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(user))});
     localStorage.setItem('admin_access', 'true');`,
  );
}

async function clickButton(client, label) {
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.textContent.trim().includes(${JSON.stringify(label)}) && !item.disabled);
      if (!button) throw new Error('Button not found: ${label}');
      button.click();
    })()`,
  );
}

async function main() {
  const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dataSource = context.get(DataSource);
  const cookieService = context.get(SessionCookieService);
  let backend;
  let frontend;
  let chrome;
  let initialLinkIds = [];
  let schoolId;
  let schoolTermId;

  try {
    const [scope] = await dataSource.query(
      `SELECT classroom.school_id, classroom.school_term_id
       FROM school_classrooms classroom
       JOIN schools school ON school.id = classroom.school_id AND school.school_status = 'ACTIVE'
       JOIN school_terms term ON term.id = classroom.school_term_id AND term.status = 'ACTIVE'
       WHERE classroom.classroom_status = 'ACTIVE' AND classroom.deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM classroom_homeroom_teachers homeroom
           JOIN school_teacher_memberships membership
             ON membership.id = homeroom.teacher_membership_id
            AND membership.membership_status = 'ACTIVE'
            AND membership.deleted_at IS NULL
           JOIN teachers teacher
             ON teacher.id = membership.teacher_id
            AND teacher.teacher_status = 'ACTIVE'
            AND teacher.deleted_at IS NULL
           WHERE homeroom.classroom_id = classroom.id
             AND homeroom.school_id = classroom.school_id
         )
       ORDER BY classroom.id LIMIT 1`,
    );
    assert(scope, 'No active classroom scope is available');
    schoolId = Number(scope.school_id);
    schoolTermId = Number(scope.school_term_id);
    initialLinkIds = (
      await dataSource.query(
        `SELECT id::text FROM classroom_attendance_links WHERE school_id = $1 AND school_term_id = $2`,
        [scope.school_id, scope.school_term_id],
      )
    ).map((row) => row.id);
    const allowed = await upsertActor(dataSource, ALLOWED_USERNAME, ['home', 'manage-classroom-links'], schoolId);
    const denied = await upsertActor(dataSource, DENIED_USERNAME, ['home'], schoolId);
    const allowedCookie = createSessionCookie(cookieService, allowed.id);
    const deniedCookie = createSessionCookie(cookieService, denied.id);
    await context.close();

    backend = spawn('node', ['dist/main.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        PORT: '3001',
        CORS_ORIGINS: FRONTEND_URL,
        FRONTEND_BASE_URL: FRONTEND_URL,
      },
      stdio: 'ignore',
    });
    frontend = spawn('pnpm', ['dev', '--host', '127.0.0.1', '--port', '5174'], {
      cwd: path.resolve(__dirname, '../../sts-frontend'),
      env: { ...process.env, VITE_API_BASE_URL: BACKEND_URL },
      stdio: 'ignore',
    });
    await waitFor(async () => {
      try { return (await fetch(`${BACKEND_URL}/health`)).ok; } catch { return false; }
    }, 'Backend did not start');
    await waitFor(async () => {
      try { return (await fetch(FRONTEND_URL)).ok; } catch { return false; }
    }, 'Frontend did not start');

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

    const deniedUser = {
      id: denied.id,
      username: DENIED_USERNAME,
      roles: ['ADMIN'],
      permissions: ['home'],
      data_scope: { school_ids: [schoolId] },
      must_change_password: false,
    };
    await login(client, deniedUser, deniedCookie);
    await navigate(client, `${FRONTEND_URL}/attendance/classroom-links`);
    await waitFor(
      async () => (await evaluate(client, 'location.pathname')) === '/forbidden',
      `A user without the page permission was not denied; landed on ${await evaluate(client, 'location.pathname')}`,
    );

    const allowedUser = {
      ...deniedUser,
      id: allowed.id,
      username: ALLOWED_USERNAME,
      permissions: ['home', 'manage-classroom-links'],
    };
    await login(client, allowedUser, allowedCookie);
    await navigate(client, `${FRONTEND_URL}/attendance/classroom-links`);
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return text.includes('จัดการลิงก์ห้องเรียน') && text.includes('สร้างทั้งหมด') && text.includes('สร้างลิงก์');
      },
      'Allowed classroom-links page did not render room rows and actions',
    );
    await waitFor(
      async () =>
        await evaluate(
          client,
          `document.querySelectorAll('[data-slot="data-table"] tbody tr').length > 0`,
        ),
      'Desktop room table did not render',
    );
    await waitFor(
      async () =>
        await evaluate(
          client,
          `Boolean(document.querySelector('[data-homeroom-teacher] [data-slot="avatar"]'))`,
        ),
      'Homeroom teacher avatar did not render beside the teacher name',
    );
    await evaluate(
      client,
      `document.querySelector('[data-homeroom-teacher] button')?.click()`,
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'location.pathname')).startsWith('/teachers/') &&
        String(await evaluate(client, 'document.body.innerText')).includes('ข้อมูลทั่วไป'),
      'Homeroom teacher avatar did not open the scoped read-only teacher profile',
    );
    assert(
      !String(await evaluate(client, 'document.body.innerText')).includes('แก้ไขข้อมูล'),
      'Classroom-link-only user received a teacher edit action',
    );
    assert(
      !(await evaluate(
        client,
        `Boolean(document.querySelector('button[aria-label="แสดงเลขบัตรประชาชน"]'))`,
      )),
      'Classroom-link-only user received a national-id reveal action',
    );
    await clickButton(client, 'ย้อนกลับ');
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === '/attendance/classroom-links',
      'Teacher profile back action did not return to classroom links',
    );

    await clickButton(client, 'สร้างลิงก์ยืนยัน LINE');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'กำหนดอายุลิงก์ยืนยัน LINE',
        ),
      'Shared LINE invitation action did not open its schedule dialog',
    );
    await evaluate(
      client,
      `document.querySelector('[role="dialog"] button[aria-label="Close dialog"]').click()`,
    );

    await evaluate(
      client,
      `(() => {
        // Row actions are icon-only, so the label lives on aria-label/title.
        const buttons = [...document.querySelectorAll('[data-slot="data-table"] tbody button')];
        const labelled = (needle) =>
          buttons.find(
            (item) => (item.getAttribute('aria-label') ?? '').includes(needle) && !item.disabled,
          );
        const button = labelled('สร้างลิงก์') ?? labelled('คัดลอกลิงก์');
        if (!button) throw new Error('Room create/copy-link button not found');
        button.click();
      })()`,
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('คัดลอกหรือแชร์ลิงก์ห้องเรียน'),
      'Create action did not expose the copy/share fallback',
    );
    // Each action reports its own outcome, so the generic save toast must not
    // stack a second toast on top of it.
    const toasts = await evaluate(
      client,
      `[...document.querySelectorAll('[data-sonner-toast]')].map((toast) => toast.innerText.trim())`,
    );
    assert(
      Array.isArray(toasts) && toasts.length <= 1,
      `Create action raised ${Array.isArray(toasts) ? toasts.length : '?'} toasts: ${JSON.stringify(toasts)}`,
    );
    assert(
      !(toasts ?? []).some((toast) => String(toast).includes('บันทึกแล้ว')),
      'Create action fell back to the generic save toast',
    );
    const classroomUrl = String(
      await evaluate(
        client,
        `document.querySelector('[role="dialog"] input[aria-label="ลิงก์ที่จะแชร์"]')?.value ?? ''`,
      ),
    );
    assert(classroomUrl.includes('/check-in#token='), 'Room share dialog omitted the public token URL');
    await evaluate(
      client,
      `document.querySelector('[role="dialog"] button[aria-label="Close dialog"]').click()`,
    );
    await waitFor(
      async () => !String(await evaluate(client, 'document.body.innerText')).includes('คัดลอกหรือแชร์ลิงก์ห้องเรียน'),
      'Share dialog did not close',
    );

    await navigate(client, classroomUrl);
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return (
          text.includes('ยืนยันตัวตนเพื่อเข้าใช้งาน') &&
          text.includes('ยืนยันด้วย Google') &&
          text.includes('ยืนยันด้วย AraID')
        );
      },
      async () =>
        `Public classroom link did not restore the shared identity card with Google and AraID: ${JSON.stringify(
          {
            url: await evaluate(client, 'location.href'),
            text: String(await evaluate(client, 'document.body.innerText')).slice(0, 600),
          },
        )}`,
    );
    assert(
      await evaluate(
        client,
        `location.hash === '' && document.body.innerText.includes('ระบบติดตามผู้เรียน')`,
      ),
      'Public identity page did not use the established guest shell or strip the token fragment',
    );

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/attendance/classroom-links`);
    await waitFor(
      async () => await evaluate(client, `Boolean(document.querySelector('[data-slot="table-card-list"]'))`),
      'Mobile classroom cards did not render',
    );
    assert(
      await evaluate(client, 'document.documentElement.scrollWidth <= window.innerWidth + 1'),
      'Classroom-links page overflows horizontally on mobile',
    );
    assert(
      await evaluate(
        client,
        `[...document.querySelectorAll('[data-slot="table-card-list"] button')]
          .some((item) => (item.getAttribute('aria-label') ?? '').includes('คัดลอกลิงก์')
            || (item.getAttribute('aria-label') ?? '').includes('สร้างลิงก์'))`,
      ),
      'Mobile card did not expose the copy fallback',
    );

    console.error('[smoke] classroom-links browser allowed/denied/homeroom-avatar/create/share/mobile states passed');
  } finally {
    stopProcess(frontend);
    stopProcess(backend);
    await closeChrome(chrome);
    if (context.isInitialized) await context.close().catch(() => undefined);
    const cleanupContext = await NestFactory.createApplicationContext(AppModule, { logger: false });
    try {
      const cleanupDataSource = cleanupContext.get(DataSource);
      if (schoolId && schoolTermId) {
        await cleanupDataSource.query(
          `DELETE FROM classroom_attendance_links
           WHERE school_id = $1 AND school_term_id = $2
             AND NOT (id::text = ANY($3::text[]))`,
          [schoolId, schoolTermId, initialLinkIds],
        );
      }
      await cleanupDataSource.query(
        `UPDATE users SET status = 'DISABLED', permissions = '[]'::jsonb,
           data_scope = '{"own_only":true}'::jsonb
         WHERE username = ANY($1::text[]) AND data_origin_code = 'AUTOMATED_TEST'`,
        [[ALLOWED_USERNAME, DENIED_USERNAME]],
      );
    } finally {
      await cleanupContext.close();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
