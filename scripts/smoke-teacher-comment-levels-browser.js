const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { DataSource } = require('typeorm');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { RiskProfileService } = require('../dist/risk-profile/risk-profile.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run teacher-comment browser smoke in production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9273);
const USERNAME = 'teacher_comment_levels_browser';

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
  throw new Error(lastError ? `${message}: ${lastError.message}` : message);
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        this.events.push(message);
        return;
      }
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

async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description || result.exceptionDetails.text,
    );
  }
  return result.result?.value;
}

async function navigate(client, url) {
  await client.call('Page.navigate', { url });
  await waitFor(
    async () => (await evaluate(client, 'document.readyState')) === 'complete',
    `Page did not load: ${new URL(url).pathname}`,
  );
}

async function pressKey(client, key, code = key) {
  const keyCode = key === 'Enter' ? 13 : key === ' ' ? 32 : undefined;
  await client.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
    ...(keyCode ? { windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode } : {}),
  });
  await client.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    ...(keyCode ? { windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode } : {}),
  });
}

async function openChrome() {
  assert(fs.existsSync(CHROME_PATH), 'Google Chrome executable was not found');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-comment-levels-chrome-'));
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
  const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((res) =>
    res.json(),
  );
  const target = targets.find((item) => item.type === 'page');
  assert(target?.webSocketDebuggerUrl, 'Chrome page target was not available');
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return { client, processRef, userDataDir };
}

