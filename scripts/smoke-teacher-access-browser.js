const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run teacher access browser smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3002';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5175';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9263);
const USERNAMES = {
  admin: 'teacher_access_browser_admin',
  teacher: 'teacher_access_browser_teacher',
  manager: 'teacher_access_browser_manager',
};
const FIXTURE_PREFIX = 'TA-BROWSER-';
const CALENDAR_REASON = 'Automated teacher access browser smoke';

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

async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const selectors = [...expression.matchAll(/#[A-Za-z0-9_-]+/g)].map(([selector]) => selector);
    throw new Error(
      `${
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        'Browser expression failed'
      }; selectors=${JSON.stringify([...new Set(selectors)])}`,
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

async function clickButton(client, label, withinDialog = false) {
  const expression = `(() => {
    const roots = ${withinDialog
      ? "[...document.querySelectorAll('[role=dialog]')].filter((dialog) => dialog.getClientRects().length > 0)"
      : '[document]'};
    return roots
      .flatMap((root) => [...root.querySelectorAll('button')])
      .find((button) => button.innerText.trim() === ${JSON.stringify(label)});
  })()`;
  try {
    await waitFor(
      async () =>
        Boolean(await evaluate(client, `Boolean(${expression} && !${expression}.disabled)`)),
      `Enabled button “${label}” was not found`,
    );
  } catch (error) {
    const diagnostic = await evaluate(
      client,
      `({
        buttons: [...document.querySelectorAll('button')].map((button) => ({
          text: button.innerText.trim(),
          disabled: button.disabled,
          visible: button.getClientRects().length > 0,
        })),
        dialogs: [...document.querySelectorAll('[role=dialog]')].map((dialog) => ({
          visible: dialog.getClientRects().length > 0,
          text: dialog.textContent.trim().slice(0, 500),
        })),
      })`,
    );
    throw new Error(`${errorMessage(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
  }
  await evaluate(client, `${expression}.scrollIntoView({ block: 'center', inline: 'center' })`);
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const rect = ${expression}.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= window.innerHeight;
          })()`,
        ),
      ),
    `Button “${label}” did not scroll into view`,
  );
  const point = await evaluate(
    client,
    `(() => {
      const rect = ${expression}.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
  );
  await client.call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await client.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

async function clickLink(client, label) {
  const expression = `([...document.querySelectorAll('a')]
    .find((link) => link.innerText.trim() === ${JSON.stringify(label)}))`;
  await waitFor(
    async () => Boolean(await evaluate(client, `Boolean(${expression})`)),
    `Link “${label}” was not found`,
  );
  await evaluate(client, `${expression}.click()`);
}

async function setSelectByOptionText(client, selector, optionText) {
  const controlKind = await evaluate(
    client,
    `document.querySelector(${JSON.stringify(selector)})?.tagName || null`,
  );
  if (controlKind === 'INPUT') {
    await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).click()`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean([...document.querySelector(${JSON.stringify(selector)}).parentElement
              .querySelectorAll('ul button')]
              .find((option) => option.textContent.includes(${JSON.stringify(optionText)})))`,
          ),
        ),
      `Combobox ${selector} did not contain “${optionText}”`,
    );
    await evaluate(
      client,
      `(() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        const option = [...input.parentElement.querySelectorAll('ul button')]
          .find((item) => item.textContent.includes(${JSON.stringify(optionText)}));
        option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      })()`,
    );
    return;
  }
  if (controlKind === 'BUTTON') {
    await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).click()`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean([...document.querySelectorAll('[role="listbox"] [role="option"]')]
              .find((option) => option.textContent.includes(${JSON.stringify(optionText)})))`,
          ),
        ),
      `Select ${selector} did not contain “${optionText}”`,
    );
    await evaluate(
      client,
      `(() => {
        const option = [...document.querySelectorAll('[role="listbox"] [role="option"]')]
          .find((item) => item.textContent.includes(${JSON.stringify(optionText)}));
        option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      })()`,
    );
    return;
  }
  await waitFor(async () => {
    const details = await evaluate(
      client,
      `(() => {
            const select = document.querySelector(${JSON.stringify(selector)});
            return {
              options: [...(select?.options || [])].map((option) => option.textContent),
              html: select?.outerHTML || null,
              xhr: window.__stsSmokeXhr || [],
            };
          })()`,
    );
    if (details.options.some((text) => text.includes(optionText))) return true;
    throw new Error(
      `available options=${JSON.stringify(details.options)} html=${JSON.stringify(details.html)} xhr=${JSON.stringify(details.xhr)}`,
    );
  }, `Select ${selector} did not contain “${optionText}”`);
  await evaluate(
    client,
    `(() => {
      const select = document.querySelector(${JSON.stringify(selector)});
      const option = [...select.options].find((item) =>
        item.textContent.includes(${JSON.stringify(optionText)}));
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

async function clickCheckboxLabel(client, labelText) {
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const label = [...document.querySelectorAll('label')]
              .find((item) => item.textContent.includes(${JSON.stringify(labelText)}));
            return Boolean(label?.querySelector('input[type=checkbox]'));
          })()`,
        ),
      ),
    `Checkbox “${labelText}” was not found`,
  );
  await evaluate(
    client,
    `(() => {
      const label = [...document.querySelectorAll('label')]
        .find((item) => item.textContent.includes(${JSON.stringify(labelText)}));
      const input = label.querySelector('input[type=checkbox]');
      if (!input.checked) input.click();
    })()`,
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
  try {
    chrome.client.close();
  } catch {
    // Best-effort browser cleanup.
  }
  if (!chrome.processRef.killed) {
    chrome.processRef.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => chrome.processRef.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }
  fs.rmSync(chrome.userDataDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

async function upsertUser(dataSource, passwordHash, input) {
  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code, email, phone
      )
      VALUES (
        $1, $2, $3, $4, 'ACTIVE', $5::jsonb, $6, $7::jsonb, FALSE,
        'Automated teacher access browser smoke', 'AUTOMATED_TEST', NULL, NULL
      )
      ON CONFLICT (username) DO UPDATE
      SET password = EXCLUDED.password,
          "FirstName" = EXCLUDED."FirstName",
          "LastName" = EXCLUDED."LastName",
          status = 'ACTIVE',
          permissions = EXCLUDED.permissions,
          role = EXCLUDED.role,
          data_scope = EXCLUDED.data_scope,
          must_change_password = FALSE,
          temporary_password_issued_at = NULL,
          temporary_password_expires_at = NULL,
          deactivated_at = NULL,
          deactivated_by = NULL,
          deactivation_reason_code = NULL,
          deactivation_note = NULL,
          affiliation = EXCLUDED.affiliation,
          data_origin_code = 'AUTOMATED_TEST',
          email = NULL,
          phone = NULL
      RETURNING id
    `,
    [
      input.username,
      passwordHash,
      input.firstName,
      input.lastName,
      JSON.stringify(input.permissions),
      input.role,
      JSON.stringify(input.dataScope),
    ],
  );
  return { id: Number(row.id), username: input.username };
}

async function login(password, username = USERNAMES.admin) {
  const response = await fetch(`${BACKEND_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert(response.status === 201, `Browser fixture login returned ${response.status}`);
  const user = await response.json();
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  assert(setCookie, 'Login did not return a session cookie');
  const [cookiePair] = setCookie.split(';');
  const separator = cookiePair.indexOf('=');
  return {
    user,
    cookieHeader: cookiePair,
    cookieName: cookiePair.slice(0, separator),
    cookieValue: cookiePair.slice(separator + 1),
  };
}

async function cleanup(dataSource) {
  const users = await dataSource.query(
    `SELECT id, username FROM users WHERE username = ANY($1::text[])`,
    [Object.values(USERNAMES)],
  );
  if (users.length === 0) return;
  const userIds = users.map((row) => Number(row.id));
  const [admin] = users.filter((row) => row.username === USERNAMES.admin);
  const [teacher] = users.filter((row) => row.username === USERNAMES.teacher);
  const adminId = admin ? Number(admin.id) : null;
  const teacherId = teacher ? Number(teacher.id) : null;

  if (teacherId) {
    await dataSource.query(
      `
        DELETE FROM student_follow_up_request_sources
        WHERE observation_id IN (
          SELECT id FROM student_observations WHERE author_user_id = $1
        )
      `,
      [teacherId],
    );
    await dataSource.query(`DELETE FROM student_follow_up_requests WHERE requested_by = $1`, [
      teacherId,
    ]);
    await dataSource.query(
      `
        DELETE FROM student_observation_tags
        WHERE observation_id IN (
          SELECT id FROM student_observations WHERE author_user_id = $1
        )
      `,
      [teacherId],
    );
    await dataSource.query(
      `DELETE FROM student_observation_revisions WHERE changed_by_user_id = $1`,
      [teacherId],
    );
    await dataSource.query(`DELETE FROM student_observations WHERE author_user_id = $1`, [
      teacherId,
    ]);
  }
  if (adminId) {
    await dataSource.query(`DELETE FROM teacher_access_grants WHERE issued_by = $1`, [adminId]);
  }
  const students = await dataSource.query(
    `SELECT student_uuid, person_uuid FROM student_term WHERE "PersonID_Onec" LIKE $1`,
    [`${FIXTURE_PREFIX}%`],
  );
  const studentIds = students.map((row) => row.student_uuid);
  const personIds = students.map((row) => row.person_uuid);
  if (studentIds.length > 0) {
    const smokeCases = await dataSource.query(
      `SELECT id FROM cases WHERE student_uuid = ANY($1::uuid[]) AND reason_flagged LIKE $2`,
      [studentIds, `${FIXTURE_PREFIX}%`],
    );
    const caseIds = smokeCases.map((row) => row.id);
    if (caseIds.length > 0) {
      const smokeLinks = await dataSource.query(
        `SELECT link.id
         FROM task_links link
         JOIN tasks task ON task.id = link.task_id
         WHERE task.case_id = ANY($1::int[])`,
        [caseIds],
      );
      const linkIds = smokeLinks.map((row) => row.id);
      if (linkIds.length > 0) {
        await dataSource.query(
          `DELETE FROM task_submissions WHERE task_link_id = ANY($1::uuid[])`,
          [linkIds],
        );
      }
      await dataSource.query(
        `DELETE FROM task_links
         WHERE task_id IN (SELECT id FROM tasks WHERE case_id = ANY($1::int[]))`,
        [caseIds],
      );
      await dataSource.query(`DELETE FROM tasks WHERE case_id = ANY($1::int[])`, [caseIds]);
      await dataSource.query(`DELETE FROM case_reviews WHERE case_id = ANY($1::int[])`, [caseIds]);
      await dataSource.query(`DELETE FROM cases WHERE id = ANY($1::int[])`, [caseIds]);
    }
  }
  const sessions = teacherId
    ? await dataSource.query(`SELECT id FROM attendance_sessions WHERE created_by = $1`, [
        teacherId,
      ])
    : [];
  const sessionIds = sessions.map((row) => row.id);
  if (sessionIds.length > 0 || studentIds.length > 0) {
    await dataSource.query(
      `
        DELETE FROM attendance
        WHERE ($1::uuid[] <> '{}'::uuid[] AND session_id = ANY($1::uuid[]))
           OR ($2::uuid[] <> '{}'::uuid[] AND student_uuid = ANY($2::uuid[]))
      `,
      [sessionIds, studentIds],
    );
  }
  if (sessionIds.length > 0) {
    await dataSource.query(`DELETE FROM attendance_sessions WHERE id = ANY($1::uuid[])`, [
      sessionIds,
    ]);
  }
  if (studentIds.length > 0) {
    const [{ case_count: caseCount }] = await dataSource.query(
      `SELECT COUNT(*)::int AS case_count FROM cases WHERE student_uuid = ANY($1::uuid[])`,
      [studentIds],
    );
    assert(caseCount === 0, 'Browser smoke students have cases; refusing destructive cleanup');
    await dataSource.query(`DELETE FROM student_term WHERE student_uuid = ANY($1::uuid[])`, [
      studentIds,
    ]);
  }
  if (personIds.length > 0) {
    await dataSource.query(`DELETE FROM student_person WHERE person_uuid = ANY($1::uuid[])`, [
      personIds,
    ]);
  }
  if (adminId) {
    await dataSource.query(`DELETE FROM classroom_teacher_assignments WHERE created_by = $1`, [
      adminId,
    ]);
    await dataSource.query(`DELETE FROM school_teacher_memberships WHERE created_by = $1`, [
      adminId,
    ]);
    await dataSource.query(
      `DELETE FROM school_classrooms WHERE created_by = $1`,
      [adminId],
    );
    await dataSource.query(
      `DELETE FROM school_calendar_days WHERE created_by = $1 AND reason = $2`,
      [adminId, CALENDAR_REASON],
    );
  }
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(
            deactivation_note,
            'Retained automated teacher access browser fixture'
          )
      WHERE id = ANY($1::int[])
    `,
    [userIds],
  );
  const [{ active_user_count: activeUserCount }] = await dataSource.query(
    `
      SELECT COUNT(*)::int AS active_user_count
      FROM users
      WHERE username = ANY($1::text[])
        AND status = 'ACTIVE'
    `,
    [Object.values(USERNAMES)],
  );
  const [{ active_case_count: activeCaseCount }] = await dataSource.query(
    `
      SELECT COUNT(*)::int AS active_case_count
      FROM cases case_record
      JOIN student_term student ON student.student_uuid = case_record.student_uuid
      WHERE student."PersonID_Onec" LIKE $1
        AND case_record.deleted_at IS NULL
    `,
    [`${FIXTURE_PREFIX}%`],
  );
  assert(activeUserCount === 0, 'Browser smoke cleanup left active fixture users');
  assert(activeCaseCount === 0, 'Browser smoke cleanup left active fixture cases');
}

async function assertPrerequisites(dataSource) {
  const [tables] = await dataSource.query(
    `
      SELECT
        to_regclass('public.teacher_access_grants')::text AS grants,
        to_regclass('public.school_teacher_memberships')::text AS memberships,
        to_regclass('public.classroom_teacher_assignments')::text AS assignments
    `,
  );
  assert(
    Object.values(tables).every(Boolean),
    'School structure and teacher access migrations must be applied first',
  );
  let backendResponse;
  let frontendResponse;
  try {
    [backendResponse, frontendResponse] = await Promise.all([
      fetch(`${BACKEND_URL}/api/teacher-access/context`),
      fetch(`${FRONTEND_URL}/`),
    ]);
  } catch {
    throw new Error(
      `Start the smoke backend at ${BACKEND_URL} and frontend at ${FRONTEND_URL} before running`,
    );
  }
  assert(backendResponse.status === 404, `Unexpected backend probe ${backendResponse.status}`);
  assert(frontendResponse.ok, `Frontend probe returned ${frontendResponse.status}`);
}

async function createFixture(dataSource, actors) {
  const [term] = await dataSource.query(
    `
      SELECT term.id, term.school_id, term.academic_year, term.semester,
             term.starts_on::text, term.ends_on::text, school.name AS school_name
      FROM school_terms term
      JOIN schools school ON school.id = term.school_id
      LEFT JOIN school_calendar_days calendar
        ON calendar.school_term_id = term.id
       AND calendar.calendar_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date
       AND calendar.deleted_at IS NULL
      WHERE term.status = 'ACTIVE'
        AND term.deleted_at IS NULL
        AND school.school_status = 'ACTIVE'
        AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date
            BETWEEN term.starts_on AND term.ends_on
        AND (calendar.id IS NULL OR calendar.day_type = 'SCHOOL_DAY')
      ORDER BY term.ends_on DESC, term.id
      LIMIT 1
    `,
  );
  assert(term, 'A current active term with an available school day is required');
  const [grade] = await dataSource.query(`SELECT id FROM grade_levels ORDER BY id LIMIT 1`);
  const [subject] = await dataSource.query(
    `SELECT id, name_th FROM subjects WHERE is_active = TRUE ORDER BY id LIMIT 1`,
  );
  const [studentStatus] = await dataSource.query(
    `
      SELECT code FROM student_status
      WHERE category = 'ACTIVE' AND is_enabled = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
      LIMIT 1
    `,
  );
  assert(grade && subject && studentStatus, 'Grade, subject, or active status fixture is missing');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const roomNumber = 1_800_000_000 + (Date.now() % 100_000_000);
  const roomName = 'ห้อง Teacher Access Browser';
  const [classroom] = await dataSource.query(
    `
      INSERT INTO school_classrooms (
        school_term_id, school_id, grade_level_id, legacy_room_number,
        room_code, room_name, classroom_status, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, $7)
      RETURNING id
    `,
    [
      term.id,
      term.school_id,
      grade.id,
      roomNumber,
      String(roomNumber),
      roomName,
      actors.admin.id,
    ],
  );
  const [membership] = await dataSource.query(
    `
      INSERT INTO school_teacher_memberships (
        school_id, teacher_user_id, membership_status, started_on, created_by, updated_by
      )
      VALUES ($1, $2, 'ACTIVE', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date, $3, $3)
      RETURNING id
    `,
    [term.school_id, actors.teacher.id, actors.admin.id],
  );
  const [homeroomAssignment] = await dataSource.query(
    `
      INSERT INTO classroom_teacher_assignments (
        school_id, classroom_id, teacher_membership_id, subject_id,
        assignment_kind, assignment_status, effective_on, created_by, updated_by
      )
      VALUES ($1, $2, $3, NULL, 'HOMEROOM', 'ACTIVE',
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date, $4, $4)
      RETURNING id
    `,
    [term.school_id, classroom.id, membership.id, actors.admin.id],
  );
  const [subjectAssignment] = await dataSource.query(
    `
      INSERT INTO classroom_teacher_assignments (
        school_id, classroom_id, teacher_membership_id, subject_id,
        assignment_kind, assignment_status, effective_on, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, 'SUBJECT', 'ACTIVE',
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date, $5, $5)
      RETURNING id
    `,
    [term.school_id, classroom.id, membership.id, subject.id, actors.admin.id],
  );
  const students = [];
  for (let index = 1; index <= 2; index += 1) {
    const personUuid = randomUUID();
    const studentUuid = randomUUID();
    await dataSource.query(
      `
        INSERT INTO student_person (person_uuid, identity_status, created_by, updated_by)
        VALUES ($1, 'ACTIVE', $2, $2)
      `,
      [personUuid, actors.admin.id],
    );
    await dataSource.query(
      `
        INSERT INTO student_term (
          student_uuid, person_uuid, "PersonID_Onec", "FirstName_Onec", "LastName_Onec",
          "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
          "StudentStatusID_Onec", student_status_code,
          "AcademicYear_Onec", "Semester_Onec", school_term_id, classroom_id,
          created_by, updated_by
        )
        VALUES (
          $1, $2, $3, $4, 'Teacher Access Browser',
          $5, $6, $7, $8, $8, $9, $10, $11, $12, $13, $13
        )
      `,
      [
        studentUuid,
        personUuid,
        `${FIXTURE_PREFIX}${suffix}-${index}`,
        `Student ${index}`,
        term.school_id,
        grade.id,
        roomNumber,
        studentStatus.code,
        term.academic_year,
        term.semester,
        term.id,
        classroom.id,
        actors.admin.id,
      ],
    );
    students.push({ studentUuid, name: `Student ${index} Teacher Access Browser` });
  }
  const insertedCalendar = await dataSource.query(
    `
      INSERT INTO school_calendar_days (
        school_term_id, calendar_date, day_type, reason, source, created_by, updated_by
      )
      VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date,
        'SCHOOL_DAY', $2, 'MANUAL', $3, $3)
      ON CONFLICT (school_term_id, calendar_date) DO NOTHING
      RETURNING id
    `,
    [term.id, CALENDAR_REASON, actors.admin.id],
  );
  const [calendar] = await dataSource.query(
    `
      SELECT day_type FROM school_calendar_days
      WHERE school_term_id = $1
        AND calendar_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date
        AND deleted_at IS NULL
    `,
    [term.id],
  );
  assert(calendar?.day_type === 'SCHOOL_DAY', 'Today is not a school day for fixture term');
  return {
    term,
    roomName,
    subjectName: subject.name_th,
    membershipId: Number(membership.id),
    homeroomAssignmentId: Number(homeroomAssignment.id),
    subjectAssignmentId: Number(subjectAssignment.id),
    students,
    calendarCreated: insertedCalendar.length === 1,
  };
}

async function assertTokenAbsentFromBrowser(client, token) {
  const exposure = await evaluate(
    client,
    `(() => {
      const token = ${JSON.stringify(token)};
      const storageValues = [];
      for (const storage of [localStorage, sessionStorage]) {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          storageValues.push(key || '', key ? storage.getItem(key) || '' : '');
        }
      }
      return {
        hash: location.hash,
        hrefHasToken: location.href.includes(token),
        domHasToken: document.documentElement.outerHTML.includes(token),
        bodyHasToken: document.body.innerText.includes(token),
        storageHasToken: storageValues.some((value) => value.includes(token)),
      };
    })()`,
  );
  assert(exposure.hash === '', 'Guest URL fragment was not stripped');
  assert(!exposure.hrefHasToken, 'Guest token remained in location.href');
  assert(!exposure.domHasToken && !exposure.bodyHasToken, 'Guest token leaked into DOM/body');
  assert(!exposure.storageHasToken, 'Guest token leaked into local/session storage');
}

async function copyOneTimeLink(client) {
  const beforeCopy = await evaluate(
    client,
    `({
      bodyHasFragment: document.body.innerText.includes('#token='),
      domHasFragment: document.documentElement.outerHTML.includes('#token=')
    })`,
  );
  assert(
    !beforeCopy.bodyHasFragment && !beforeCopy.domHasFragment,
    'One-time token leaked into DOM',
  );
  await clickButton(client, 'คัดลอกลิงก์', true);
  await waitFor(
    async () => String(await evaluate(client, 'document.body.innerText')).includes('คัดลอกแล้ว'),
    'Native clipboard copy did not report success',
  );
  const link = await evaluate(client, 'navigator.clipboard.readText()');
  const parsed = new URL(link);
  const token = new URLSearchParams(parsed.hash.slice(1)).get('token');
  assert(parsed.pathname === '/teacher-access', 'Clipboard link used an unexpected path');
  assert(token && token.length >= 32, 'Clipboard link did not contain a token fragment');
  assert(
    !(await evaluate(
      client,
      `document.documentElement.outerHTML.includes(${JSON.stringify(token)})`,
    )),
    'Copied token appeared in admin DOM',
  );
  return {
    link: `${FRONTEND_URL}${parsed.pathname}${parsed.search}${parsed.hash}`,
    token,
  };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  const password = `Teacher-Access-Browser-${Date.now()}-Password`;
  let chrome;

  try {
    await assertPrerequisites(dataSource);
    const [initialSchool] = await dataSource.query(
      `SELECT id FROM schools WHERE school_status = 'ACTIVE' ORDER BY id LIMIT 1`,
    );
    assert(initialSchool, 'No active school exists');
    const passwordHash = await passwordService.hash(password);
    const actors = {
      admin: await upsertUser(dataSource, passwordHash, {
        username: USERNAMES.admin,
        firstName: 'Teacher Access',
        lastName: 'Browser Admin',
        role: 'ADMIN',
        permissions: ['manage-teacher-access'],
        dataScope: { school_ids: [Number(initialSchool.id)] },
      }),
      teacher: await upsertUser(dataSource, passwordHash, {
        username: USERNAMES.teacher,
        firstName: 'Teacher Browser',
        lastName: 'Smoke',
        role: 'TEACHER',
        permissions: ['attendance'],
        dataScope: { school_ids: [Number(initialSchool.id)] },
      }),
      manager: await upsertUser(dataSource, passwordHash, {
        username: USERNAMES.manager,
        firstName: 'Teacher Access',
        lastName: 'Browser Manager',
        role: 'DIRECTOR',
        permissions: [
          'students',
          'manage-student-observations',
          'create',
          'assign-follow-up-cases',
          'review-cases',
          'close-case',
        ],
        dataScope: { school_ids: [Number(initialSchool.id)] },
      }),
    };
    await cleanup(dataSource);
    const fixture = await createFixture(dataSource, actors);
    for (const actor of Object.values(actors)) {
      await dataSource.query(
        `
          UPDATE users
          SET status = 'ACTIVE', data_scope = $2::jsonb,
              deactivated_at = NULL, deactivated_by = NULL,
              deactivation_reason_code = NULL, deactivation_note = NULL
          WHERE id = $1
        `,
        [actor.id, JSON.stringify({ school_ids: [Number(fixture.term.school_id)] })],
      );
    }
    const session = await login(password);
    assert(
      session.user.permissions?.length === 1 &&
        session.user.permissions[0] === 'manage-teacher-access',
      'Admin fixture did not log in with manage-teacher-access-only permissions',
    );
    const scopedSchoolsProbe = await fetch(`${BACKEND_URL}/api/school-structure/schools`, {
      headers: { cookie: session.cookieHeader },
    });
    assert(
      scopedSchoolsProbe.status === 200,
      `Backend runtime is stale or missing teacher-access read permissions: ` +
        `GET /api/school-structure/schools returned ${scopedSchoolsProbe.status}`,
    );
    const teachersResponse = await fetch(
      `${BACKEND_URL}/api/school-structure/teachers?schoolId=${fixture.term.school_id}`,
      { headers: { cookie: session.cookieHeader } },
    );
    const teachersPayload = await teachersResponse.json();
    assert(
      teachersResponse.ok &&
        teachersPayload.data?.some(
          (teacher) => Number(teacher.teacherUserId) === actors.teacher.id,
        ),
      `Teacher fixture was not visible through the scoped API (${teachersResponse.status})`,
    );

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
    await client.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          const backendUrl = ${JSON.stringify(BACKEND_URL)};
          const rewrite = (url) => {
            if (typeof url !== 'string') return url;
            try {
              const parsed = new URL(url, window.location.origin);
              if (
                parsed.port === '3000' &&
                (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
              ) {
                return backendUrl + parsed.pathname + parsed.search + parsed.hash;
              }
            } catch {
              // Keep malformed URLs unchanged so the browser reports its native error.
            }
            return url;
          };
          const originalOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this.__stsSmokeUrl = rewrite(url);
            return originalOpen.call(this, method, this.__stsSmokeUrl, ...rest);
          };
          const originalSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('loadend', () => {
              if (
                !this.__stsSmokeUrl?.includes('/school-structure/') &&
                !this.__stsSmokeUrl?.includes('/teacher-access/')
              ) return;
              window.__stsSmokeXhr = window.__stsSmokeXhr || [];
              window.__stsSmokeXhr.push({
                url: this.__stsSmokeUrl,
                status: this.status,
                body: this.responseText.slice(0, 500),
              });
            });
            return originalSend.apply(this, args);
          };
          const originalFetch = window.fetch;
          window.fetch = (input, init) =>
            originalFetch(
              typeof input === 'string'
                ? rewrite(input)
                : input instanceof Request
                  ? new Request(rewrite(input.url), input)
                  : input,
              init,
            );
        })();
      `,
    });
    await client.call('Browser.grantPermissions', {
      origin: FRONTEND_URL,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });
    await client.call('Network.setCookie', {
      name: session.cookieName,
      value: session.cookieValue,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    await navigate(client, `${FRONTEND_URL}/login`);
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(session.user))});
       localStorage.setItem('admin_access', 'true');`,
    );

    await navigate(client, `${FRONTEND_URL}/teacher-access-grants`);
    try {
      await waitFor(async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return (
          text.includes('ลิงก์เข้าใช้งาน') &&
          text.includes('ครูตามห้องเรียน') &&
          text.includes('ออกลิงก์ใหม่')
        );
      }, 'Teacher access admin page did not load');
    } catch (error) {
      const diagnostic = await evaluate(
        client,
        `({
          pathname: location.pathname,
          text: document.body.innerText.slice(0, 1200),
          xhr: window.__stsSmokeXhr || []
        })`,
      );
      throw new Error(`${errorMessage(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
    }
    const browserTeachersProbe = await evaluate(
      client,
      `(async () => {
        const response = await fetch(
          ${JSON.stringify(`${BACKEND_URL}/api/school-structure/teachers?schoolId=${fixture.term.school_id}`)},
          { credentials: 'include' },
        );
        return { status: response.status, payload: await response.json() };
      })()`,
    );
    assert(
      browserTeachersProbe.status === 200 &&
        browserTeachersProbe.payload.data?.some(
          (teacher) => Number(teacher.teacherUserId) === actors.teacher.id,
        ),
      `Browser could not load scoped teacher fixture: ${JSON.stringify(browserTeachersProbe)}`,
    );
    assert(
      browserTeachersProbe.payload.data?.some(
        (teacher) =>
          Number(teacher.teacherUserId) === actors.teacher.id &&
          teacher.membershipStatus === 'ACTIVE',
      ),
      `Browser scoped teacher fixture was not active: ${JSON.stringify(browserTeachersProbe)}`,
    );
    await clickButton(client, 'ออกลิงก์ใหม่');
    await setSelectByOptionText(client, '#grant-teacher', 'Teacher Browser Smoke');
    await clickCheckboxLabel(client, 'เช็คชื่อห้องประจำชั้น');
    await clickCheckboxLabel(client, 'บันทึกข้อสังเกตครู');
    await waitFor(
      async () =>
        Number(
          await evaluate(
            client,
            `(() => {
              const fieldset = [...document.querySelectorAll('fieldset')]
                .find((item) => item.querySelector('legend')?.textContent.includes('งานสอนที่อนุญาต'));
              return fieldset?.querySelectorAll('input[type=checkbox]').length || 0;
            })()`,
          ),
        ) === 2,
      'Combined homeroom/subject assignments did not load',
    );
    await evaluate(
      client,
      `(() => {
        const fieldset = [...document.querySelectorAll('fieldset')]
          .find((item) => item.querySelector('legend')?.textContent.includes('งานสอนที่อนุญาต'));
        [...fieldset.querySelectorAll('input[type=checkbox]')].forEach((input) => {
          if (!input.checked) input.click();
        });
      })()`,
    );
    await clickButton(client, 'ออกลิงก์');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('ลิงก์พร้อมส่งให้ครู'),
      'One-time link dialog did not open after issue',
    );
    const original = await copyOneTimeLink(client);
    const [originalGrant] = await dataSource.query(
      `
        SELECT id::text
        FROM teacher_access_grants
        WHERE issued_by = $1
        ORDER BY issued_at DESC, id DESC
        LIMIT 1
      `,
      [actors.admin.id],
    );
    assert(originalGrant?.id, 'Issued teacher access grant was not persisted');
    const [originalGrantScope] = await dataSource.query(
      `
        SELECT
          access_grant.revoked_at,
          COUNT(scope.assignment_id)::int AS assignment_count
        FROM teacher_access_grants access_grant
        LEFT JOIN teacher_access_grant_assignments scope ON scope.grant_id = access_grant.id
        WHERE access_grant.id = $1::uuid
        GROUP BY access_grant.id
      `,
      [originalGrant.id],
    );
    assert(
      originalGrantScope?.revoked_at === null && Number(originalGrantScope.assignment_count) === 2,
      `Issued teacher access grant scope was incomplete: ${JSON.stringify(originalGrantScope)}`,
    );
    await clickButton(client, 'ปิด', true);
    await waitFor(
      async () =>
        !String(await evaluate(client, 'document.body.innerText')).includes('ลิงก์พร้อมส่งให้ครู'),
      'One-time link dialog did not clear after close',
    );

    const originalContext = await fetch(`${BACKEND_URL}/api/teacher-access/context`, {
      headers: { 'x-teacher-access-token': original.token },
    });
    assert(
      originalContext.ok,
      `Issued teacher access token did not resolve before guest navigation (${originalContext.status})`,
    );

    await navigate(client, original.link);
    try {
      await waitFor(async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return (
          text.includes(fixture.term.school_name) &&
          text.includes('Teacher Browser Smoke') &&
          text.includes(fixture.roomName) &&
          text.includes(fixture.students[0].name) &&
          text.includes(fixture.students[1].name)
        );
      }, 'Guest page did not render server-derived identity, assignment, and roster');
    } catch (error) {
      const diagnostic = await evaluate(
        client,
        `({
          pathname: location.pathname,
          text: document.body.innerText.slice(0, 1600),
          xhr: window.__stsSmokeXhr || []
        })`,
      );
      throw new Error(`${errorMessage(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
    }
    await assertTokenAbsentFromBrowser(client, original.token);
    const assignmentOptionCount = await evaluate(
      client,
      `document.querySelector('#teacher-assignment')?.parentElement?.querySelector('select')?.options.length || 0`,
    );
    assert(assignmentOptionCount === 2, 'Guest page did not show both assignments');

    await setSelectByOptionText(client, '#teacher-assignment', fixture.subjectName);
    await waitFor(async () => {
      const text = String(await evaluate(client, 'document.body.innerText'));
      return text.includes('ข้อสังเกตจากครู') && text.includes(fixture.students[0].name);
    }, 'Observation assignment did not render its roster boundary');
    await clickButton(client, fixture.students[0].name);
    await waitFor(
      async () =>
        Boolean(await evaluate(client, `Boolean(document.querySelector('#observation-comment'))`)),
      'Observation write form did not load for the scoped student',
    );
    const observationComment = `${FIXTURE_PREFIX}teacher observation proof`;
    await evaluate(
      client,
      `(() => {
        const input = document.querySelector('#observation-comment');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(`${FIXTURE_PREFIX}teacher observation proof`)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    );
    await evaluate(
      client,
      `document.querySelector('#observation-comment')?.closest('form')?.requestSubmit()`,
    );
    try {
      await waitFor(
        async () =>
          String(await evaluate(client, 'document.body.innerText')).includes('บันทึกเรียบร้อย'),
        'Teacher observation did not save through the UI',
      );
    } catch (error) {
      const diagnostic = await evaluate(
        client,
        `({ text: document.body.innerText.slice(-1200), xhr: window.__stsSmokeXhr || [] })`,
      );
      throw new Error(`${errorMessage(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
    }
    const [savedObservation] = await dataSource.query(
      `
        SELECT
          observation.author_kind,
          observation.author_user_id,
          observation.author_teacher_membership_id::text,
          observation.source_teacher_access_grant_id::text,
          observation.source_assignment_id::text,
          observation.comment,
          observation.revision_number
        FROM student_observations observation
        WHERE observation.student_uuid = $1
          AND observation.comment = $2
        ORDER BY observation.id DESC
        LIMIT 1
      `,
      [fixture.students[0].studentUuid, observationComment],
    );
    assert(
      savedObservation?.author_kind === 'TEACHER_ACCESS' &&
        Number(savedObservation.author_user_id) === actors.teacher.id &&
        savedObservation.author_teacher_membership_id === String(fixture.membershipId) &&
        savedObservation.source_teacher_access_grant_id === originalGrant.id &&
        savedObservation.source_assignment_id === String(fixture.subjectAssignmentId) &&
        savedObservation.revision_number === 1,
      `Teacher observation provenance was not preserved: ${JSON.stringify(savedObservation)}`,
    );

    await waitFor(
      async () =>
        Boolean(await evaluate(client, `Boolean(document.querySelector('#follow-up-source'))`)),
      'Teacher follow-up form did not render after saving an observation',
    );
    await setSelectByOptionText(client, '#follow-up-source', 'revision 1');
    await evaluate(
      client,
      `(() => {
        const input = document.querySelector('#follow-up-reason');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(`${FIXTURE_PREFIX}follow-up request proof`)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
    );
    await evaluate(
      client,
      `document.querySelector('#follow-up-reason')?.closest('form')?.requestSubmit()`,
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('ส่งคำขอแล้ว'),
      'Teacher follow-up request did not save through the UI',
    );

    const managerSession = await login(password, USERNAMES.manager);
    assert(
      managerSession.user.username === USERNAMES.manager,
      'Manager fixture login returned the wrong user',
    );
    await client.call('Network.setCookie', {
      name: managerSession.cookieName,
      value: managerSession.cookieValue,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    await navigate(client, `${FRONTEND_URL}/login`);
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(managerSession.user))});
       localStorage.setItem('admin_access', 'true');`,
    );
    await navigate(client, `${FRONTEND_URL}/students/${fixture.students[0].studentUuid}`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('คำขอเยี่ยมบ้านจากครู'),
      'Manager student detail did not render the follow-up review panel',
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('textarea[id^="follow-up-reason-"]'))`,
          ),
        ),
      'Manager follow-up review form did not render',
    );
    await evaluate(
      client,
      `(() => {
        const input = document.querySelector('textarea[id^="follow-up-reason-"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify('Automated browser smoke approved follow-up')});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
    );
    await evaluate(
      client,
      `document.querySelector('textarea[id^="follow-up-reason-"]')?.closest('form')?.requestSubmit()`,
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('ไปหน้าเคส'),
      'Approved follow-up did not expose the opened case in the manager UI',
    );
    await clickButton(client, 'ไปหน้าเคส');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          fixture.students[0].name,
        ),
      'Approved follow-up case did not appear in the case list',
    );
    await clickButton(client, 'สร้างลิงก์');
    try {
      await waitFor(
        async () =>
          Boolean(await evaluate(client, `Boolean(document.querySelector('#assigned_to_name'))`)),
        'Approved follow-up did not open the visit assignment form',
      );
    } catch (error) {
      const diagnostic = await evaluate(
        client,
        `({ pathname: location.pathname, text: document.body.innerText.slice(0, 1600) })`,
      );
      throw new Error(`${errorMessage(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
    }
    await evaluate(
      client,
      `(() => {
        for (const [selector, value] of Object.entries({
          '#assigned_to_name': 'Teacher Access Browser Visitor',
          '#assigned_to_email': 'teacher-access-browser-visitor@example.invalid',
        })) {
          const input = document.querySelector(selector);
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`,
    );
    await clickButton(client, 'สร้างลิงก์');
    try {
      await waitFor(
        async () =>
          String(await evaluate(client, 'document.body.innerText')).includes('สร้างลิงก์สำเร็จ'),
        'Approved follow-up visit assignment did not create a link through the UI',
      );
    } catch (error) {
      const diagnostic = await evaluate(
        client,
        `({
          pathname: location.pathname,
          text: document.body.innerText.slice(0, 2400),
          values: Object.fromEntries(
            [...document.querySelectorAll('input, textarea')]
              .filter((input) => input.id)
              .map((input) => [input.id, input.value])
          ),
          buttons: [...document.querySelectorAll('button')].map((button) => ({
            text: button.textContent.trim(),
            disabled: button.disabled,
            type: button.type
          }))
        })`,
      );
      throw new Error(`${errorMessage(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
    }
    const visitLink = await evaluate(
      client,
      `([...document.querySelectorAll('a')].find((link) => link.textContent.includes('เปิดลิงก์'))?.href) || null`,
    );
    assert(typeof visitLink === 'string', 'Visit assignment UI did not expose a guest link');
    const [assignedVisit] = await dataSource.query(
      `
        SELECT task.id::text AS task_id, task.case_id, link.id::text AS link_id
        FROM tasks task
        JOIN task_links link ON link.task_id = task.id
        WHERE link.assigned_to_email = $1
        ORDER BY link.created_at DESC
        LIMIT 1
      `,
      ['teacher-access-browser-visitor@example.invalid'],
    );
    assert(
      assignedVisit?.task_id && assignedVisit?.case_id,
      'Approved follow-up visit task/link was not persisted',
    );
    await dataSource.query(
      `
        INSERT INTO case_risk_signals (
          case_id,
          signal_source_code,
          signal_rule_code,
          signal_reason
        )
        VALUES ($1, 'SUBJECT_RISK_MONITOR', 'LOW_ATTENDANCE_PERCENT', $2)
        ON CONFLICT (case_id, signal_source_code, signal_reason) DO NOTHING
      `,
      [assignedVisit.case_id, 'Automated browser smoke risk signal'],
    );
    await dataSource.query(`UPDATE task_links SET otp_verified = 1 WHERE id = $1::uuid`, [
      assignedVisit.link_id,
    ]);
    const visitToken = new URL(visitLink).pathname.split('/').filter(Boolean).at(-1);
    assert(visitToken, 'Visit guest link did not contain a token');
    await navigate(client, `${FRONTEND_URL}/task/${visitToken}/report`);
    await waitFor(
      async () =>
        Boolean(await evaluate(client, `Boolean(document.querySelector('#cause-category'))`)),
      'Visit report form did not render for the assigned guest link',
    );
    await setSelectByOptionText(client, '#cause-category', 'อื่นๆ');
    await evaluate(
      client,
      `(() => {
        for (const [selector, value] of Object.entries({
          '#cause-detail': 'Automated browser smoke visit result',
          '#recommendation': 'Automated browser smoke recommendation',
          '#visit-lat': '13.7563',
          '#visit-lng': '100.5018',
        })) {
          const input = document.querySelector(selector);
          const prototype = input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`,
    );
    await clickButton(client, 'ส่งให้ตรวจผล');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('บันทึกสำเร็จ'),
      'Visit result did not save through the guest report UI',
    );

    await navigate(client, `${FRONTEND_URL}/login`);
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(managerSession.user))});
       localStorage.setItem('admin_access', 'true');`,
    );
    await navigate(client, `${FRONTEND_URL}/cases`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          fixture.students[0].name,
        ),
      'Submitted visit case did not appear in the manager case queue',
    );
    await clickLink(client, 'ดูรายละเอียด');
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return (
          text.includes('รายงานการติดตาม') &&
          text.includes('เหตุผลที่เริ่มติดตามเคส') &&
          text.includes('สัญญาณความเสี่ยงเพิ่มเติมจากระบบ') &&
          text.includes('Automated browser smoke risk signal')
        );
      },
      'Case detail did not separate the initial reason, risk signal, and follow-up report',
    );
    await clickButton(client, 'พิจารณาผล');
    await waitFor(
      async () =>
        Boolean(await evaluate(client, `Boolean(document.querySelector('#case-action'))`)),
      'Case workflow dialog did not open after visit submission',
    );
    await setSelectByOptionText(client, '#case-action', 'ติดตามต่อ');
    const reviewSubmitDisabledWithoutReason = await evaluate(
      client,
      `(() => {
        const note = document.querySelector('#case-note');
        const dialog = note?.closest('[role="dialog"]');
        const buttons = dialog ? [...dialog.querySelectorAll('button')] : [];
        return Boolean(buttons.at(-1)?.disabled);
      })()`,
    );
    assert(
      reviewSubmitDisabledWithoutReason,
      'Human review submission was enabled without a required reason',
    );
    await evaluate(
      client,
      `(() => {
        for (const [selector, value] of Object.entries({
          '#case-note': 'Automated browser smoke continue reason',
        })) {
          const input = document.querySelector(selector);
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`,
    );
    await clickButton(client, 'ติดตามต่อ', true);
    await waitFor(
      async () =>
        Boolean(await evaluate(client, `Boolean(document.querySelector('#assigned_to_name'))`)),
      'Continue decision did not open the next follow-up round form',
    );
    await evaluate(
      client,
      `(() => {
        for (const [selector, value] of Object.entries({
          '#assigned_to_name': 'Teacher Access Browser Follow-up Visitor',
          '#assigned_to_email': 'teacher-access-browser-follow-up@example.invalid',
        })) {
          const input = document.querySelector(selector);
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`,
    );
    await clickButton(client, 'สร้างลิงก์');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('สร้างลิงก์สำเร็จ'),
      'Next follow-up round did not create a visit link',
    );
    const followUpVisitLink = await evaluate(
      client,
      `([...document.querySelectorAll('a')].find((link) => link.textContent.includes('เปิดลิงก์'))?.href) || null`,
    );
    assert(typeof followUpVisitLink === 'string', 'Next follow-up round did not expose a guest link');
    const [followUpVisit] = await dataSource.query(
      `
        SELECT link.id::text AS link_id
        FROM task_links link
        WHERE link.assigned_to_email = $1
        ORDER BY link.created_at DESC
        LIMIT 1
      `,
      ['teacher-access-browser-follow-up@example.invalid'],
    );
    assert(followUpVisit?.link_id, 'Next follow-up task link was not persisted');
    await dataSource.query(`UPDATE task_links SET otp_verified = 1 WHERE id = $1::uuid`, [
      followUpVisit.link_id,
    ]);
    const followUpVisitToken = new URL(followUpVisitLink).pathname.split('/').filter(Boolean).at(-1);
    assert(followUpVisitToken, 'Next follow-up guest link did not contain a token');

    const [continuedReview] = await dataSource.query(
      `
        SELECT
          review.id::text,
          review.source_actor_user_id,
          actor.username AS actor_username
        FROM case_reviews review
        INNER JOIN users actor ON actor.id = review.source_actor_user_id
        WHERE review.case_id = $1
          AND review.review_action = 'CONTINUE'
        ORDER BY review.reviewed_at DESC
        LIMIT 1
      `,
      [assignedVisit.case_id],
    );
    assert(continuedReview?.id, 'Continue decision review was not persisted');
    assert(
      continuedReview.source_actor_user_id &&
        continuedReview.actor_username === USERNAMES.manager,
      'Human review was not attributed to the authenticated manager user',
    );
    await navigate(client, `${FRONTEND_URL}/cases/${assignedVisit.case_id}`);
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return (
          text.includes('ประวัติการพิจารณา') &&
          text.includes('Automated browser smoke continue reason')
        );
      },
      'Case detail did not render the continue decision history',
    );
    const openedReviewDetail = await evaluate(
      client,
      `(() => {
        const heading = [...document.querySelectorAll('h2')]
          .find((node) => node.textContent.trim() === 'ประวัติการพิจารณา');
        const container = heading?.parentElement;
        const link = container
          ? [...container.querySelectorAll('a')]
              .find((node) => node.textContent.trim() === 'ดูรายละเอียด')
          : null;
        link?.click();
        return Boolean(link);
      })()`,
    );
    assert(openedReviewDetail, 'Review history did not expose the shared detail link button');
    await waitFor(
      async () =>
        evaluate(
          client,
          `window.location.pathname === ${JSON.stringify(
            `/cases/${assignedVisit.case_id}/reviews/${continuedReview.id}`,
          )}`,
        ),
      'Review history detail link did not navigate to the selected review route',
    );
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return (
          text.includes('รายละเอียดผลการพิจารณา') &&
          text.includes('เหตุผลที่ให้ติดตามต่อ') &&
          text.includes('Automated browser smoke continue reason') &&
          text.includes('รายงานล่าสุดก่อนการพิจารณา') &&
          text.includes('Automated browser smoke visit result') &&
          text.includes('Automated browser smoke recommendation')
        );
      },
      'Review detail did not render the decision, comment, and supporting report',
    );
    const caseDetailPath = `/cases/${assignedVisit.case_id}`;
    const reviewDetailPath = `${caseDetailPath}/reviews/${continuedReview.id}`;
    await clickButton(client, 'ย้อนกลับ');
    await waitFor(
      async () =>
        evaluate(
          client,
          `window.location.pathname === ${JSON.stringify(caseDetailPath)}`,
        ),
      'Review detail back action did not return to the case detail history entry',
    );
    await clickButton(client, 'ย้อนกลับ');
    await waitFor(
      async () =>
        evaluate(
          client,
          `!${JSON.stringify([caseDetailPath, reviewDetailPath])}.includes(window.location.pathname)`,
        ),
      'Case detail back action looped to the review detail route',
    );
    await navigate(
      client,
      `${FRONTEND_URL}/cases/${assignedVisit.case_id}/reviews/00000000-0000-4000-8000-000000000000`,
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'ไม่พบผลการพิจารณา',
        ),
      'Unknown review id did not render the not-found state',
    );

    await navigate(client, `${FRONTEND_URL}/task/${followUpVisitToken}/report`);
    await waitFor(
      async () =>
        Boolean(await evaluate(client, `Boolean(document.querySelector('#cause-category'))`)),
      'Next follow-up report form did not render',
    );
    await setSelectByOptionText(client, '#cause-category', 'อื่นๆ');
    await setSelectByOptionText(client, '#follow-up-decision', 'ปิดเคส');
    await setSelectByOptionText(client, '#resolution-outcome', 'กลับมาเรียนแล้ว');
    await evaluate(
      client,
      `(() => {
        const input = document.querySelector('#cause-detail');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, 'Automated browser smoke direct close result');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
    );
    await clickButton(client, 'ปิดเคส');
    await clickButton(client, 'ปิดเคส', true);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('บันทึกสำเร็จ'),
      'Home visitor could not close the simple follow-up case',
    );
    const [closedCase] = await dataSource.query(`SELECT status FROM cases WHERE id = $1`, [
      assignedVisit.case_id,
    ]);
    assert(closedCase?.status === 'RESOLVED', 'Direct close did not resolve the tracked case');

    await navigate(client, original.link);
    await waitFor(
      async () =>
        Boolean(await evaluate(client, `Boolean(document.querySelector('#teacher-assignment'))`)),
      'Teacher guest page did not reload after manager review',
    );
    await setSelectByOptionText(client, '#teacher-assignment', fixture.roomName);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('เช็คชื่อนักเรียน'),
      'Homeroom assignment did not render attendance',
    );
    await clickButton(client, 'บันทึกการเช็คชื่อ 2 คน');
    try {
      await waitFor(
        async () =>
          String(await evaluate(client, 'document.body.innerText')).includes('บันทึกเรียบร้อย'),
        'Full homeroom attendance did not save through the UI',
      );
    } catch (error) {
      const diagnostic = await evaluate(
        client,
        `({
          pathname: location.pathname,
          text: document.body.innerText.slice(0, 2200),
          xhr: window.__stsSmokeXhr || []
        })`,
      );
      throw new Error(`${errorMessage(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
    }
    const [attendanceSession] = await dataSource.query(
      `
        SELECT status, submitted_by, recorded_count
        FROM attendance_sessions
        WHERE created_by = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [actors.teacher.id],
    );
    assert(attendanceSession?.status === 'SUBMITTED', 'UI attendance session was not submitted');
    assert(
      Number(attendanceSession.submitted_by) === actors.teacher.id &&
        Number(attendanceSession.recorded_count) === 2,
      'UI attendance attribution or roster count was incorrect',
    );

    await navigate(client, 'about:blank');
    await navigate(client, original.link);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('Teacher Browser Smoke'),
      'Reopening the reusable full link did not work',
    );
    await assertTokenAbsentFromBrowser(client, original.token);

    await client.call('Network.setCookie', {
      name: session.cookieName,
      value: session.cookieValue,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    await navigate(client, `${FRONTEND_URL}/login`);
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(session.user))});
       localStorage.setItem('admin_access', 'true');`,
    );
    await navigate(client, `${FRONTEND_URL}/teacher-access-grants`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('Teacher Browser Smoke'),
      'Admin grant card did not reload',
    );
    await clickButton(client, 'เปลี่ยนลิงก์');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'ออกลิงก์ใหม่แทนลิงก์เดิม?',
        ),
      'Rotate confirmation did not open',
    );
    await clickButton(client, 'ออกลิงก์ใหม่', true);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('ลิงก์พร้อมส่งให้ครู'),
      'Rotated one-time link dialog did not open',
    );
    const rotated = await copyOneTimeLink(client);
    assert(rotated.token !== original.token, 'Rotate copied the original token');
    await clickButton(client, 'ปิด', true);

    await navigate(client, original.link);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'ไม่สามารถเข้าใช้งานได้',
        ),
      'Old link was not denied after rotate',
    );
    await assertTokenAbsentFromBrowser(client, original.token);
    await navigate(client, 'about:blank');
    await navigate(client, rotated.link);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('Teacher Browser Smoke'),
      'Rotated link did not work',
    );
    await assertTokenAbsentFromBrowser(client, rotated.token);

    await navigate(client, `${FRONTEND_URL}/teacher-access-grants`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('Teacher Browser Smoke'),
      'Admin grant card did not load before revoke',
    );
    await clickButton(client, 'เพิกถอน');
    await waitFor(
      async () =>
        Boolean(await evaluate(client, `Boolean(document.querySelector('#revoke-reason'))`)),
      'Revoke dialog did not open',
    );
    await evaluate(
      client,
      `(() => {
        const input = document.querySelector('#revoke-reason');
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        ).set;
        setter.call(input, 'Automated browser smoke revoke');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
    );
    await waitFor(
      async () =>
        !(await evaluate(
          client,
          `(() => {
            const dialog = document.querySelector('[role=dialog]');
            return [...dialog.querySelectorAll('button')]
              .find((button) => button.textContent.trim() === 'เพิกถอนลิงก์')?.disabled;
          })()`,
        )),
      'Revoke submit did not become enabled',
    );
    await clickButton(client, 'เพิกถอนลิงก์', true);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('เพิกถอนแล้ว'),
      'Admin UI did not show revoked status',
    );
    await navigate(client, rotated.link);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'ไม่สามารถเข้าใช้งานได้',
        ),
      'Rotated link was not denied after revoke',
    );
    await assertTokenAbsentFromBrowser(client, rotated.token);

    console.log(
      JSON.stringify({
        status: 'teacher_access_browser_smoke_ok',
        checked: [
          'manage-teacher-access-only admin page',
          'combined homeroom and subject grant issue',
          'native one-time clipboard copy without token DOM exposure',
          'server-derived guest identity, assignments, and roster',
          'fragment stripping and no token local/session/body storage',
          'P4 scoped observation write and provenance',
          'P4 teacher follow-up request and manager approval',
          'visit report request-review, manager continue, next-round link, and direct close',
          'case review detail route, back-history regression, decision context, supporting report, and not-found state',
          'full homeroom attendance submit and teacher attribution',
          'full-link reopen',
          'rotate denies old link and enables new link',
          'revoke denies rotated link',
        ],
      }),
    );
  } finally {
    await closeChrome(chrome);
    await cleanup(dataSource);
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
