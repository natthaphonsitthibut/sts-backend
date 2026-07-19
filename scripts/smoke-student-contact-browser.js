const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run student contact browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const BROWSER_BACKEND_URL = process.env.SMOKE_BROWSER_BACKEND_URL || BACKEND_URL;
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9254);
const ADMIN_USERNAME = 'student_contact_browser_admin';
const STUDENT_USERNAME = 'student_contact_browser_student';

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-student-contact-chrome-'));
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
      if (!input) throw new Error('Input not found: ' + ${JSON.stringify(selector)});
      const prototype = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
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

function randomThaiNationalId() {
  let digits = '';
  for (let i = 0; i < 13; i += 1) {
    digits += Math.floor(Math.random() * 10);
  }
  return digits;
}

async function upsertSmokeUser(
  dataSource,
  { username, passwordHash, firstName, lastName, permissions, role, dataScope, personUuid },
) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2, "FirstName" = $3, "LastName" = $4, status = 'ACTIVE',
            permissions = $5::jsonb, role = $6, data_scope = $7::jsonb, person_uuid = $8,
            must_change_password = FALSE, temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL, deactivated_at = NULL, deactivated_by = NULL,
            deactivation_reason_code = NULL, deactivation_note = NULL,
            affiliation = 'Automated student contact browser smoke',
            data_origin_code = 'AUTOMATED_TEST', email = NULL, phone = NULL, line_id = NULL
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
        personUuid ?? null,
      ],
    );
    return existing;
  }
  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, person_uuid, must_change_password, affiliation, data_origin_code
      )
      VALUES ($1, $2, $3, $4, 'ACTIVE', $5::jsonb, $6, $7::jsonb, $8, FALSE, $9, 'AUTOMATED_TEST')
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
      personUuid ?? null,
      'Automated student contact browser smoke',
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
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminPassword = `ContactBrowser-${suffix}-Password`;
  let chrome;
  let personUuid = null;
  let studentUuid = null;

  try {
    const staleStudents = await dataSource.query(
      `SELECT student_uuid, person_uuid FROM student_term
       WHERE "FirstName_Onec" = 'พิมพ์ชนก' AND "LastName_Onec" = 'อินทรกำแหง'`,
    );
    for (const stale of staleStudents) {
      await dataSource.query(`DELETE FROM student_observation_risk_reviews WHERE student_uuid = $1`, [
        stale.student_uuid,
      ]);
      await dataSource.query(
        `DELETE FROM student_observation_revisions
         WHERE observation_id IN (SELECT id FROM student_observations WHERE student_uuid = $1)`,
        [stale.student_uuid],
      );
      await dataSource.query(`DELETE FROM student_observations WHERE student_uuid = $1`, [
        stale.student_uuid,
      ]);
      await dataSource.query(`DELETE FROM student_term WHERE student_uuid = $1`, [stale.student_uuid]);
      await dataSource.query(`DELETE FROM student_person WHERE person_uuid = $1`, [stale.person_uuid]);
    }

    const [classroom] = await dataSource.query(
      `
        SELECT c.school_id, c.grade_level_id, c.legacy_room_number,
               t.academic_year, t.semester
        FROM school_classrooms c
        JOIN school_terms t ON t.id = c.school_term_id
        WHERE c.classroom_status = 'ACTIVE' AND c.deleted_at IS NULL AND t.deleted_at IS NULL
        ORDER BY t.academic_year DESC, t.semester DESC, c.id
        LIMIT 1
      `,
    );
    assert(classroom, 'Smoke DB has no ACTIVE classroom — seed the smoke database first');
    const [loginStatus] = await dataSource.query(
      `
        SELECT code FROM student_status
        WHERE category = 'ACTIVE' AND is_active_for_login IS TRUE AND is_enabled IS TRUE
          AND deleted_at IS NULL
        ORDER BY code LIMIT 1
      `,
    );
    assert(loginStatus, 'Smoke DB has no login-capable student_status row');

    [{ person_uuid: personUuid }] = await dataSource.query(
      `INSERT INTO student_person (identity_status) VALUES ('ACTIVE') RETURNING person_uuid`,
    );
    [{ student_uuid: studentUuid }] = await dataSource.query(
      `
        INSERT INTO student_term (
          "PersonID_Onec", person_uuid, "AcademicYear_Onec", "Semester_Onec",
          "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
          student_status_code, "FirstName_Onec", "LastName_Onec"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'พิมพ์ชนก', 'อินทรกำแหง')
        RETURNING student_uuid
      `,
      [
        randomThaiNationalId(),
        personUuid,
        classroom.academic_year,
        classroom.semester,
        classroom.school_id,
        classroom.grade_level_id,
        classroom.legacy_room_number,
        loginStatus.code,
      ],
    );

    await upsertSmokeUser(dataSource, {
      username: ADMIN_USERNAME,
      passwordHash: await passwordService.hash(adminPassword),
      firstName: 'Contact',
      lastName: 'Browser Admin',
      permissions: [
        'students',
        'edit-students',
        'student-observations',
        'manage-student-observations',
        'dashboard',
      ],
      role: 'ADMIN',
      dataScope: { global: true },
    });
    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await navigate(client, `${FRONTEND_URL}/login`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('เข้าสู่ระบบ'),
      'Login page did not render',
    );
    const browserLogin = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/users/login`)}, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            username: ${JSON.stringify(ADMIN_USERNAME)},
            password: ${JSON.stringify(adminPassword)},
          }),
        });
        const body = await response.json();
        if (response.ok) {
          localStorage.setItem('sts_user', JSON.stringify(body));
          localStorage.setItem('admin_access', 'true');
        }
        return { status: response.status };
      })()`,
    );
    assert(browserLogin?.status === 201, `Browser login failed with status ${browserLogin?.status}`);

    // --- Edit form: student contact + guardians ---
    await navigate(client, `${FRONTEND_URL}/students/${studentUuid}/edit`);
    await waitFor(
      async () => Boolean(await evaluate(client, `Boolean(document.querySelector('#contact_phone'))`)),
      'Student contact section did not render on the edit page',
    );
    await fillInput(client, '#contact_phone', '0819998877');
    await fillInput(client, '#contact_line_id', 'pimchanok_in');

    const addButtonExpr = `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('เพิ่มผู้ติดต่อ'))`;
    // Rows default to FATHER → MOTHER → GUARDIAN in order.
    await click(client, addButtonExpr, 'Add-guardian button was not found (row 1)');
    await waitFor(
      async () =>
        Boolean(await evaluate(client, `Boolean(document.querySelector('[id="guardians.0.first_name"]'))`)),
      'First guardian row did not appear',
    );
    await fillInput(client, '[id="guardians.0.first_name"]', 'สมพงษ์');
    await fillInput(client, '[id="guardians.0.last_name"]', 'อินทรกำแหง');
    await fillInput(client, '[id="guardians.0.phone"]', '0891234567');

    await click(client, addButtonExpr, 'Add-guardian button was not found (row 2)');
    await click(client, addButtonExpr, 'Add-guardian button was not found (row 3)');
    await waitFor(
      async () =>
        Boolean(
          await evaluate(client, `Boolean(document.querySelector('[id="guardians.2.relation_note"]'))`),
        ),
      'Third guardian row did not show the relation-note field for GUARDIAN',
    );
    await fillInput(client, '[id="guardians.1.first_name"]', 'สายฝน');
    await fillInput(client, '[id="guardians.1.last_name"]', 'อินทรกำแหง');
    await fillInput(client, '[id="guardians.2.first_name"]', 'บุญส่ง');
    await fillInput(client, '[id="guardians.2.last_name"]', 'แก้วกาญจน์');
    await fillInput(client, '[id="guardians.2.relation_note"]', 'ยาย');
    await fillInput(client, '[id="guardians.2.phone"]', '0865554444');

    const primaryChecked = await evaluate(
      client,
      `document.querySelector('[name="guardians.1.is_primary"]')?.checked === false &&
       document.querySelector('[name="guardians.0.is_primary"]')?.checked === true`,
    );
    assert(primaryChecked === true, 'First guardian row was not defaulted as the primary contact');

    // The visible Select label must reflect the row's actual relation value
    // (regression: the custom Select showed the first option for values set
    // through the form library's ref).
    const motherSelectLabel = await evaluate(
      client,
      `document.querySelector('[id="guardians.1.relation"]')?.textContent.trim()`,
    );
    assert(
      motherSelectLabel === 'มารดา',
      `Second guardian relation select shows "${motherSelectLabel}" instead of มารดา`,
    );

    await capture(client, '/tmp/sts-student-contact-edit.png');
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('บันทึกข้อมูล'))`,
      'Save button was not found',
    );
    await waitFor(
      async () => !String(await evaluate(client, 'location.pathname')).endsWith('/edit'),
      'Saving the edit form did not navigate away',
    );

    // --- Persisted? Check the DB, then the detail page rendering. ---
    const guardianRows = await dataSource.query(
      `SELECT relation, relation_note, full_name, is_primary
       FROM student_guardian WHERE person_uuid = $1 AND deleted_at IS NULL
       ORDER BY relation`,
      [personUuid],
    );
    assert(guardianRows.length === 3, `Expected 3 live guardians, found ${guardianRows.length}`);
    const grandmother = guardianRows.find((row) => row.relation === 'GUARDIAN');
    assert(grandmother?.relation_note === 'ยาย', 'GUARDIAN row lost its relation note');
    const [contactRow] = await dataSource.query(
      `SELECT phone, line_id FROM student_person_contact WHERE person_uuid = $1`,
      [personUuid],
    );
    assert(
      contactRow.phone === '0819998877' && contactRow.line_id === 'pimchanok_in',
      'Student contact did not persist to the canonical person row',
    );

    await navigate(client, `${FRONTEND_URL}/students/${studentUuid}`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('ข้อมูลผู้ปกครอง'),
      'Detail page did not render the guardian panel',
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('ยังไม่มีสัญญาณให้ทบทวน'),
      'Risk review empty state did not render',
    );
    const detailText = String(await evaluate(client, 'document.body.innerText'));
    assert(detailText.includes('สมพงษ์ อินทรกำแหง'), 'Father name missing on detail page');
    assert(detailText.includes('ผู้ปกครอง (ยาย)'), 'Guardian relation note missing on detail page');
    assert(detailText.includes('ผู้ติดต่อหลัก'), 'Primary badge missing on detail page');
    assert(detailText.includes('0819998877'), 'Student phone missing on detail page');

    assert(!detailText.toLowerCase().includes('snapshot'), 'Risk review still exposes snapshot jargon');
    assert(
      !detailText.toLowerCase().includes('optimistic revision'),
      'Risk review still exposes optimistic-revision jargon',
    );
    assert(
      !(await evaluate(client, `Boolean(document.querySelector('#human-risk-reason'))`)),
      'Risk-review form must stay hidden when attendance and teacher signals are both empty',
    );

    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'บันทึกข้อสังเกต')`,
      'Profile observation button was not found',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('บันทึกข้อสังเกตจากรายละเอียดนักเรียน'),
      'Profile observation dialog did not open',
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `[...document.querySelectorAll('button')].some((button) => button.textContent.includes('น่ากังวล'))`,
          ),
        ),
      'Observation form did not finish loading',
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('น่ากังวล'))`,
      'CONCERN level button was not found',
    );
    await fillInput(client, '#observation-workspace-comment', 'เหม่อและตามบทเรียนไม่ทันในช่วงท้ายคาบ');
    await click(
      client,
      `document.querySelector('[role="dialog"] button[type="submit"]')`,
      'Observation save button was not found',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('บันทึกเรียบร้อย'),
      'Saved observation feedback did not render',
    );
    await click(
      client,
      `document.querySelector('button[aria-label="Close dialog"]')`,
      'Observation dialog close button was not found',
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'ขอเยี่ยมบ้าน')`,
      'Profile home-visit request button was not found',
    );
    await waitFor(
      async () =>
        Number(
          await evaluate(
            client,
            `document.querySelector('#managed-follow-up-source')?.parentElement?.querySelector('select')?.options.length || 0`,
          ),
        ) > 1,
      'Managed observation without an assignment was not available as home-visit evidence',
    );
    await click(
      client,
      `document.querySelector('#managed-follow-up-source')`,
      'Managed home-visit evidence selector was not found',
    );
    await evaluate(
      client,
      `(() => {
        const option = [...document.querySelectorAll('[role="option"]')]
          .find((item) => !item.textContent.includes('ไม่แนบข้อสังเกต'));
        if (!option) throw new Error('Managed observation evidence option was not found');
        option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      })()`,
    );
    await waitFor(
      async () =>
        String(
          await evaluate(
            client,
            `document.querySelector('#managed-follow-up-source-detail')?.textContent || ''`,
          ),
        ).includes('เหม่อและตามบทเรียนไม่ทันในช่วงท้ายคาบ'),
      'Selected home-visit evidence did not show the teacher comment',
    );
    await click(
      client,
      `document.querySelector('button[aria-label="Close dialog"]')`,
      'Home-visit request dialog close button was not found',
    );
    await waitFor(
      async () => Boolean(await evaluate(client, `Boolean(document.querySelector('#human-risk-reason'))`)),
      'Risk-review form did not appear after a teacher signal was recorded',
    );
    assert(
      String(await evaluate(client, 'document.body.innerText')).includes('เหม่อและตามบทเรียนไม่ทันในช่วงท้ายคาบ'),
      'Risk review did not show the teacher comment before the decision form',
    );
    await fillInput(client, '#human-risk-reason', 'ประเมินจากข้อสังเกตที่ครูบันทึก');
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('บันทึกผลทบทวน'))`,
      'Risk-review save button was not found',
    );
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return text.includes('ประเมินจากข้อสังเกตที่ครูบันทึก');
      },
      'Attendance-only risk review was not rendered after save',
    );
    const [riskReview] = await dataSource.query(
      `SELECT id, teacher_concern_signal FROM student_observation_risk_reviews
       WHERE student_uuid = $1 ORDER BY revision_number DESC LIMIT 1`,
      [studentUuid],
    );
    assert(riskReview?.teacher_concern_signal === 'CONCERN', 'Risk review should store teacher signal CONCERN');
    const [riskSources] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM student_observation_risk_review_sources
       WHERE risk_review_id = $1`,
      [riskReview.id],
    );
    assert(riskSources.count === 1, 'Risk review should reference the teacher observation');

    await navigate(client, `${FRONTEND_URL}/student-risk-report/teacher-reports`);
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return text.includes('ข้อสังเกตจากครู') && text.includes('พิมพ์ชนก อินทรกำแหง');
      },
      'Teacher observation queue did not render the WATCH observation',
    );
    const reportText = String(await evaluate(client, 'document.body.innerText'));
    assert(reportText.includes('เหม่อและตามบทเรียนไม่ทันในช่วงท้ายคาบ'), 'Observation comment missing from report queue');
    const reportTableLayout = await evaluate(
      client,
      `(() => {
        const table = document.querySelector('table');
        const shell = table?.closest('.rounded-lg.border');
        const outer = shell?.parentElement;
        return {
          hasNestedCard: Boolean(outer?.className.includes('p-4') && outer?.className.includes('bg-white')),
          sortButtonCount: document.querySelectorAll('thead button').length,
        };
      })()`,
    );
    assert(!reportTableLayout.hasNestedCard, 'Teacher observation table is still wrapped in a nested card');
    assert(reportTableLayout.sortButtonCount >= 5, 'Teacher observation columns do not expose sort controls');
    await click(
      client,
      `[...document.querySelectorAll('thead button')].find((button) => button.textContent.includes('นักเรียน'))`,
      'Teacher observation student sort button was not found',
    );
    await waitFor(
      async () =>
        String(
          await evaluate(
            client,
            `document.querySelector('th[aria-sort="ascending"]')?.textContent || ''`,
          ),
        ).includes('นักเรียน'),
      'Teacher observation student sort did not become active',
    );
    await capture(client, '/tmp/sts-teacher-observation-reports.png');
    await click(
      client,
      `[...document.querySelectorAll('a')].find((link) => link.textContent.includes('ดูรายละเอียด'))`,
      'Teacher observation detail link was not found',
    );
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return text.includes('รายละเอียดข้อสังเกต') && text.includes('เหม่อและตามบทเรียนไม่ทันในช่วงท้ายคาบ');
      },
      'Teacher observation detail did not render the full comment',
    );
    const detailUrl = String(await evaluate(client, 'location.href'));
    await navigate(client, detailUrl);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('ความเห็นจากครู'),
      'Teacher observation detail did not survive refresh',
    );
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return (
          text.includes('ทบทวนสัญญาณความเสี่ยง') &&
          text.includes('คำขอเยี่ยมบ้านจากครู') &&
          text.includes('สรุปข้อสังเกต')
        );
      },
      'Teacher observation detail did not expose the student follow-up workspace',
    );
    await navigate(client, `${FRONTEND_URL}/student-risk-report/home-visit-requests`);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('คำขอเยี่ยมบ้าน'),
      'Home-visit request queue route did not render',
    );
    await navigate(client, `${FRONTEND_URL}/students/${studentUuid}`);
    await waitFor(
      async () => Boolean(await evaluate(client, `Boolean(document.querySelector('[aria-label="ทบทวนข้อสังเกตนักเรียน"]'))`)),
      'Student review panel did not render after returning from report routes',
    );
    const profileActionPresentation = await evaluate(
      client,
      `(() => {
        const labels = ['บันทึกข้อสังเกต', 'ขอเยี่ยมบ้าน', 'แก้ไขข้อมูลนักเรียน', 'ย้อนกลับ'];
        const buttons = labels.map((label) =>
          [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === label),
        );
        const visibleButtons = buttons.filter(Boolean);
        return {
          heights: visibleButtons.map((button) => button.getBoundingClientRect().height),
          hasHomeVisitAction: Boolean(buttons[1]),
          primaryBackgrounds: buttons.slice(0, 2).map((button) =>
            button ? getComputedStyle(button).backgroundColor : '',
          ),
        };
      })()`,
    );
    assert(
      profileActionPresentation.heights.every(
        (height) => height > 0 && Math.abs(height - profileActionPresentation.heights[0]) < 0.5,
      ),
      'Student detail action buttons do not share the same height',
    );
    assert(
      !profileActionPresentation.hasHomeVisitAction ||
        profileActionPresentation.primaryBackgrounds[0] ===
          profileActionPresentation.primaryBackgrounds[1],
      'Home-visit request action does not use the primary blue treatment',
    );
    await evaluate(
      client,
      `document.querySelector('[aria-label="ทบทวนข้อสังเกตนักเรียน"]')?.scrollIntoView({ block: 'start' })`,
    );
    await capture(client, '/tmp/sts-student-contact-detail.png');

    console.log(
      JSON.stringify({
        status: 'student_contact_browser_smoke_ok',
        screenshots: ['/tmp/sts-student-contact-edit.png', '/tmp/sts-student-contact-detail.png'],
        checked: [
          'edit page renders contact + guardian sections',
          'guardian rows default FATHER → MOTHER → GUARDIAN',
          'GUARDIAN row shows relation-note field',
          'first guardian defaults to primary',
          'staff saves contact for a student without an account',
          'detail page shows guardians, note, primary badge, phone',
          'risk review hides internal snapshot/revision wording',
          'empty risk signals hide the review form',
          'profile records a CONCERN observation',
          'managed observations without assignments remain selectable as home-visit evidence',
          'selected home-visit evidence shows the teacher comment and attribution',
          'risk review appears after evidence and cites the observation',
          'risk review shows the full teacher comment before decision',
          'teacher observation queue and refresh-safe detail route render',
          'teacher observation detail exposes risk review, home visit and summary actions',
          'report tables use the shared non-nested shell and server sort controls',
          'home-visit request queue is a separate route',
          'student detail actions share one height and home-visit request is primary',
        ],
      }),
    );
  } catch (error) {
    if (chrome) {
      try {
        await capture(chrome.client, '/tmp/sts-student-contact-failure.png');
        console.error(
          'page text at failure:',
          String(await evaluate(chrome.client, 'document.body.innerText')).slice(0, 600),
        );
      } catch {
        // diagnostics are best-effort
      }
    }
    throw error;
  } finally {
    await closeChrome(chrome);
    await dataSource.query(
      `UPDATE users SET status = 'DISABLED', person_uuid = NULL WHERE username = ANY($1::text[])`,
      [[ADMIN_USERNAME, STUDENT_USERNAME]],
    );
    if (personUuid) {
      await dataSource.query(
        `DELETE FROM student_observation_risk_reviews WHERE student_uuid = $1`,
        [studentUuid],
      );
      await dataSource.query(
        `DELETE FROM student_observation_revisions
         WHERE observation_id IN (SELECT id FROM student_observations WHERE student_uuid = $1)`,
        [studentUuid],
      );
      await dataSource.query(`DELETE FROM student_observations WHERE student_uuid = $1`, [studentUuid]);
      await dataSource.query(`DELETE FROM student_term WHERE person_uuid = $1`, [personUuid]);
      await dataSource.query(`DELETE FROM student_person WHERE person_uuid = $1`, [personUuid]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