async function closeChrome(chrome) {
  chrome?.client.close();
  if (chrome?.processRef?.exitCode === null) {
    chrome.processRef.kill('SIGTERM');
    await new Promise((resolve) => {
      chrome.processRef.once('exit', resolve);
      setTimeout(resolve, 2_000);
    });
    if (chrome.processRef.exitCode === null) {
      chrome.processRef.kill('SIGKILL');
      await new Promise((resolve) => chrome.processRef.once('exit', resolve));
    }
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

function createSessionCookie(service, userId) {
  let cookie;
  service.setSession(
    {
      cookie: (name, value) => {
        cookie = { name, value };
      },
    },
    userId,
  );
  assert(cookie, 'Session cookie was not created');
  return cookie;
}

async function browserRequest(client, method, requestPath, body) {
  return await evaluate(
    client,
    `(async () => {
      const response = await fetch(${JSON.stringify(`${BACKEND_URL}${requestPath}`)}, {
        method: ${JSON.stringify(method)},
        credentials: 'include',
        headers: ${JSON.stringify(body ? { 'Content-Type': 'application/json' } : {})},
        body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'},
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      return { status: response.status, payload };
    })()`,
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  let actor;
  let chrome;
  let touchedStudentUuid;
  try {
    const [student] = await dataSource.query(`
      SELECT
        enrollment.student_uuid::text,
        enrollment.classroom_id::text,
        enrollment."SchoolID_Onec" AS school_id,
        trim(concat_ws(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec"))
          AS student_name
      FROM student_term enrollment
      JOIN student_current_enrollment_resolution current_enrollment
        ON current_enrollment.person_uuid = enrollment.person_uuid
       AND current_enrollment.selected_student_uuid = enrollment.student_uuid
       AND current_enrollment.resolution_state = 'ACTIVE'
      WHERE enrollment.classroom_id IS NOT NULL
        AND enrollment.person_uuid IS NOT NULL
        AND enrollment.deleted_at IS NULL
      ORDER BY enrollment."SchoolID_Onec", enrollment.student_uuid
      LIMIT 1
    `);
    assert(student, 'Smoke requires one current classroom student');
    touchedStudentUuid = student.student_uuid;
    const [outsideStudent] = await dataSource.query(
      `SELECT enrollment.student_uuid::text, enrollment.classroom_id::text
       FROM student_term enrollment
       JOIN student_current_enrollment_resolution current_enrollment
         ON current_enrollment.person_uuid = enrollment.person_uuid
        AND current_enrollment.selected_student_uuid = enrollment.student_uuid
        AND current_enrollment.resolution_state = 'ACTIVE'
       WHERE enrollment."SchoolID_Onec" <> $1
         AND enrollment.classroom_id IS NOT NULL
         AND enrollment.deleted_at IS NULL
       ORDER BY enrollment.student_uuid
       LIMIT 1`,
      [student.school_id],
    );
    assert(outsideStudent, 'Smoke requires one student outside the actor school');

    [actor] = await dataSource.query(
      `INSERT INTO users (
         username, password, status, permissions, "FirstName", "LastName", role,
         data_scope, must_change_password, data_origin_code
       ) VALUES (
         $1, 'NOT_A_LOGIN_CREDENTIAL', 'ACTIVE', $2::jsonb,
         'ผู้ตรวจ', 'ความคิดเห็นอัตโนมัติ', 'ADMIN', $3::jsonb, FALSE, 'AUTOMATED_TEST'
       )
       ON CONFLICT (username) DO UPDATE SET
         status = 'ACTIVE', permissions = EXCLUDED.permissions,
         data_scope = EXCLUDED.data_scope, role = 'ADMIN',
         must_change_password = FALSE, data_origin_code = 'AUTOMATED_TEST',
         deactivated_at = NULL, deactivation_reason_code = NULL, deactivation_note = NULL
       RETURNING id`,
      [
        USERNAME,
        JSON.stringify(['home', 'dashboard', 'students', 'classrooms']),
        JSON.stringify({ school_ids: [student.school_id] }),
      ],
    );
    await dataSource.query(`DELETE FROM classroom_student_comments WHERE authored_by_user_id = $1`, [
      actor.id,
    ]);
    const [sideEffectBaseline] = await dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int FROM cases
          WHERE student_uuid = $1 AND deleted_at IS NULL) AS case_count,
         (SELECT COUNT(*)::int
          FROM tasks task JOIN cases tracked_case ON tracked_case.id = task.case_id
          WHERE tracked_case.student_uuid = $1 AND tracked_case.deleted_at IS NULL) AS task_count`,
      [student.student_uuid],
    );

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
    await client.call('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const cookie = createSessionCookie(sessionCookieService, actor.id);
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
      `localStorage.setItem('sts_user', ${JSON.stringify(
        JSON.stringify({
          id: actor.id,
          username: USERNAME,
          roles: ['ADMIN'],
          permissions: ['home', 'dashboard', 'students', 'classrooms'],
          data_scope: { school_ids: [student.school_id] },
          must_change_password: false,
        }),
      )}); localStorage.setItem('admin_access', 'true');`,
    );

    const denied = await browserRequest(
      client,
      'POST',
      `/api/school-structure/classrooms/${outsideStudent.classroom_id}/students/${outsideStudent.student_uuid}/comments`,
      {
        problemCategory: 'OTHER',
        concernLevelCode: 'NOTE',
        problemDescription: 'ต้องถูกปฏิเสธตามขอบเขตโรงเรียน',
      },
    );
    assert(
      denied.status === 403 || denied.status === 404,
      `Outside-school comment was not denied: ${denied.status}`,
    );
    const [problemCategoryContract, concernLevelContract] = await Promise.all([
      browserRequest(client, 'GET', '/api/school-structure/student-problem-categories'),
      browserRequest(client, 'GET', '/api/school-structure/student-comment-concern-levels'),
    ]);
    assert(
      problemCategoryContract.status === 200 &&
        concernLevelContract.status === 200 &&
        problemCategoryContract.payload?.data?.length === 9 &&
        concernLevelContract.payload?.data?.length === 3,
      `Comment catalog endpoints failed: ${JSON.stringify({
        problemCategoryContract,
        concernLevelContract,
      })}`,
    );

    await navigate(client, `${FRONTEND_URL}/students/${student.student_uuid}`);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes(
        student.student_name,
      ),
      'Student detail did not render',
    );
    await waitFor(
      async () => await evaluate(
        client,
        `[...document.querySelectorAll('button')].some((button) =>
          button.getAttribute('aria-label')?.startsWith('เพิ่มความคิดเห็นของ'))`,
      ),
      'Student comment entry point did not render',
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('button')]
        .find((button) => button.getAttribute('aria-label')?.startsWith('เพิ่มความคิดเห็นของ'))
        .click()`,
    );
    try {
      await waitFor(
        async () => await evaluate(
          client,
          `document.querySelector('#classroom-student-comment-concern-level')?.previousElementSibling?.value === 'NOTE'
            && document.querySelector('#classroom-student-comment-concern-level')?.previousElementSibling?.querySelectorAll('option').length === 3
            && document.querySelector('#classroom-student-problem-category')?.previousElementSibling?.querySelectorAll('option').length === 10`,
        ),
        'Shared comment form did not load the 9-category/3-level contract',
        5_000,
      );
    } catch (error) {
      const state = await evaluate(
        client,
        `({
          href: location.href,
          concernValue: document.querySelector('#classroom-student-comment-concern-level')?.previousElementSibling?.value,
          concernOptions: [...(document.querySelector('#classroom-student-comment-concern-level')?.previousElementSibling?.querySelectorAll('option') ?? [])].map((option) => option.value),
          categoryOptions: [...(document.querySelector('#classroom-student-problem-category')?.previousElementSibling?.querySelectorAll('option') ?? [])].map((option) => option.value),
          categoryError: document.body.innerText.includes('โหลดหัวข้อปัญหาไม่สำเร็จ'),
          concernError: document.body.innerText.includes('โหลดระดับข้อสังเกตไม่สำเร็จ'),
          catalogResources: performance.getEntriesByType('resource')
            .filter((entry) => entry.name.includes('student-problem') || entry.name.includes('comment-concern'))
            .map((entry) => ({
              name: entry.name,
              duration: entry.duration,
              transferSize: entry.transferSize,
              responseStatus: entry.responseStatus,
            })),
          text: document.body.innerText.slice(-800),
        })`,
      );
      const catalogResponseEvents = client.events
        .filter(
          (event) =>
            event.method === 'Network.responseReceived' &&
            (event.params?.response?.url?.includes('student-problem') ||
              event.params?.response?.url?.includes('comment-concern')),
        );
      const catalogResponses = [];
      for (const event of catalogResponseEvents) {
        let body;
        try {
          body = (await client.call('Network.getResponseBody', {
            requestId: event.params.requestId,
          })).body;
        } catch {
          body = null;
        }
        catalogResponses.push({
          url: event.params.response.url,
          status: event.params.response.status,
          mimeType: event.params.response.mimeType,
          body,
        });
      }
      throw new Error(
        `${error.message}: ${JSON.stringify({ ...state, catalogResponses })}`,
      );
    }
    await evaluate(
      client,
      `document.querySelector('#classroom-student-comment-concern-level').focus()`,
    );
    await pressKey(client, 'Enter');
    await waitFor(
      async () => await evaluate(
        client,
        `Boolean(document.querySelector('[role="listbox"]')) && document.activeElement?.getAttribute('role') === 'option'`,
      ),
      'Concern-level select did not open from the keyboard',
    );
    await pressKey(client, 'ArrowDown');
    await pressKey(client, 'Enter');
    await waitFor(
      async () => await evaluate(
        client,
        `document.querySelector('#classroom-student-comment-concern-level')?.previousElementSibling?.value === 'WATCH'
          && document.activeElement?.id === 'classroom-student-comment-concern-level'`,
      ),
      'Concern-level select did not choose WATCH and restore trigger focus',
    );
    await pressKey(client, 'Home');
    await waitFor(
      async () => await evaluate(
        client,
        `document.activeElement?.getAttribute('role') === 'option' && document.activeElement?.textContent?.includes('บันทึกทั่วไป')`,
      ),
      'Concern-level select did not focus NOTE with Home',
    );
    await pressKey(client, 'Enter');
    const concernLevelAfterKeyboard = await evaluate(
      client,
      `document.querySelector('#classroom-student-comment-concern-level')?.previousElementSibling?.value`,
    );
    assert(
      concernLevelAfterKeyboard === 'NOTE',
      `Keyboard interaction did not preserve the safe NOTE default: ${concernLevelAfterKeyboard}`,
    );
    await waitFor(
      async () => await evaluate(
        client,
        `document.activeElement?.id === 'classroom-student-comment-concern-level'`,
      ),
      'Concern-level select did not restore trigger focus after choosing NOTE',
    );
    await pressKey(client, 'Enter');
    await waitFor(
      async () => await evaluate(client, `Boolean(document.querySelector('[role="listbox"]'))`),
      'Concern-level select did not reopen from the keyboard',
    );
    await pressKey(client, 'Escape');
    assert(
      await evaluate(client, `Boolean(document.querySelector('[role="dialog"]'))`),
      'Escape from the concern-level list closed the whole comment dialog',
    );
    await evaluate(
      client,
      `(() => {
        const category = document.querySelector('#classroom-student-problem-category').previousElementSibling;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(category, 'OTHER');
        category.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#classroom-student-problem-description').focus();
      })()`,
    );
    await client.call('Input.insertText', { text: 'บันทึกทั่วไปจาก browser smoke' });
    await waitFor(
      async () => await evaluate(
        client,
        `[...document.querySelectorAll('button')].some((button) =>
          button.textContent.includes('บันทึกข้อมูล') && !button.disabled)`,
      ),
      'Comment submit did not become ready',
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes('บันทึกข้อมูล') && !button.disabled)
        .click()`,
    );
    try {
      await waitFor(
        async () => !(await evaluate(client, `Boolean(document.querySelector('[role="dialog"]'))`)),
        'NOTE comment dialog did not close after save',
        5_000,
      );
    } catch (error) {
      const state = await evaluate(
        client,
        `({
          dialogText: document.querySelector('[role="dialog"]')?.innerText,
          alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.innerText),
        })`,
      );
      const commentResponses = client.events
        .filter(
          (event) =>
            event.method === 'Network.responseReceived' &&
            event.params?.response?.url?.includes('/comments'),
        )
        .map((event) => ({ url: event.params.response.url, status: event.params.response.status }));
      throw new Error(`${error.message}: ${JSON.stringify({ state, commentResponses })}`);
    }

    const noteOnly = await browserRequest(
      client,
      'GET',
      '/api/student-risk-report/teacher-watchlist?page=1&limit=20',
    );
    assert(
      noteOnly.status === 200 && noteOnly.payload.data?.length === 0,
      `NOTE leaked into watchlist: ${JSON.stringify(noteOnly.payload)}`,
    );
    const concern = await browserRequest(
      client,
      'POST',
      `/api/school-structure/classrooms/${student.classroom_id}/students/${student.student_uuid}/comments`,
      {
        problemCategory: 'SAFETY',
        concernLevelCode: 'CONCERN',
        problemDescription: 'น่ากังวลจาก browser smoke',
      },
    );
    assert(concern.status === 201, `CONCERN save failed: ${JSON.stringify(concern.payload)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const watch = await browserRequest(
      client,
      'POST',
      `/api/school-structure/classrooms/${student.classroom_id}/students/${student.student_uuid}/comments`,
      {
        problemCategory: 'ATTENDANCE',
        concernLevelCode: 'WATCH',
        problemDescription: 'ควรเฝ้าดูจาก browser smoke',
      },
    );
    assert(watch.status === 201, `WATCH save failed: ${JSON.stringify(watch.payload)}`);

    const prioritized = await browserRequest(
      client,
      'GET',
      '/api/student-risk-report/teacher-watchlist?page=1&limit=20',
    );
    assert(
      prioritized.status === 200 &&
        prioritized.payload.data?.length === 1 &&
        prioritized.payload.data[0]?.concernLevelCode === 'CONCERN' &&
        prioritized.payload.data[0]?.latestComment === 'น่ากังวลจาก browser smoke' &&
        prioritized.payload.data[0]?.commentCount === 2,
      `Watchlist did not exclude NOTE and prioritize CONCERN: ${JSON.stringify(prioritized.payload)}`,
    );
    const [sideEffectAfter] = await dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int FROM cases
          WHERE student_uuid = $1 AND deleted_at IS NULL) AS case_count,
         (SELECT COUNT(*)::int
          FROM tasks task JOIN cases tracked_case ON tracked_case.id = task.case_id
          WHERE tracked_case.student_uuid = $1 AND tracked_case.deleted_at IS NULL) AS task_count`,
      [student.student_uuid],
    );
    assert(
      sideEffectAfter.case_count === sideEffectBaseline.case_count &&
        sideEffectAfter.task_count === sideEffectBaseline.task_count,
      'Teacher comment save created a case or task side effect',
    );

    await navigate(client, `${FRONTEND_URL}/student-risk-report/watchlist`);
    try {
      await waitFor(
        async () => {
          const body = String(await evaluate(client, 'document.body.innerText'));
          return body.includes('น่ากังวลจาก browser smoke') && body.includes('น่ากังวล');
        },
        'Desktop watchlist did not render prioritized concern',
        5_000,
      );
    } catch (error) {
      const state = await evaluate(
        client,
        `({ href: location.href, text: document.body.innerText.slice(0, 2400) })`,
      );
      const watchlistResponses = client.events
        .filter(
          (event) =>
            event.method === 'Network.responseReceived' &&
            event.params?.response?.url?.includes('teacher-watchlist'),
        )
        .map((event) => ({ url: event.params.response.url, status: event.params.response.status }));
      throw new Error(`${error.message}: ${JSON.stringify({ state, watchlistResponses })}`);
    }
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    assert(
      await evaluate(client, 'document.documentElement.scrollWidth <= window.innerWidth + 1'),
      'Watchlist overflowed horizontally on mobile',
    );
    await navigate(client, `${FRONTEND_URL}/student-risk-report/teacher-comments`);
    await waitFor(
      async () => {
        const body = String(await evaluate(client, 'document.body.innerText'));
        return ['บันทึกทั่วไป', 'ควรเฝ้าดู', 'น่ากังวล'].every((label) =>
          body.includes(label),
        );
      },
      'Comment report did not render all three persisted levels',
    );
    assert(
      await evaluate(client, 'document.documentElement.scrollWidth <= window.innerWidth + 1'),
      'Comment report overflowed horizontally on mobile',
    );

    console.log(
      'teacher comment browser smoke passed (shared form, NOTE exclusion, CONCERN priority, scope, desktop/mobile/keyboard/reduced-motion)',
    );
  } finally {
    if (actor) {
      await dataSource.query(
        `DELETE FROM classroom_student_comments WHERE authored_by_user_id = $1`,
        [actor.id],
      );
      await dataSource.query(
        `UPDATE users SET status = 'DISABLED', permissions = '[]'::jsonb,
           deactivated_at = COALESCE(deactivated_at, now()),
           deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
           deactivation_note = COALESCE(
             deactivation_note, 'Retained automated teacher-comment smoke fixture'
           )
         WHERE id = $1`,
        [actor.id],
      );
      if (touchedStudentUuid) {
        await app
          .get(RiskProfileService)
          .requestStudentRecalculation([touchedStudentUuid], 'teacher-comment-smoke-cleanup');
      }
    }
    await closeChrome(chrome);
    await app.close();
  }
}

main().catch((error) => {
  fs.writeSync(2, `${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
