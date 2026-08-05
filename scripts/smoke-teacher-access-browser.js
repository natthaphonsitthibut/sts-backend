const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');
const {
  USERNAMES,
  assert,
  assertSchemaPrerequisites,
  captureOtpCodes,
  cleanup,
  createFixture,
  issueGrant,
  sessionCookieHeader,
  upsertUser,
  verifiedSession,
} = require('./smoke-teacher-access');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run teacher access browser smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9255);

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
  throw new Error(lastError ? `${message}: ${lastError.message}` : message);
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
    `Page did not load: ${url.replace(/#.*$/, '#[REDACTED]')}`,
  );
}

async function openChrome() {
  assert(fs.existsSync(CHROME_PATH), 'Google Chrome executable was not found');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-teacher-access-chrome-'));
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
  chrome.client.close();
  chrome.processRef.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => chrome.processRef.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  if (chrome.userDataDir.startsWith(os.tmpdir())) {
    fs.rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function cardSnapshot(client, classroomId) {
  return await evaluate(
    client,
    `(() => {
      const card = document.querySelector('[data-classroom-card="${classroomId}"]');
      if (!card) return null;
      const cover = card.querySelector('[data-classroom-cover]');
      const input = document.querySelector('input[placeholder="ค้นหา"]');
      const heading = document.querySelector('main h1');
      const grid = card.parentElement;
      const style = (element) => {
        const computed = getComputedStyle(element);
        return {
          backgroundColor: computed.backgroundColor,
          borderColor: computed.borderColor,
          borderRadius: computed.borderRadius,
          boxShadow: computed.boxShadow,
          color: computed.color,
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          height: computed.height,
          scale: computed.scale,
          transform: computed.transform,
        };
      };
      return {
        cardClass: card.className,
        cardStyle: style(card),
        coverClass: cover.className,
        coverStyle: style(cover),
        gridClass: grid.className,
        headerClass: document.querySelector('header')?.className || null,
        sidebarClass: document.querySelector('aside')?.className || null,
        headingStyle: heading ? style(heading) : null,
        inputStyle: input ? style(input) : null,
        rect: (() => {
          const rect = card.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })(),
      };
    })()`,
  );
}

async function hoverSnapshot(client, classroomId) {
  await evaluate(
    client,
    `document.querySelector('[data-classroom-card="${classroomId}"]')?.scrollIntoView({ block: 'center' })`,
  );
  const before = await cardSnapshot(client, classroomId);
  assert(before, `Classroom card ${classroomId} was not found`);
  await client.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: before.rect.x,
    y: before.rect.y,
  });
  await new Promise((resolve) => setTimeout(resolve, 220));
  return await cardSnapshot(client, classroomId);
}

