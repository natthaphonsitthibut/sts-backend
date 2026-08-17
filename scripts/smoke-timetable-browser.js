const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { StudentAuthService } = require('../dist/auth/student-auth.service');

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
const STUDENT_NATIONAL_ID = '3000000000049';
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
      Boolean(
        await evaluate(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`),
      ),
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
 * Drives the shared `Combobox` (input + <ul><li><button>> panel). Wait for
 * each cascade input to become enabled before selecting its option.
 */
async function pickComboboxOption(client, inputSelector, searchText, message) {
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const input = document.querySelector(${JSON.stringify(inputSelector)});
            return Boolean(input && !input.disabled);
          })()`,
        ),
      ),
    `${message} (input stayed disabled)`,
  );
  await click(
    client,
    `document.querySelector(${JSON.stringify(inputSelector)})`,
    `${message} (open)`,
  );
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
      button.click();
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
  if (sessionCookie) {
    await client.call('Network.setCookie', {
      name: sessionCookie.name,
      value: sessionCookie.value,
      url: BROWSER_BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
  }
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
  const [row] = await dataSource.query(
    `SELECT id FROM schools WHERE id <> $1 ORDER BY id LIMIT 1`,
    [excludeSchoolId],
  );
  assert(row, 'No second school found to test cross-school scope rejection');
  return row.id;
}

async function cleanup(dataSource) {
  await dataSource.query(
    `
      DELETE FROM school_period_times
      WHERE created_by IN (
        SELECT id FROM users WHERE username = ANY($1::text[])
      )
    `,
    [[MANAGER_USERNAME, SCOPED_OTHER_SCHOOL_USERNAME, STAFF_USERNAME, STUDENT_USERNAME]],
  );
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
    `DELETE FROM timetable_slots WHERE subject_id IN (SELECT id FROM subjects WHERE code LIKE $1)`,
    [`${FIXTURE_MARKER_PREFIX}%`],
  );
  await dataSource.query(`DELETE FROM subjects WHERE code LIKE $1`, [`${FIXTURE_MARKER_PREFIX}%`]);
  await dataSource.query(`DELETE FROM student_term WHERE student_uuid = $1::uuid`, [STUDENT_UUID]);
  await dataSource.query(
    `DELETE FROM student_person_identifier WHERE person_uuid = $1::uuid AND source = 'AUTOMATED_TEST'`,
    [STUDENT_PERSON_UUID],
  );
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

async function upsertStudentFixture(dataSource, room) {
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
    `DELETE FROM student_person_identifier
     WHERE person_uuid = $1::uuid AND source = 'AUTOMATED_TEST'`,
    [STUDENT_PERSON_UUID],
  );
  await dataSource.query(
    `INSERT INTO student_person_identifier (
       person_uuid, identifier_type, identifier_value, identifier_normalized,
       is_primary, source
     )
     VALUES ($1::uuid, 'NATIONAL_ID', $2, $2, TRUE, 'AUTOMATED_TEST')`,
    [STUDENT_PERSON_UUID, STUDENT_NATIONAL_ID],
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

}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  const sessionCookieService = app.get(SessionCookieService);
  const studentAuthService = app.get(StudentAuthService);
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
      [
        room.school_term_id,
        room.school_id,
        room.grade_level_id,
        room.room_no,
        todaySlotDay,
        subject.id,
      ],
    );
    const [tomorrowSlot] = await dataSource.query(
      `
        INSERT INTO timetable_slots (school_term_id, school_id, grade_level_id, room_no, day_of_week, period, subject_id)
        VALUES ($1, $2, $3, $4, $5, 8, $6)
        RETURNING id
      `,
      [
        room.school_term_id,
        room.school_id,
        room.grade_level_id,
        room.room_no,
        tomorrowSlotDay,
        subject.id,
      ],
    );

    const managerActor = await upsertActor(
      dataSource,
      await passwordService.hash(password),
      MANAGER_USERNAME,
      ['home', 'dashboard', 'timetable', 'attendance-dashboard'],
      { global: true },
    );
    const scopedOtherSchoolActor = await upsertActor(
      dataSource,
      await passwordService.hash(password),
      SCOPED_OTHER_SCHOOL_USERNAME,
      ['home', 'timetable'],
      { school_ids: [otherSchoolId] },
    );
    const staffActor = await upsertActor(
      dataSource,
      await passwordService.hash(password),
      STAFF_USERNAME,
      ['home'],
      { global: true },
    );
    await upsertStudentFixture(dataSource, room);
    const studentUser = await studentAuthService.loginWithMockThaId(STUDENT_NATIONAL_ID);
    const [emptyConfiguredPeriod] = await dataSource.query(
      `
        SELECT candidate.period
        FROM generate_series(1, 20) AS candidate(period)
        WHERE NOT EXISTS (
          SELECT 1
          FROM school_period_times period_time
          WHERE period_time.school_id = $1
            AND period_time.period = candidate.period
            AND period_time.deleted_at IS NULL
        )
          AND NOT EXISTS (
            SELECT 1
            FROM timetable_slots slot
            WHERE slot.school_id = $1
              AND slot.period = candidate.period
              AND slot.deleted_at IS NULL
          )
        ORDER BY candidate.period
        LIMIT 1
      `,
      [room.school_id],
    );
    assert(
      emptyConfiguredPeriod,
      'No free period number remained for configured-empty-column smoke',
    );
    await dataSource.query(
      `
        INSERT INTO school_period_times (
          school_id, day_of_week, period, starts_at, ends_at, source, created_by, updated_by
        )
        VALUES ($1, 1, $2, '17:00', '17:30', 'MANUAL', $3, $3)
      `,
      [room.school_id, emptyConfiguredPeriod.period, managerActor.id],
    );
    const [expectedPeriodPrefill] = await dataSource.query(
      `
        WITH active_rows AS (
          SELECT day_of_week, period, starts_at, ends_at
          FROM school_period_times
          WHERE school_id = $1 AND deleted_at IS NULL
        ),
        representative_day AS (
          SELECT day_of_week
          FROM active_rows
          GROUP BY day_of_week
          ORDER BY COUNT(*) DESC, day_of_week ASC
          LIMIT 1
        ),
        duration_mode AS (
          SELECT ROUND(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60)::integer AS minutes
          FROM active_rows
          GROUP BY minutes
          ORDER BY COUNT(*) DESC, minutes ASC
          LIMIT 1
        )
        SELECT
          (SELECT MAX(period) FROM active_rows) AS periods_count,
          (SELECT COALESCE(MAX(starts_at) FILTER (WHERE period = 1), MIN(starts_at))::text
           FROM active_rows
           WHERE day_of_week = (SELECT day_of_week FROM representative_day)) AS first_period_starts_at,
          (SELECT minutes FROM duration_mode) AS period_length_minutes
      `,
      [room.school_id],
    );

    const managerUser = {
      id: managerActor.id,
      username: MANAGER_USERNAME,
      FirstName: 'Timetable',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home', 'dashboard', 'timetable', 'attendance-dashboard'],
      data_scope: { global: true },
      must_change_password: false,
    };
    const scopedOtherSchoolUser = {
      id: scopedOtherSchoolActor.id,
      username: SCOPED_OTHER_SCHOOL_USERNAME,
      FirstName: 'Timetable',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['home', 'timetable'],
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
    const managerSession = createSessionCookie(sessionCookieService, managerActor.id);
    const scopedOtherSchoolSession = createSessionCookie(
      sessionCookieService,
      scopedOtherSchoolActor.id,
    );
    const staffSession = createSessionCookie(sessionCookieService, staffActor.id);

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
    try {
      await waitFor(
        async () =>
          Boolean(
            await evaluate(
              client,
              `Boolean(document.querySelector('input[placeholder="ค้นหาโรงเรียน"]')) &&
               [...document.querySelectorAll('button')].some((button) =>
                 button.textContent.includes('ตั้งเวลาคาบ')
               )`,
            ),
          ),
        'Timetable manage view did not render for the manager',
      );
    } catch (error) {
      const browserState = await evaluate(
        client,
        `({ url: location.href, body: document.body.innerText.slice(0, 500) })`,
      );
      throw new Error(`${error.message}; browser=${JSON.stringify(browserState)}`);
    }
    await pickComboboxOption(
      client,
      'input[placeholder="ค้นหาโรงเรียน"]',
      room.school_name,
      'Pick timetable school',
    );
    await pickComboboxOption(
      client,
      'input[placeholder="ค้นหาชั้น"]',
      room.grade_label,
      'Pick timetable grade',
    );
    await pickComboboxOption(
      client,
      'input[placeholder="ค้นหาห้อง"]',
      String(room.room_no),
      'Pick timetable room',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('เพิ่มคาบสอน'),
      'Timetable manage actions did not render after selecting a room',
    );
    const timetableActionMetrics = await evaluate(
      client,
      `(() => {
        const buttons = [...document.querySelectorAll('button')];
        const refresh = buttons.find((button) => button.textContent.includes('รีเฟรช'));
        const add = buttons.find((button) => button.textContent.includes('เพิ่มคาบสอน'));
        const configure = buttons.find((button) => button.textContent.includes('ตั้งเวลาคาบ'));
        return {
          refreshHeight: refresh?.getBoundingClientRect().height || 0,
          addHeight: add?.getBoundingClientRect().height || 0,
          addBackground: add ? getComputedStyle(add).backgroundColor : '',
          configureBackground: configure ? getComputedStyle(configure).backgroundColor : ''
        };
      })()`,
    );
    assert(
      timetableActionMetrics.refreshHeight === timetableActionMetrics.addHeight,
      `Expected refresh/add actions to have equal heights, got ${timetableActionMetrics.refreshHeight}/${timetableActionMetrics.addHeight}`,
    );
    assert(
      timetableActionMetrics.configureBackground === timetableActionMetrics.addBackground,
      `Expected configure-period button to match primary add action, got ${timetableActionMetrics.configureBackground}/${timetableActionMetrics.addBackground}`,
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('ตั้งเวลาคาบ'))`,
      'Configure-period button was not found',
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('จำนวนคาบต่อวัน'),
      'Configure-period dialog did not render',
    );
    await waitFor(
      async () =>
        Number(await evaluate(client, `document.querySelector('#pt-count')?.value || 0`)) ===
        Number(expectedPeriodPrefill.periods_count),
      'Configure-period dialog did not prefill from the current school schedule',
    );
    const periodPrefill = await evaluate(
      client,
      `(() => ({
        count: document.querySelector('#pt-count')?.value || '',
        length: document.querySelector('#pt-length')?.value || '',
        firstStart: document.querySelector('[aria-label="เวลาเริ่มคาบ 1"]')?.textContent.trim() || ''
      }))()`,
    );
    assert(
      Number(periodPrefill.count) === Number(expectedPeriodPrefill.periods_count),
      `Expected current period count ${expectedPeriodPrefill.periods_count}, got ${periodPrefill.count}`,
    );
    assert(
      Number(periodPrefill.length) === Number(expectedPeriodPrefill.period_length_minutes),
      `Expected current period length ${expectedPeriodPrefill.period_length_minutes}, got ${periodPrefill.length}`,
    );
    assert(
      periodPrefill.firstStart.includes(
        String(expectedPeriodPrefill.first_period_starts_at).slice(0, 5),
      ),
      `Expected current first period to start ${expectedPeriodPrefill.first_period_starts_at}, got ${periodPrefill.firstStart}`,
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
    await loginInBrowser(client, studentUser, null);
    await navigate(client, `${FRONTEND_URL}/`);
    try {
      await waitFor(
        async () => String(await evaluate(client, 'location.pathname')) === '/my-attendance',
        'Student root route did not redirect to own data',
      );
    } catch (error) {
      const browserState = await evaluate(
        client,
        `(() => {
          const user = JSON.parse(localStorage.getItem('sts_user') || 'null');
          return {
            url: location.href,
            body: document.body.innerText.slice(0, 500),
            authShape: user ? {
              roles: user.roles,
              permissions: user.permissions,
              virtualLogin: user.virtual_login,
              hasVirtualToken: Boolean(user.virtual_auth_token),
              ownOnly: user.data_scope?.own_only
            } : null
          };
        })()`,
      );
      throw new Error(`${error.message}; browser=${JSON.stringify(browserState)}`);
    }
    const studentNavigation = await evaluate(
      client,
      `(() => {
        const text = document.body.innerText;
        return {
          hasOwnData: text.includes('ข้อมูลตัวเอง'),
          hasTimetable: text.includes('ตารางเรียน'),
          hasHome: text.includes('หน้าหลัก'),
          hasAttendanceGroup: text.includes('ระบบเช็กชื่อ')
        };
      })()`,
    );
    assert(studentNavigation.hasOwnData, 'Student own-data navigation item was missing');
    assert(studentNavigation.hasTimetable, 'Student timetable navigation item was missing');
    assert(!studentNavigation.hasHome, 'Student still saw the home navigation item');
    assert(
      !studentNavigation.hasAttendanceGroup,
      'Student timetable was still nested in the staff attendance group',
    );

    const studentHomeStatus = await evaluate(
      client,
      `(async () => {
        const user = JSON.parse(localStorage.getItem('sts_user') || 'null');
        const res = await fetch(${JSON.stringify(`${BROWSER_BACKEND_URL}/api/home-dashboard/summary`)}, {
          credentials: 'include',
          headers: { 'x-virtual-auth': user?.virtual_auth_token || '' }
        });
        return res.status;
      })()`,
    );
    assert(
      studentHomeStatus === 403,
      `Expected student home API to return 403, got ${studentHomeStatus}`,
    );

    await navigate(client, `${FRONTEND_URL}/timetable`);
    try {
      await waitFor(async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return (
          text.includes(`คาบ ${emptyConfiguredPeriod.period}`) &&
          !text.includes('เลือกห้องเรียน') &&
          !text.includes('ตารางของฉัน')
        );
      }, 'Student own-room timetable did not render');
    } catch (error) {
      const browserState = await evaluate(
        client,
        `(() => {
          const user = JSON.parse(localStorage.getItem('sts_user') || 'null');
          return {
            url: location.href,
            body: document.body.innerText.slice(0, 500),
            authShape: user ? {
              roles: user.roles,
              permissions: user.permissions,
              virtualLogin: user.virtual_login,
              hasVirtualToken: Boolean(user.virtual_auth_token),
              ownOnly: user.data_scope?.own_only
            } : null
          };
        })()`,
      );
      throw new Error(`${error.message}; browser=${JSON.stringify(browserState)}`);
    }
    const studentTimetableText = String(await evaluate(client, 'document.body.innerText'));
    assert(
      studentTimetableText.includes(`คาบ ${emptyConfiguredPeriod.period}`),
      `Student timetable omitted configured empty period ${emptyConfiguredPeriod.period}`,
    );
    assert(
      !studentTimetableText.includes('เลือกห้องเรียน'),
      'Student timetable exposed the room picker',
    );
    assert(
      !studentTimetableText.includes('ตารางของฉัน'),
      'Student timetable exposed staff view-mode tabs',
    );
    await logoutInBrowser(client);

    console.log(
      'timetable browser smoke passed (scope rejection, timetable action sizing, period prefill, staff/manager/student UI gating, configured empty student period, student home denial and own-room schedule)',
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
