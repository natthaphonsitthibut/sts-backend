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

async function bodyText(client) {
  return String(await evaluate(client, 'document.body.innerText'));
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
  let lineAccountId = null;
  let timetableSlotId = null;

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
        permissions: [
          'manage-teacher-access',
          'manage-school-structure',
          'manage-curriculum',
          'manage-timetable',
          'attendance',
        ],
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
    await dataSource.query(
      `
        UPDATE teacher_messaging_accounts
        SET unlinked_at = now(), unlinked_reason = 'AUTOMATED_TEST_REPLACED'
        WHERE teacher_id = $1
          AND provider = 'LINE'
          AND unlinked_at IS NULL
          AND deleted_at IS NULL
      `,
      [fixture.teacherMemberships[0].teacherId],
    );
    const [lineAccount] = await dataSource.query(
      `
        INSERT INTO teacher_messaging_accounts (
          teacher_id, provider, provider_channel_id, provider_user_id,
          friend_state, verified_via, created_by, updated_by
        )
        VALUES ($1, 'LINE', 'TEACHER_ACCESS_BROWSER_SMOKE', $2, 'FRIEND', 'EMAIL_OTP', $3, $3)
        RETURNING id
      `,
      [
        fixture.teacherMemberships[0].teacherId,
        `U_TEACHER_ACCESS_BROWSER_${Date.now()}`,
        actors.admin.id,
      ],
    );
    lineAccountId = Number(lineAccount.id);
    const schoolId = Number(fixture.term.school_id);
    const [fixtureClassroom] = await dataSource.query(
      `SELECT grade_level_id FROM school_classrooms WHERE id = $1`,
      [fixture.classroom.id],
    );
    assert(fixtureClassroom, 'Teacher access classroom fixture was not persisted');
    const [assignmentSubject] = await dataSource.query(
      `SELECT subject_id FROM classroom_teacher_assignments WHERE id = $1`,
      [fixture.subjectAssignments[0].id],
    );
    assert(assignmentSubject?.subject_id, 'Teacher access subject assignment was not persisted');
    const todayDayOfWeek = new Date().getDay() || 7;
    const [timetableSlot] = await dataSource.query(
      `
        INSERT INTO timetable_slots (
          school_term_id, school_id, grade_level_id, room_no, classroom_id,
          day_of_week, period, subject_id, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, 9, $7, $8, $8)
        RETURNING id
      `,
      [
        fixture.term.id,
        fixture.term.school_id,
        fixtureClassroom.grade_level_id,
        fixture.classroom.roomNumber,
        fixture.classroom.id,
        todayDayOfWeek,
        assignmentSubject.subject_id,
        actors.admin.id,
      ],
    );
    timetableSlotId = Number(timetableSlot.id);
    const studentNumberSeed = String(Date.now()).slice(-8);
    const fixtureStudentNumbers = [`66${studentNumberSeed}1`, `66${studentNumberSeed}2`];
    await dataSource.query(
      `
        UPDATE student_term
        SET student_number = CASE student_uuid
          WHEN $1::uuid THEN $4
          WHEN $2::uuid THEN $5
          ELSE student_number
        END
        WHERE student_uuid = ANY($3::uuid[])
      `,
      [
        fixture.students[0].studentUuid,
        fixture.students[1].studentUuid,
        fixture.students.map((student) => student.studentUuid),
        fixtureStudentNumbers[0],
        fixtureStudentNumbers[1],
      ],
    );
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

    await navigate(client, `${FRONTEND_URL}/teacher-access#token=${grant.token}`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'เลือกยืนยันผ่าน AraID หรือรับรหัสทางอีเมล',
        ),
      'Teacher verification method choice did not load',
    );
    const verificationChoice = await evaluate(
      client,
      `({
        hasAraId: document.body.innerText.includes('AraID'),
        hasEmail: document.body.innerText.includes('อีเมล'),
        hasGuestProfile: Boolean(document.querySelector('[aria-label^="ผู้รับมอบหมาย"]')),
      })`,
    );
    assert(
      verificationChoice.hasAraId && verificationChoice.hasEmail,
      `Teacher verification methods were incomplete: ${JSON.stringify(verificationChoice)}`,
    );
    assert(
      !verificationChoice.hasGuestProfile,
      'Teacher verification method choice rendered an unnecessary guest profile avatar',
    );

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

    const teacherAssignmentPath = await evaluate(
      client,
      `document.querySelector('a[href^="/teacher-access/classes/"]')?.getAttribute('href') || null`,
    );
    assert(teacherAssignmentPath, 'Teacher classroom card did not expose its own route');
    assert(teacherAssignmentPath.endsWith('/roster'), 'Teacher classroom card did not use roster');
    const teacherAssignmentBase = teacherAssignmentPath.replace(/\/roster$/, '');
    await evaluate(
      client,
      `document.querySelector('a[href=${JSON.stringify(teacherAssignmentPath)}]')?.click()`,
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `location.pathname === ${JSON.stringify(teacherAssignmentPath)}
              && document.querySelector('[data-page-breadcrumb]')
              && document.querySelector('a[aria-current="page"][href="/teacher-access"]')
              && !document.querySelector('a[aria-current="page"][href="/teacher-access/timetable"]')`,
          ),
        ),
      'Teacher classroom route did not preserve its breadcrumb/menu owner',
    );
    const teacherClassroomCrumbs = await evaluate(
      client,
      `[...document.querySelector('[data-page-breadcrumb]').querySelectorAll('a, [data-breadcrumb-current]')]
        .map((node) => node.textContent.trim()).filter(Boolean)`,
    );
    assert(
      teacherClassroomCrumbs.length === 2 && teacherClassroomCrumbs[0] === 'ห้องเรียนของฉัน',
      `Teacher classroom breadcrumb was incorrect: ${teacherClassroomCrumbs.join(' > ')}`,
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === 'เช็คชื่อ')?.click()`,
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `location.pathname === ${JSON.stringify(`${teacherAssignmentBase}/attendance`)}
              && document.querySelector('table') && document.body.innerText.includes(${JSON.stringify(
              fixtureStudentNumbers[0],
            )})`,
          ),
        ),
      'Teacher-link attendance table did not render the numbered roster',
    );
    const teacherAttendanceTable = await evaluate(
      client,
      `(() => {
        const table = document.querySelector('table');
        const firstStatusGroup = table.querySelector('[role="group"][aria-label^="สถานะของ"]');
        return {
          headings: [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim()),
          studentNumberSort: table.querySelector('thead th:nth-child(3)')?.getAttribute('aria-sort'),
          studentNumbers: [...table.querySelectorAll('tbody tr')].map(
            (row) => row.cells[2]?.textContent.trim(),
          ),
          statuses: [...firstStatusGroup.querySelectorAll('button')].map((button) => ({
            label: button.textContent.trim(),
            pressed: button.getAttribute('aria-pressed'),
          })),
        };
      })()`,
    );
    assert(
      JSON.stringify(teacherAttendanceTable.headings) ===
        JSON.stringify(['ลำดับ', 'รูปประจำตัว', 'รหัสประจำตัว', 'ชื่อ-นามสกุล', 'สถานะการเข้าเรียน']),
      `Teacher-link attendance headings drifted: ${teacherAttendanceTable.headings.join(' | ')}`,
    );
    assert(
      teacherAttendanceTable.studentNumberSort === 'ascending' &&
        JSON.stringify(teacherAttendanceTable.studentNumbers) === JSON.stringify(fixtureStudentNumbers),
      `Teacher-link attendance did not default to ascending student number: ${JSON.stringify(teacherAttendanceTable)}`,
    );
    assert(
      JSON.stringify(teacherAttendanceTable.statuses.map((item) => item.label)) ===
        JSON.stringify(['มา', 'สาย', 'ลา', 'ขาด']) &&
        teacherAttendanceTable.statuses[0]?.pressed === 'true',
      `Teacher-link attendance status pills drifted: ${JSON.stringify(teacherAttendanceTable.statuses)}`,
    );

    await navigate(client, `${FRONTEND_URL}${teacherAssignmentBase}?tab=attendance`);
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === `${teacherAssignmentBase}/attendance`,
      'Legacy teacher classroom tab did not redirect to canonical attendance',
    );

    await navigate(client, `${FRONTEND_URL}${teacherAssignmentBase}/history`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `location.pathname === ${JSON.stringify(`${teacherAssignmentBase}/history/attendance`)}
              && document.querySelector('[data-breadcrumb-current]')?.textContent.trim()
                === 'ประวัติการเช็คชื่อ'`,
          ),
        ),
      'Teacher attendance history did not use its distinct route/breadcrumb',
    );
    const teacherHistoryCrumbs = await evaluate(
      client,
      `[...document.querySelector('[data-page-breadcrumb]').querySelectorAll('a, [data-breadcrumb-current]')]
        .map((node) => node.textContent.trim()).filter(Boolean)`,
    );
    assert(
      teacherHistoryCrumbs.length === 3 && teacherHistoryCrumbs[0] === 'ห้องเรียนของฉัน',
      `Teacher history breadcrumb was incorrect: ${teacherHistoryCrumbs.join(' > ')}`,
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === 'นำเข้าไฟล์')?.click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) ===
        `${teacherAssignmentBase}/history/imports`,
      'Teacher imports history tab did not persist in the URL',
    );
    await navigate(client, `${FRONTEND_URL}${teacherAssignmentBase}/history/imports`);
    await waitFor(
      async () => (await bodyText(client)).includes('นำเข้าไฟล์'),
      'Teacher imports history direct-open did not survive refresh navigation',
    );
    await evaluate(
      client,
      `Array.from(document.querySelectorAll('button')).find((button) =>
        button.innerText.includes('ย้อนกลับ'))?.click()`,
    );
    await waitFor(
      async () =>
        Boolean(await evaluate(client, `location.pathname === ${JSON.stringify(teacherAssignmentPath)}`)),
      'Teacher history back action did not return to its classroom',
    );

    await navigate(
      client,
      `${FRONTEND_URL}${teacherAssignmentBase}/students/${fixture.students[0].studentUuid}`,
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `location.pathname.startsWith(${JSON.stringify(`${teacherAssignmentBase}/students/`)})
              && document.querySelector('[data-breadcrumb-current]')?.textContent.trim()
                === 'ข้อมูลนักเรียน'`,
          ),
        ),
      'Teacher student profile did not use its classroom breadcrumb',
    );
    const teacherStudentCrumbs = await evaluate(
      client,
      `[...document.querySelector('[data-page-breadcrumb]').querySelectorAll('a, [data-breadcrumb-current]')]
        .map((node) => node.textContent.trim()).filter(Boolean)`,
    );
    assert(
      teacherStudentCrumbs.length === 3 && teacherStudentCrumbs[0] === 'ห้องเรียนของฉัน',
      `Teacher student breadcrumb was incorrect: ${teacherStudentCrumbs.join(' > ')}`,
    );
    await evaluate(
      client,
      `Array.from(document.querySelectorAll('button')).find((button) =>
        button.innerText.includes('ย้อนกลับ'))?.click()`,
    );
    await waitFor(
      async () =>
        Boolean(await evaluate(client, `location.pathname === ${JSON.stringify(teacherAssignmentPath)}`)),
      'Teacher student back action did not return to its classroom',
    );
    await navigate(client, `${FRONTEND_URL}/teacher-access`);

    const authUser = {
      id: actors.admin.id,
      username: USERNAMES.admin,
      FirstName: 'Teacher Access',
      LastName: 'Smoke Admin',
      role: 'ADMIN',
      roles: ['ADMIN'],
      permissions: [
        'manage-teacher-access',
        'manage-school-structure',
        'manage-curriculum',
        'manage-timetable',
        'attendance',
      ],
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

    // Guest teacher access intentionally has no expandable admin navigation;
    // compare the classroom surface, not the two different navigation shells.
    for (const key of ['cardClass', 'coverClass', 'gridClass', 'headerClass']) {
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

    // The toolbar issues one expiring group link, while the row action remains
    // available for a teacher-scoped single-use invitation.
    const lineActions = await evaluate(
      client,
      `(() => {
        const unverifiedRow = [...document.querySelectorAll('tbody tr')].find((row) =>
          row.querySelector('button[aria-label^="ปลดการเชื่อมต่อ LINE ของ"]')?.disabled,
        );
        unverifiedRow?.querySelector('button[aria-label^="เครื่องมือลิงก์ของ"]')?.click();
        return {
          rowFound: Boolean(unverifiedRow),
          globalCreate: [...document.querySelectorAll('button')].some((button) =>
            button.textContent.includes('สร้างลิงก์ยืนยัน LINE')),
        };
      })()`,
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `[...document.querySelectorAll('button')].some((button) =>
              button.getClientRects().length > 0 &&
              button.textContent.includes('ออกลิงก์ยืนยัน LINE'))`,
          ),
        ),
      'The unverified teacher row did not expose a scoped LINE invitation action',
    );
    assert(
      lineActions.rowFound && lineActions.globalCreate,
      `LINE invitation scope is wrong: ${JSON.stringify(lineActions)}`,
    );

    await evaluate(
      client,
      `[...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes('สร้างลิงก์ยืนยัน LINE'))?.click()`,
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `document.querySelector('[role="dialog"]')?.textContent.includes('กำหนดอายุลิงก์ยืนยัน LINE')`,
          ),
        ),
      'Group LINE link scheduling dialog did not open',
    );
    const groupDialog = await evaluate(
      client,
      `(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const buttons = [...dialog.querySelectorAll('button')];
        return {
          hasStart: dialog.textContent.includes('วันและเวลาเริ่ม'),
          hasExpiry: dialog.textContent.includes('วันและเวลาหมดอายุ'),
          hasDuration: dialog.textContent.includes('ระยะเวลา'),
          hasDurationTime: dialog.textContent.includes('ชั่วโมง:นาที'),
          equalFooterWidths: (() => {
            const cancel = buttons.find((button) => button.textContent.trim() === 'ยกเลิก');
            const create = buttons.find((button) => button.textContent.includes('สร้างลิงก์'));
            return Boolean(cancel && create && Math.abs(
              cancel.getBoundingClientRect().width - create.getBoundingClientRect().width,
            ) < 1);
          })(),
        };
      })()`,
    );
    assert(
      groupDialog.hasStart && groupDialog.hasExpiry && groupDialog.hasDuration &&
        groupDialog.hasDurationTime && groupDialog.equalFooterWidths,
      `Group LINE scheduling controls drifted: ${JSON.stringify(groupDialog)}`,
    );
    await evaluate(
      client,
      `document.querySelector('#line-group-duration-unit')?.parentElement?.querySelector('button')?.click()`,
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('[role="option"]')]
        .find((option) => option.textContent.trim() === 'วัน')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`,
    );
    await evaluate(
      client,
      `(() => {
        const input = document.querySelector('#line-group-duration');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '12');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
    );
    await evaluate(
      client,
      `document.querySelector('#line-group-duration-unit')?.parentElement?.querySelector('button')?.click()`,
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('[role="option"]')]
        .find((option) => option.textContent.trim() === 'สัปดาห์')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`,
    );
    const preservedDuration = await evaluate(
      client,
      `({
        amount: document.querySelector('#line-group-duration')?.value,
        unit: document.querySelector('#line-group-duration-unit')?.textContent.trim(),
      })`,
    );
    assert(
      preservedDuration.amount === '12' && preservedDuration.unit === 'สัปดาห์',
      `Changing duration units rewrote the amount: ${JSON.stringify(preservedDuration)}`,
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent.trim() === 'ยกเลิก')?.click()`,
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes('สร้างลิงก์ยืนยัน LINE'))?.click()`,
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `document.querySelector('[role="dialog"]')?.textContent.includes('กำหนดอายุลิงก์ยืนยัน LINE')`,
          ),
        ),
      'Group LINE scheduling dialog did not reopen',
    );
    const resetDuration = await evaluate(
      client,
      `({
        amount: document.querySelector('#line-group-duration')?.value,
        unit: document.querySelector('#line-group-duration-unit')?.textContent.trim(),
      })`,
    );
    assert(
      resetDuration.amount === '1' && resetDuration.unit === 'สัปดาห์',
      `Group LINE scheduling draft did not reset: ${JSON.stringify(resetDuration)}`,
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent.trim() === 'ยกเลิก')?.click()`,
    );

    const unlinkSnapshot = await evaluate(
      client,
      `(() => ({
        rowCount: [...document.querySelectorAll('tbody tr')]
          .filter((row) => row.getClientRects().length > 0).length,
        avatarCount: [...document.querySelectorAll('[data-teacher-link-avatar]')]
          .filter((avatar) => avatar.getClientRects().length > 0).length,
        actions: [...document.querySelectorAll('button[aria-label^="ปลดการเชื่อมต่อ LINE ของ"]')]
          .filter((button) => button.getClientRects().length > 0)
          .map((button) => ({
            label: button.getAttribute('aria-label'),
            disabled: button.disabled,
            title: button.getAttribute('title'),
          })),
      }))()`,
    );
    const unlinkActions = unlinkSnapshot.actions;
    assert(
      unlinkSnapshot.rowCount > 0 && unlinkActions.length === unlinkSnapshot.rowCount,
      `Every visible teacher row must render a LINE unlink icon: ${JSON.stringify(unlinkSnapshot)}`,
    );
    assert(
      unlinkSnapshot.avatarCount === unlinkSnapshot.rowCount,
      `Every visible teacher row must render a profile avatar: ${JSON.stringify(unlinkSnapshot)}`,
    );
    assert(
      unlinkActions.some((action) => action.disabled) &&
        unlinkActions.some((action) => !action.disabled),
      `LINE unlink enablement did not match verification state: ${JSON.stringify(unlinkActions)}`,
    );
    assert(
      unlinkActions.every((action) => action.title),
      'LINE unlink icons did not expose hover text',
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('button[aria-label^="ปลดการเชื่อมต่อ LINE ของ"]')]
        .find((button) => button.getClientRects().length > 0 && !button.disabled)?.click()`,
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `[...document.querySelectorAll('button')].some((button) =>
              button.getClientRects().length > 0 && button.textContent.trim() === 'ปลดการเชื่อมต่อ')`,
          ),
        ),
      'LINE unlink confirmation did not open',
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('button')]
        .find((button) => button.getClientRects().length > 0 &&
          button.textContent.trim() === 'ปลดการเชื่อมต่อ')?.click()`,
    );
    await waitFor(async () => {
      const [account] = await dataSource.query(
        `SELECT unlinked_reason FROM teacher_messaging_accounts WHERE id = $1`,
        [lineAccountId],
      );
      return account?.unlinked_reason === 'UNLINKED_BY_SCHOOL_ADMIN';
    }, 'LINE account was not unlinked by the scoped admin action');
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `[...document.querySelectorAll('button[aria-label^="ปลดการเชื่อมต่อ LINE ของ"]')]
              .filter((button) => button.getClientRects().length > 0)
              .every((button) => button.disabled)`,
          ),
        ),
      'Teacher roster did not refresh the LINE unlink state',
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
            `document.querySelector('input[id^="classrooms-"]') &&
             !document.querySelector('input[id^="classrooms-"]').disabled`,
          ),
        ),
      'Curriculum classroom MultiSelect did not become ready',
    );
    await evaluate(client, `document.querySelector('input[id^="classrooms-"]').focus()`);
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
    // Typing must narrow the list: a school's teacher list is far longer than
    // the panel, so a picker that only scrolls is unusable in practice.
    const searchNarrowed = await evaluate(
      client,
      `(async () => {
        const input = document.querySelector('input[id^="classrooms-"]');
        input.focus();
        const before = document.querySelectorAll('[role="option"]').length;
        const label = document.querySelector('[role="option"]')?.textContent?.trim() ?? '';
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, label);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 150));
        const after = document.querySelectorAll('[role="option"]').length;
        setter?.call(input, 'ไม่มีทางตรงกับอะไรเลย');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 150));
        const none = document.querySelectorAll('[role="option"]').length;
        setter?.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { before, after, none, label };
      })()`,
    );
    assert(
      searchNarrowed.before > 0 &&
        searchNarrowed.after > 0 &&
        searchNarrowed.after <= searchNarrowed.before &&
        searchNarrowed.none === 0,
      `MultiSelect search did not filter its options: ${JSON.stringify(searchNarrowed)}`,
    );

    await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape' });
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `!document.querySelector('[role="listbox"]') &&
             document.activeElement?.matches('input[id^="classrooms-"]')`,
          ),
        ),
      'MultiSelect Escape did not close and return focus to its trigger',
    );

    const attendanceScope = {
      school_ids: [schoolId],
      grade_levels: [Number(fixtureClassroom.grade_level_id)],
      room_ids: [fixture.classroom.roomNumber],
    };
    await dataSource.query(`UPDATE users SET data_scope = $2::jsonb WHERE id = $1`, [
      actors.admin.id,
      JSON.stringify(attendanceScope),
    ]);
    const attendanceUser = { ...authUser, data_scope: attendanceScope };
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(attendanceUser))})`,
    );
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(client, `${FRONTEND_URL}/attendance/check-in`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `document.querySelector('table') &&
             document.body.innerText.includes(${JSON.stringify(fixtureStudentNumbers[0])}) &&
             document.body.innerText.includes('บันทึกการเช็คชื่อ 2 คน')`,
          ),
        ),
      'Authenticated attendance page did not render the fixture roster',
    );
    const systemAttendanceTable = await evaluate(
      client,
      `(() => {
        const table = document.querySelector('table');
        const firstStatusGroup = table.querySelector('[role="group"][aria-label^="สถานะของ"]');
        const statuses = [...firstStatusGroup.querySelectorAll('button')];
        statuses[1].click();
        return {
          headings: [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim()),
          labels: statuses.map((button) => button.textContent.trim()),
          studentNumberSort: table.querySelector('thead th:nth-child(3)')?.getAttribute('aria-sort'),
          studentNumbers: [...table.querySelectorAll('tbody tr')].map(
            (row) => row.cells[2]?.textContent.trim(),
          ),
        };
      })()`,
    );
    assert(
      JSON.stringify(systemAttendanceTable.headings) ===
        JSON.stringify(['ลำดับ', 'รูปประจำตัว', 'รหัสประจำตัว', 'ชื่อ-นามสกุล', 'สถานะการเข้าเรียน']),
      `Authenticated attendance headings drifted: ${systemAttendanceTable.headings.join(' | ')}`,
    );
    assert(
      systemAttendanceTable.studentNumberSort === 'ascending' &&
        JSON.stringify(systemAttendanceTable.studentNumbers) === JSON.stringify(fixtureStudentNumbers),
      `Authenticated attendance did not default to ascending student number: ${JSON.stringify(systemAttendanceTable)}`,
    );
    assert(
      JSON.stringify(systemAttendanceTable.labels) === JSON.stringify(['มา', 'สาย', 'ลา', 'ขาด']),
      `Authenticated attendance status pills drifted: ${systemAttendanceTable.labels.join(' | ')}`,
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `document.querySelector('table [role="group"] button:nth-child(2)')
              ?.getAttribute('aria-pressed') === 'true'`,
          ),
        ),
      'Authenticated attendance status selection did not update',
    );
    const searchNarrowedAttendance = await evaluate(
      client,
      `(async () => {
        const input = document.querySelector('input[placeholder="ค้นหา"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, ${JSON.stringify(fixtureStudentNumbers[0])});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 150));
        return document.querySelectorAll('tbody tr').length;
      })()`,
    );
    assert(
      searchNarrowedAttendance === 1,
      `Authenticated attendance search returned ${searchNarrowedAttendance} rows instead of 1`,
    );
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const mobileAttendanceOverflow = await evaluate(
      client,
      `(() => {
        const table = document.querySelector('table');
        const scroller = table.parentElement;
        return {
          internal: scroller.scrollWidth > scroller.clientWidth,
          page: document.documentElement.scrollWidth <= window.innerWidth + 1,
        };
      })()`,
    );
    assert(
      mobileAttendanceOverflow.internal && mobileAttendanceOverflow.page,
      `Authenticated attendance mobile overflow escaped its table: ${JSON.stringify(mobileAttendanceOverflow)}`,
    );

    await navigate(client, `${FRONTEND_URL}/line-link/result?status=success`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `document.body.innerText.includes('เชื่อมบัญชี LINE สำเร็จ')`,
          ),
        ),
      'LINE link success result did not render',
    );
    const resultHasProfile = await evaluate(
      client,
      `Boolean(document.querySelector('header [aria-label^="ผู้รับมอบหมาย"]'))`,
    );
    assert(!resultHasProfile, 'LINE link result rendered an unnecessary guest profile avatar');

    console.log(
      JSON.stringify({
        status: 'teacher_access_browser_smoke_ok',
        checked: [
          'teacher and director reuse identical classroom card, grid, search, header and sidebar treatments',
          'teacher and director card hover transform and shadow are identical',
          'teacher card color updates every subject card for the shared classroom',
          'teacher-link roster sorting reaches the server',
          'teacher-link and authenticated attendance default to ascending student number in the shared numbered roster',
          'authenticated attendance search, status selection and mobile internal scrolling work',
          'teacher-link classroom, history and student routes keep their breadcrumbs, menu owner and safe back targets',
          'LINE invitations are scoped to unverified teacher rows with no global reusable URL',
          'teacher-link roster renders one profile avatar per visible teacher',
          'LINE unlink icons stay visible, disable by verification state and refresh after unlink',
          'teacher verification method choice offers AraID/email without a guest profile avatar',
          'LINE link result omits the guest profile avatar',
          'curriculum MultiSelect filters as you type and supports ArrowDown, Enter and Escape',
        ],
      }),
    );
  } finally {
    otpCapture.restore();
    await closeChrome(chrome);
    if (lineAccountId) {
      await dataSource.query(`DELETE FROM teacher_messaging_accounts WHERE id = $1`, [lineAccountId]);
    }
    if (timetableSlotId) {
      await dataSource.query(`DELETE FROM timetable_slots WHERE id = $1`, [timetableSlotId]);
    }
    await cleanup(dataSource);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
