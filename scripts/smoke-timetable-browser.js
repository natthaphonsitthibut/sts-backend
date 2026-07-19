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
  throw new Error('Refusing to run timetable browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5173';
const BROWSER_BACKEND_URL = process.env.SMOKE_BROWSER_BACKEND_URL || BACKEND_URL;
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9249);
const MANAGER_USERNAME = 'timetable_browser_manager';
const SCOPED_OTHER_SCHOOL_USERNAME = 'timetable_browser_other_school';
const STAFF_USERNAME = 'timetable_browser_staff';
const STUDENT_USERNAME = 'timetable_browser_student';
const STUDENT_PERSON_UUID = '30000000-0000-4000-8000-000000000049';
const STUDENT_UUID = '30000000-0000-4000-8000-000000000149';
const FIXTURE_MARKER_PREFIX = 'TTSMK';

function toSlotDayOfWeek(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-timetable-chrome-'));
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
  await waitFor(
    async () =>
      Boolean(await evaluate(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)),
    `Input did not appear: ${selector}`,
    5_000,
  );
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

async function click(client, expression, message) {
  await waitFor(
    async () => Boolean(await evaluate(client, `Boolean(${expression})`)),
    message,
    5_000,
  );
  await evaluate(
    client,
    `(() => {
      const target = ${expression};
      if (!target) throw new Error(${JSON.stringify(message)});
      target.click();
    })()`,
  );
}

/**
 * Drives the shared `Combobox` (input + <ul><li><button>> panel, options
 * picked via onMouseDown — not onClick, so a real `.click()` never registers).
 */
async function pickComboboxOption(client, inputSelector, searchText, message) {
  await click(client, `document.querySelector(${JSON.stringify(inputSelector)})`, `${message} (open)`);
  if (searchText) {
    await fillInput(client, inputSelector, searchText);
  }
  const findButtonExpr = `
    (() => {
      const input = document.querySelector(${JSON.stringify(inputSelector)});
      const panel = input?.parentElement?.querySelector('ul');
      if (!panel) return null;
      return [...panel.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(searchText || '')})) || null;
    })()
  `;
  await waitFor(
    async () => Boolean(await evaluate(client, `Boolean(${findButtonExpr})`)),
    `${message} (option did not render)`,
  );
  await evaluate(
    client,
    `(() => {
      const button = ${findButtonExpr};
      if (!button) throw new Error(${JSON.stringify(`${message} (option not found)`)});
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
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

async function logoutInBrowser(client) {
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
  await navigate(client, `${FRONTEND_URL}/login`);
  await waitFor(
    async () => String(await evaluate(client, 'location.pathname')).startsWith('/login'),
    'Logout did not return to login',
  );
}

async function pickFixtureRoom(dataSource) {
  const [row] = await dataSource.query(`
    SELECT s."SchoolID_Onec" AS school_id, sc.name AS school_name,
           s."GradeLevelID_Onec" AS grade_level_id, gl.label AS grade_label,
           s."RoomID_Onec" AS room_no, st.id AS school_term_id,
           st.academic_year, st.semester
    FROM student_term s
    JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
    JOIN schools sc ON sc.id = s."SchoolID_Onec"
    JOIN school_terms st ON st.school_id = s."SchoolID_Onec" AND st.status = 'ACTIVE' AND st.deleted_at IS NULL
    WHERE s."RoomID_Onec" IS NOT NULL
    ORDER BY s.student_uuid
    LIMIT 1
  `);
  assert(row, 'No fixture room with an ACTIVE school term was found');
  return row;
}

async function pickDifferentSchool(dataSource, excludeSchoolId) {
  const [row] = await dataSource.query(`SELECT id FROM schools WHERE id <> $1 ORDER BY id LIMIT 1`, [
    excludeSchoolId,
  ]);
  assert(row, 'No second school found to test cross-school scope rejection');
  return row.id;
}

async function cleanup(dataSource) {
  await dataSource.query(
    `
      DELETE FROM attendance
      WHERE session_id IN (
        SELECT sess.id
        FROM attendance_sessions sess
        JOIN subjects sub ON sub.id = sess.subject_id
        WHERE sub.code LIKE $1
      )
    `,
    [`${FIXTURE_MARKER_PREFIX}%`],
  );
  await dataSource.query(
    `
      DELETE FROM attendance_sessions
      WHERE subject_id IN (SELECT id FROM subjects WHERE code LIKE $1)
    `,
    [`${FIXTURE_MARKER_PREFIX}%`],
  );
  await dataSource.query(
    `DELETE FROM task_links WHERE assigned_to_name = 'Timetable Smoke Assignee'`,
  );
  await dataSource.query(
    `DELETE FROM timetable_slots WHERE subject_id IN (SELECT id FROM subjects WHERE code LIKE $1)`,
    [`${FIXTURE_MARKER_PREFIX}%`],
  );
  await dataSource.query(`DELETE FROM subjects WHERE code LIKE $1`, [`${FIXTURE_MARKER_PREFIX}%`]);
  await dataSource.query(`DELETE FROM student_term WHERE student_uuid = $1::uuid`, [STUDENT_UUID]);
}

async function disableActors(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated timetable browser smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [[MANAGER_USERNAME, SCOPED_OTHER_SCHOOL_USERNAME, STAFF_USERNAME, STUDENT_USERNAME]],
  );
}

async function upsertActor(dataSource, passwordHash, username, permissions, dataScope) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2, "FirstName" = 'Timetable', "LastName" = 'Browser Smoke',
            status = 'ACTIVE', permissions = $3::jsonb, role = 'ADMIN', data_scope = $4::jsonb,
            must_change_password = FALSE, temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL, deactivated_at = NULL, deactivated_by = NULL,
            deactivation_reason_code = NULL, deactivation_note = NULL,
            affiliation = 'Automated timetable browser smoke', data_origin_code = 'AUTOMATED_TEST',
            email = NULL, phone = NULL
        WHERE id = $1
      `,
      [existing.id, passwordHash, JSON.stringify(permissions), JSON.stringify(dataScope)],
    );
    return existing;
  }
  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code, email, phone
      )
      VALUES ($1, $2, 'Timetable', 'Browser Smoke', 'ACTIVE', $3::jsonb, 'ADMIN', $4::jsonb, FALSE,
        'Automated timetable browser smoke', 'AUTOMATED_TEST', NULL, NULL)
      RETURNING id
    `,
    [username, passwordHash, JSON.stringify(permissions), JSON.stringify(dataScope)],
  );
  return row;
}

async function upsertStudentActor(dataSource, passwordHash, room) {
  const [loginStatus] = await dataSource.query(
    `SELECT code FROM student_status
     WHERE category = 'ACTIVE' AND is_active_for_login IS TRUE AND is_enabled IS TRUE
       AND deleted_at IS NULL
     ORDER BY code LIMIT 1`,
  );
  assert(loginStatus, 'No login-capable student status was found');

  await dataSource.query(
    `INSERT INTO student_person (person_uuid, identity_status)
     VALUES ($1::uuid, 'ACTIVE')
     ON CONFLICT (person_uuid) DO UPDATE
     SET identity_status = 'ACTIVE', merged_into = NULL, deleted_at = NULL, deleted_by = NULL`,
    [STUDENT_PERSON_UUID],
  );
  await dataSource.query(
    `INSERT INTO student_term (
       student_uuid, person_uuid, "PersonID_Onec", "FirstName_Onec", "LastName_Onec",
       "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec", student_status_code,
       "AcademicYear_Onec", "Semester_Onec", deleted_at, deleted_by
     )
     VALUES ($1::uuid, $2::uuid, 'TTSMK-STUDENT', 'ตารางเรียน', 'นักเรียนทดสอบ',
             $3, $4, $5, $6, $7, $8, NULL, NULL)
     ON CONFLICT (student_uuid) DO UPDATE
     SET person_uuid = EXCLUDED.person_uuid,
         "SchoolID_Onec" = EXCLUDED."SchoolID_Onec",
         "GradeLevelID_Onec" = EXCLUDED."GradeLevelID_Onec",
         "RoomID_Onec" = EXCLUDED."RoomID_Onec",
         student_status_code = EXCLUDED.student_status_code,
         "AcademicYear_Onec" = EXCLUDED."AcademicYear_Onec",
         "Semester_Onec" = EXCLUDED."Semester_Onec",
         deleted_at = NULL,
         deleted_by = NULL`,
    [
      STUDENT_UUID,
      STUDENT_PERSON_UUID,
      room.school_id,
      room.grade_level_id,
      room.room_no,
      loginStatus.code,
      room.academic_year,
      room.semester,
    ],
  );

  const defaultStudentPermissions = ['student-self'];
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    STUDENT_USERNAME,
  ]);
  if (existing) {
    await dataSource.query(
      `UPDATE users
       SET password = $2, "FirstName" = 'ตารางเรียน', "LastName" = 'นักเรียนทดสอบ',
           status = 'ACTIVE', permissions = $3::jsonb, role = 'STUDENT',
           data_scope = '{"own_only":true}'::jsonb, person_uuid = $4::uuid,
           must_change_password = FALSE, temporary_password_issued_at = NULL,
           temporary_password_expires_at = NULL, deactivated_at = NULL, deactivated_by = NULL,
           deactivation_reason_code = NULL, deactivation_note = NULL,
           affiliation = 'Automated timetable browser smoke', data_origin_code = 'AUTOMATED_TEST',
           email = NULL, phone = NULL
       WHERE id = $1`,
      [
        existing.id,
        passwordHash,
        JSON.stringify(defaultStudentPermissions),
        STUDENT_PERSON_UUID,
      ],
    );
    return existing;
  }

  const [row] = await dataSource.query(
    `INSERT INTO users (
       username, password, "FirstName", "LastName", status, permissions, role,
       data_scope, person_uuid, must_change_password, affiliation, data_origin_code, email, phone
     )
     VALUES ($1, $2, 'ตารางเรียน', 'นักเรียนทดสอบ', 'ACTIVE', $3::jsonb, 'STUDENT',
             '{"own_only":true}'::jsonb, $4::uuid, FALSE,
             'Automated timetable browser smoke', 'AUTOMATED_TEST', NULL, NULL)
     RETURNING id`,
    [
      STUDENT_USERNAME,
      passwordHash,
      JSON.stringify(defaultStudentPermissions),
      STUDENT_PERSON_UUID,
    ],
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
  const password = `TimetableBrowser-${suffix}-Password`;
  const subjectCode = `${FIXTURE_MARKER_PREFIX}${suffix.slice(0, 8)}`;
  const subjectName = `วิชาทดสอบตารางสอน ${suffix.slice(0, 6)}`;
  const todaySlotDay = toSlotDayOfWeek(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowSlotDay = toSlotDayOfWeek(tomorrow);
  const todayIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  let chrome;

  try {
    await cleanup(dataSource);
    const room = await pickFixtureRoom(dataSource);
    await dataSource.query(
      `
        UPDATE school_terms
        SET starts_on = ($2::date - INTERVAL '7 days')::date,
            ends_on = ($2::date + INTERVAL '30 days')::date,
            status = 'ACTIVE'
        WHERE id = $1
      `,
      [room.school_term_id, todayIso],
    );
    await dataSource.query(
      `
        INSERT INTO school_calendar_days (school_term_id, calendar_date, day_type, source)
        VALUES ($1, $2::date, 'SCHOOL_DAY', 'MANUAL')
        ON CONFLICT (school_term_id, calendar_date)
        DO UPDATE SET day_type = 'SCHOOL_DAY', source = 'MANUAL'
      `,
      [room.school_term_id, todayIso],
    );
    const otherSchoolId = await pickDifferentSchool(dataSource, room.school_id);

    // Seed the subject + a timetable slot directly — the create/admin CRUD
    // path is already covered by TimetableService/Repository unit tests;
    // this smoke focuses on scope enforcement over real HTTP and on the one
    // genuinely new UI surface: the subject Combobox in CreateTaskPage.
    const [subject] = await dataSource.query(
      `INSERT INTO subjects (code, name_th) VALUES ($1, $2) RETURNING id`,
      [subjectCode, subjectName],
    );
    // Periods 7/8: the full-school demo timetable seed (`ff165a2`) occupies
    // periods 1-6 for every room/day, so period 1 collides with
    // uq_timetable_slots_slot on any non-empty roster fixture.
    const [todaySlot] = await dataSource.query(
      `
        INSERT INTO timetable_slots (school_term_id, school_id, grade_level_id, room_no, day_of_week, period, subject_id)
        VALUES ($1, $2, $3, $4, $5, 7, $6)
        RETURNING id
      `,
      [room.school_term_id, room.school_id, room.grade_level_id, room.room_no, todaySlotDay, subject.id],
    );
    const [tomorrowSlot] = await dataSource.query(
      `
        INSERT INTO timetable_slots (school_term_id, school_id, grade_level_id, room_no, day_of_week, period, subject_id)
        VALUES ($1, $2, $3, $4, $5, 8, $6)
        RETURNING id
      `,
      [room.school_term_id, room.school_id, room.grade_level_id, room.room_no, tomorrowSlotDay, subject.id],
    );

    const managerActor = await upsertActor(
      dataSource,
      await passwordService.hash(password),
      MANAGER_USERNAME,
      ['home', 'create', 'manage-timetable', 'attendance-dashboard'],
      { global: true },
    );
    const scopedOtherSchoolActor = await upsertActor(
      dataSource,
      await passwordService.hash(password),
      SCOPED_OTHER_SCHOOL_USERNAME,
      ['home', 'manage-timetable'],
      { school_ids: [otherSchoolId] },
    );
    const staffActor = await upsertActor(
      dataSource,
      await passwordService.hash(password),
      STAFF_USERNAME,
      ['home'],
      { global: true },
    );
    const studentActor = await upsertStudentActor(
      dataSource,
      await passwordService.hash(password),
      room,
    );

    const managerUser = {
      id: managerActor.id,
      username: MANAGER_USERNAME,
      FirstName: 'Timetable',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home', 'create', 'manage-timetable', 'attendance-dashboard'],
      data_scope: { global: true },
      must_change_password: false,
    };
    const scopedOtherSchoolUser = {
      id: scopedOtherSchoolActor.id,
      username: SCOPED_OTHER_SCHOOL_USERNAME,
      FirstName: 'Timetable',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home', 'manage-timetable'],
      data_scope: { school_ids: [otherSchoolId] },
      must_change_password: false,
    };
    const staffUser = {
      id: staffActor.id,
      username: STAFF_USERNAME,
      FirstName: 'Timetable',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home'],
      data_scope: { global: true },
      must_change_password: false,
    };
    const studentUser = {
      id: studentActor.id,
      username: STUDENT_USERNAME,
      FirstName: 'ตารางเรียน',
      LastName: 'นักเรียนทดสอบ',
      roles: ['STUDENT'],
      permissions: ['student-self'],
      data_scope: { own_only: true },
      student_uuid: STUDENT_UUID,
      must_change_password: false,
    };
    const managerSession = createSessionCookie(sessionCookieService, managerActor.id);
    const scopedOtherSchoolSession = createSessionCookie(sessionCookieService, scopedOtherSchoolActor.id);
    const staffSession = createSessionCookie(sessionCookieService, staffActor.id);
    const studentSession = createSessionCookie(sessionCookieService, studentActor.id);

    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // 1. Scope rejection over real HTTP — an actor scoped to a DIFFERENT
    //    school cannot create a slot in the fixture room (403). The admin UI's
    //    own picker would never let them pick an out-of-scope room in the
    //    first place, so this is proven directly against the live API.
    await loginInBrowser(client, scopedOtherSchoolUser, scopedOtherSchoolSession);
    const rejectedStatus = await evaluate(
      client,
      `(async () => {
        const res = await fetch(${JSON.stringify(`${BROWSER_BACKEND_URL}/api/timetable/slots`)}, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schoolTermId: ${Number(room.school_term_id)},
            schoolId: ${Number(room.school_id)},
            gradeLevelId: ${Number(room.grade_level_id)},
            roomNo: ${Number(room.room_no)},
            dayOfWeek: 2,
            period: 1,
            subjectId: ${Number(subject.id)}
          })
        });
        return res.status;
      })()`,
    );
    assert(rejectedStatus === 403, `Expected 403 for out-of-scope create, got ${rejectedStatus}`);
    await logoutInBrowser(client);

    // 2. Manager (has manage-timetable) sees the admin CRUD view; the fixture
    //    slot seeded above is visible once the manager picks that room.
    await loginInBrowser(client, managerUser, managerSession);
    await navigate(client, `${FRONTEND_URL}/timetable`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'เลือกห้องเรียนเพื่อจัดตารางสอน',
        ),
      'Timetable manage view did not render for the manager',
    );
    await logoutInBrowser(client);

    // 3. Staff without manage-timetable sees the read-only "ตารางของฉัน" view
    //    (tabs), not the admin picker/add-slot controls.
    await loginInBrowser(client, staffUser, staffSession);
    await navigate(client, `${FRONTEND_URL}/timetable`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('ตารางของฉัน') &&
        !String(await evaluate(client, 'document.body.innerText')).includes('เพิ่มคาบสอน'),
      'Staff (non-manager) did not get the read-only schedule view',
    );
    await logoutInBrowser(client);

    // 4. A student lands on their own data even when opening `/`, sees exactly
    //    the two default student navigation items, has no `home` permission,
    //    and gets the own-room timetable without room-selection UI.
    await loginInBrowser(client, studentUser, studentSession);
    await navigate(client, `${FRONTEND_URL}/`);
    await waitFor(
      async () => String(await evaluate(client, 'location.pathname')) === '/my-attendance',
      'Student root route did not redirect to own data',
    );
    const studentNavigation = await evaluate(
      client,
      `(() => {
        const text = document.body.innerText;
        return {
          hasOwnData: text.includes('ข้อมูลตัวเอง'),
          hasTimetable: text.includes('ตารางเรียน'),
          hasHome: text.includes('หน้าหลัก'),
          hasAttendanceGroup: text.includes('ระบบเช็คชื่อ')
        };
      })()`,
    );
    assert(studentNavigation.hasOwnData, 'Student own-data navigation item was missing');
    assert(studentNavigation.hasTimetable, 'Student timetable navigation item was missing');
    assert(!studentNavigation.hasHome, 'Student still saw the home navigation item');
    assert(!studentNavigation.hasAttendanceGroup, 'Student timetable was still nested in the staff attendance group');

    const studentHomeStatus = await evaluate(
      client,
      `(async () => {
        const res = await fetch(${JSON.stringify(`${BROWSER_BACKEND_URL}/api/home-dashboard/summary`)}, {
          credentials: 'include'
        });
        return res.status;
      })()`,
    );
    assert(studentHomeStatus === 403, `Expected student home API to return 403, got ${studentHomeStatus}`);

    await navigate(client, `${FRONTEND_URL}/timetable`);
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return text.includes('ดูตารางเรียนของคุณตามชั้นและห้องปัจจุบัน');
      },
      'Student own-room timetable did not render',
    );
    const studentTimetableText = String(await evaluate(client, 'document.body.innerText'));
    assert(!studentTimetableText.includes('เลือกห้องเรียน'), 'Student timetable exposed the room picker');
    assert(!studentTimetableText.includes('ตารางของฉัน'), 'Student timetable exposed staff view-mode tabs');
    await logoutInBrowser(client);

    // 5. CreateTaskPage — the subject Combobox for an ATTENDANCE link resolves
    //    from real timetable data (the seeded fixture), and the selection is
    //    persisted through to task_links.subject_id end-to-end.
    await loginInBrowser(client, managerUser, managerSession);
    await navigate(client, `${FRONTEND_URL}/create/attendance`);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('สร้างลิงก์'),
      'Create-task page did not render',
    );
    await fillInput(client, '#assigned_to_name', 'Timetable Smoke Assignee');
    await fillInput(client, '#assigned_to_email', 'timetable-smoke@example.test');

    await pickComboboxOption(client, 'input[placeholder="ค้นหาโรงเรียน"]', room.school_name, 'Pick school');
    await pickComboboxOption(client, 'input[placeholder="ค้นหาชั้น"]', room.grade_label, 'Pick grade');
    await pickComboboxOption(client, 'input[placeholder="ค้นหาห้อง"]', String(room.room_no), 'Pick room');
    await fillInput(client, '#subject_id', subjectName);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes(subjectName),
      'Subject combobox did not show the seeded fixture subject',
    );
    await pickComboboxOption(client, '#subject_id', subjectName, 'Pick subject');
    await fillInput(client, '#expires_value', '1');
    await pickComboboxOption(client, '#expires_unit', 'ชั่วโมง', 'Pick hour expiry');

    await click(
      client,
      `[...document.querySelectorAll('label')].find((label) => label.textContent.includes('คาบ 7'))`,
      'Today slot checkbox was not found',
    );
    await click(
      client,
      `[...document.querySelectorAll('label')].find((label) => label.textContent.includes('คาบ 8'))`,
      'Tomorrow slot checkbox was not found',
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('อาจหมดอายุก่อนถึง'),
      'Expiry warning did not render for a slot outside the link lifetime',
    );

    await click(
      client,
      `document.querySelector('form button[type="submit"]')`,
      'Create-link submit button was not found',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('สร้างลิงก์สำเร็จ'),
      'Attendance link was not created',
    );
    const publicTaskUrl = await evaluate(
      client,
      `(() => {
        const link = [...document.querySelectorAll('a')]
          .find((node) => node.textContent.trim() === 'เปิดลิงก์');
        return link?.href || '';
      })()`,
    );
    const token = String(publicTaskUrl).split('/task/').pop()?.split(/[?#]/)[0];
    assert(token, 'Created task result did not expose a public task token');

    const [createdLink] = await dataSource.query(
      `SELECT id, task_id, subject, subject_id FROM task_links WHERE assigned_to_name = 'Timetable Smoke Assignee' ORDER BY created_at DESC LIMIT 1`,
    );
    assert(createdLink, 'Created task_link was not found');
    assert(
      Number(createdLink.subject_id) === Number(subject.id),
      `Expected subject_id ${subject.id}, got ${createdLink.subject_id}`,
    );
    assert(createdLink.subject === subjectName, `Expected subject label "${subjectName}", got "${createdLink.subject}"`);
    const [slotBinding] = await dataSource.query(
      `
        SELECT COUNT(*)::int AS count
        FROM task_link_timetable_slots
        WHERE task_link_id = $1
          AND timetable_slot_id = ANY($2::bigint[])
      `,
      [createdLink.id, [todaySlot.id, tomorrowSlot.id]],
    );
    assert(Number(slotBinding.count) === 2, `Expected 2 linked timetable slots, got ${slotBinding.count}`);
    await dataSource.query(`UPDATE task_links SET otp_verified = 1 WHERE id = $1`, [createdLink.id]);

    const students = await dataSource.query(
      `
        SELECT student_uuid
        FROM student_term
        WHERE "SchoolID_Onec" = $1 AND "GradeLevelID_Onec" = $2 AND "RoomID_Onec" = $3
        ORDER BY student_uuid
      `,
      [room.school_id, room.grade_level_id, room.room_no],
    );
    assert(students.length > 0, 'No fixture student was available for subject attendance detail smoke');
    const attendanceRecords = students.map((student) => ({
      student_id: student.student_uuid,
      status: 'P_PRESENT',
    }));
    const submitResult = await evaluate(
      client,
      `(async () => {
        const res = await fetch(${JSON.stringify(`${BROWSER_BACKEND_URL}/api/tasks/${token}/attendance`)}, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timetable_slot_id: ${Number(todaySlot.id)},
            records: ${JSON.stringify(attendanceRecords)}
          })
        });
        return { status: res.status, body: await res.text() };
      })()`,
    );
    assert(submitResult.status >= 200 && submitResult.status < 300, `Subject attendance submit failed: ${submitResult.status} ${submitResult.body}`);

    await navigate(client, `${FRONTEND_URL}/attendance-links/${createdLink.id}`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('รายวิชา') &&
        String(await evaluate(client, 'document.body.innerText')).includes(subjectName),
      'Admin attendance link detail did not show the subject attendance tag',
    );

    console.log(
      'timetable browser smoke passed (scope rejection, staff/manager/student UI gating, student home denial and own-room schedule, subject slot link creation, expiry warning, guest subject submit, subject detail tag)',
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