async function main() {
  const frontendProbe = await fetch(FRONTEND_URL).catch(() => null);
  assert(frontendProbe?.ok, `Start the smoke frontend at ${FRONTEND_URL} before running`);

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.enableCors({ origin: FRONTEND_URL, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: false,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: createValidationException,
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());
  await app.listen(0, '127.0.0.1');

  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  const address = app.getHttpServer().address();
  const backendUrl = `http://127.0.0.1:${address.port}`;
  const otpCapture = captureOtpCodes(app);
  let chrome;

  try {
    await assertSchemaPrerequisites(dataSource);
    const [initialSchool] = await dataSource.query(
      `SELECT id FROM schools WHERE school_status = 'ACTIVE' ORDER BY id LIMIT 1`,
    );
    assert(initialSchool, 'Teacher access browser smoke requires an active school');
    const actors = {
      admin: await upsertUser(dataSource, {
        username: USERNAMES.admin,
        firstName: 'Teacher Access',
        lastName: 'Smoke Admin',
        role: 'ADMIN',
        permissions: ['manage-teacher-access', 'manage-school-structure', 'manage-curriculum'],
        dataScope: { school_ids: [Number(initialSchool.id)] },
      }),
      teacherOne: await upsertUser(dataSource, {
        username: USERNAMES.teacherOne,
        firstName: 'Teacher One',
        lastName: 'Smoke',
        role: 'TEACHER',
        permissions: ['attendance'],
        dataScope: { school_ids: [Number(initialSchool.id)] },
      }),
      teacherTwo: await upsertUser(dataSource, {
        username: USERNAMES.teacherTwo,
        firstName: 'Teacher Two',
        lastName: 'Smoke',
        role: 'TEACHER',
        permissions: ['attendance'],
        dataScope: { school_ids: [Number(initialSchool.id)] },
      }),
    };
    await cleanup(dataSource);
    const fixture = await createFixture(dataSource, actors);
    const schoolId = Number(fixture.term.school_id);
    const [fixtureClassroom] = await dataSource.query(
      `SELECT grade_level_id FROM school_classrooms WHERE id = $1`,
      [fixture.classroom.id],
    );
    assert(fixtureClassroom, 'Teacher access classroom fixture was not persisted');
    for (const actor of Object.values(actors)) {
      await dataSource.query(`UPDATE users SET status = 'ACTIVE', data_scope = $2::jsonb WHERE id = $1`, [
        actor.id,
        JSON.stringify({ school_ids: [schoolId] }),
      ]);
    }
    const adminCookie = sessionCookieHeader(sessionCookieService, actors.admin.id);
    const grant = await issueGrant(backendUrl, adminCookie, {
      teacherMembershipId: fixture.teacherMemberships[0].id,
      schoolTermId: Number(fixture.term.id),
    });
    const sessionToken = await verifiedSession(
      backendUrl,
      grant.token,
      otpCapture,
      `${USERNAMES.teacherOne}@sts-smoke.invalid`,
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
    await client.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          const backendUrl = ${JSON.stringify(backendUrl)};
          const rewrite = (url) => {
            if (typeof url !== 'string') return url;
            const parsed = new URL(url, window.location.origin);
            return parsed.port === '3000' ? backendUrl + parsed.pathname + parsed.search : url;
          };
          const originalOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this.__stsSmokeUrl = rewrite(url);
            return originalOpen.call(this, method, this.__stsSmokeUrl, ...rest);
          };
          const originalSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('loadend', () => {
              window.__stsSmokeRequests = window.__stsSmokeRequests || [];
              window.__stsSmokeRequests.push({ url: this.__stsSmokeUrl, status: this.status });
            });
            return originalSend.apply(this, args);
          };
        })();
      `,
    });
    await client.call('Network.setCookie', {
      name: adminCookie.slice(0, adminCookie.indexOf('=')),
      value: adminCookie.slice(adminCookie.indexOf('=') + 1),
      url: backendUrl,
      httpOnly: true,
      sameSite: 'Lax',
    });

    await navigate(client, `${FRONTEND_URL}/teacher-access`);
    await evaluate(
      client,
      `sessionStorage.setItem('sts_teacher_link_session', ${JSON.stringify(
        JSON.stringify({ token: grant.token, sessionToken }),
      )}); location.reload()`,
    );
    try {
      await waitFor(
        async () =>
          String(await evaluate(client, 'document.body.innerText')).includes('ห้องเรียนของฉัน'),
        'Teacher classroom page did not load',
      );
    } catch (error) {
      const diagnostic = await evaluate(
        client,
        `({
          pathname: location.pathname,
          text: document.body.innerText.slice(0, 800),
          requests: (window.__stsSmokeRequests || []).slice(-8),
        })`,
      );
      throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
    }
    const classroomId = fixture.classroom.id;
    const teacherBase = await cardSnapshot(client, classroomId);
    const teacherHover = await hoverSnapshot(client, classroomId);
    assert(
      teacherHover.cardStyle.scale !== 'none' && teacherHover.cardStyle.scale !== '1',
      'Teacher classroom card hover did not scale',
    );
    assert(
      teacherHover.cardStyle.boxShadow !== teacherBase.cardStyle.boxShadow,
      'Teacher classroom card hover shadow did not change',
    );

    const paletteOpened = await evaluate(
      client,
      `(() => {
        const card = document.querySelector('[data-classroom-card="${classroomId}"]');
        const menu = [...card.querySelectorAll('button')].find((button) =>
          button.getAttribute('aria-label')?.startsWith('ปรับแต่งการ์ดห้อง'));
        menu?.click();
        return Boolean(menu);
      })()`,
    );
    assert(paletteOpened, 'Teacher classroom color palette trigger was not interactive');
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('[data-classroom-card="${classroomId}"] button[aria-label^="เลือกสี"][aria-pressed="false"]'))`,
          ),
        ),
      'Teacher classroom color palette did not open',
    );
    await evaluate(
      client,
      `document.querySelector('[data-classroom-card="${classroomId}"] button[aria-label^="เลือกสี"][aria-pressed="false"]').click()`,
    );
    await waitFor(
      async () => {
        const colors = await evaluate(
          client,
          `[...document.querySelectorAll('[data-classroom-card="${classroomId}"] [data-classroom-cover]')]
            .map((cover) => getComputedStyle(cover).backgroundColor)`,
        );
        return colors.length >= 2 && new Set(colors).size === 1 && colors[0] !== teacherBase.coverStyle.backgroundColor;
      },
      'Teacher classroom color did not update consistently across subject cards',
    );

    const authUser = {
      id: actors.admin.id,
      username: USERNAMES.admin,
      FirstName: 'Teacher Access',
      LastName: 'Smoke Admin',
      role: 'ADMIN',
      roles: ['ADMIN'],
      permissions: ['manage-teacher-access', 'manage-school-structure', 'manage-curriculum'],
      data_scope: { school_ids: [schoolId] },
      status: 'ACTIVE',
    };
    await evaluate(
      client,
      `sessionStorage.removeItem('sts_teacher_link_session');
       localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(authUser))});
       localStorage.setItem('admin_access', 'true');`,
    );
    await navigate(client, `${FRONTEND_URL}/classrooms`);
    await waitFor(
      async () => Boolean(await cardSnapshot(client, classroomId)),
      'Director classroom page did not render the fixture card',
    );
    const directorBase = await cardSnapshot(client, classroomId);
    const directorHover = await hoverSnapshot(client, classroomId);

    for (const key of ['cardClass', 'coverClass', 'gridClass', 'headerClass', 'sidebarClass']) {
      assert(
        teacherBase[key] === directorBase[key],
        `Teacher/director classroom ${key} drifted`,
      );
    }
    for (const key of ['borderColor', 'borderRadius', 'boxShadow']) {
      assert(
        teacherBase.cardStyle[key] === directorBase.cardStyle[key],
        `Teacher/director classroom card ${key} drifted`,
      );
    }
    assert(
      teacherHover.cardStyle.scale === directorHover.cardStyle.scale &&
        teacherHover.cardStyle.transform === directorHover.cardStyle.transform &&
        teacherHover.cardStyle.boxShadow === directorHover.cardStyle.boxShadow,
      'Teacher/director classroom hover treatment drifted',
    );
    assert(
      JSON.stringify(teacherBase.inputStyle) === JSON.stringify(directorBase.inputStyle),
      'Teacher/director classroom search control drifted',
    );
    assert(
      JSON.stringify(teacherBase.headingStyle) === JSON.stringify(directorBase.headingStyle),
      'Teacher/director classroom heading treatment drifted',
    );

    await navigate(client, `${FRONTEND_URL}/attendance-links`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `[...document.querySelectorAll('th button')].some((button) => button.textContent.includes('ชื่อ-นามสกุล'))`,
          ),
        ),
      'Teacher-link roster sortable header did not render',
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('th button')]
        .find((button) => button.textContent.includes('ชื่อ-นามสกุล')).click()`,
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `(window.__stsSmokeRequests || []).some((request) =>
              request.url.includes('/teacher-access-grants/teacher-roster') &&
              request.url.includes('sortBy=name') && request.url.includes('sortOrder=asc'))`,
          ),
        ),
      'Teacher-link roster sort did not reach the server before pagination',
    );

    // The LINE verification page is one static URL shared with every teacher,
    // so this copy button is the only place the product hands it out. Without
    // it an admin can see "ยังไม่ยืนยัน" and have no way to act on it.
    const lineActions = await evaluate(
      client,
      `(() => {
        const labels = [...document.querySelectorAll('button')].map((button) => button.textContent);
        return {
          send: labels.some((text) => text.includes('ส่งลิงก์ทาง LINE') || text.includes('ส่งทาง LINE')),
          copy: labels.some((text) => text.includes('คัดลอกลิงก์ยืนยัน LINE')),
        };
      })()`,
    );
    assert(
      lineActions.send === lineActions.copy,
      `LINE actions are out of step: send=${lineActions.send}, copy=${lineActions.copy}`,
    );

    await navigate(
      client,
      `${FRONTEND_URL}/curriculum/${fixtureClassroom.grade_level_id}/subjects/new` +
        `?schoolId=${schoolId}&termId=${fixture.term.id}`,
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `document.querySelector('button[id^="classrooms-"]') &&
             !document.querySelector('button[id^="classrooms-"]').disabled`,
          ),
        ),
      'Curriculum classroom MultiSelect did not become ready',
    );
    await evaluate(client, `document.querySelector('button[id^="classrooms-"]').focus()`);
    await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown' });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown' });
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `document.querySelector('[role="listbox"]') &&
             document.activeElement?.getAttribute('role') === 'option'`,
          ),
        ),
      'MultiSelect ArrowDown did not open and focus its first option',
    );
    await client.call('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await client.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    try {
      await waitFor(
        async () =>
          Boolean(
            await evaluate(
              client,
              `Boolean(document.querySelector('button[aria-label^="นำ "][aria-label$=" ออก"]'))`,
            ),
          ),
        'MultiSelect keyboard selection did not create a removable chip',
      );
    } catch (error) {
      const diagnostic = await evaluate(
        client,
        `({
          activeRole: document.activeElement?.getAttribute('role'),
          activeSelected: document.activeElement?.getAttribute('aria-selected'),
          activeText: document.activeElement?.textContent,
          labels: [...document.querySelectorAll('button[aria-label]')]
            .map((button) => button.getAttribute('aria-label')).slice(-12),
        })`,
      );
      throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
    }
    await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape' });
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `!document.querySelector('[role="listbox"]') &&
             document.activeElement?.matches('button[id^="classrooms-"]')`,
          ),
        ),
      'MultiSelect Escape did not close and return focus to its trigger',
    );

    console.log(
      JSON.stringify({
        status: 'teacher_access_browser_smoke_ok',
        checked: [
          'teacher and director reuse identical classroom card, grid, search, header and sidebar treatments',
          'teacher and director card hover transform and shadow are identical',
          'teacher card color updates every subject card for the shared classroom',
          'teacher-link roster sorting reaches the server',
          'the LINE verification link is copyable wherever sending over LINE is offered',
          'curriculum MultiSelect supports ArrowDown, Enter and Escape with focus restoration',
        ],
      }),
    );
  } finally {
    otpCapture.restore();
    await closeChrome(chrome);
    await cleanup(dataSource);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
