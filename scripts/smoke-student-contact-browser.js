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
const LIMITED_USERNAME = 'student_contact_browser_limited';

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
  { username, passwordHash, firstName, lastName, permissions, role, dataScope },
) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2, "FirstName" = $3, "LastName" = $4, status = 'ACTIVE',
            permissions = $5::jsonb, role = $6, data_scope = $7::jsonb,
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
      ],
    );
    return existing;
  }
  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code
      )
      VALUES ($1, $2, $3, $4, 'ACTIVE', $5::jsonb, $6, $7::jsonb, FALSE, $8, 'AUTOMATED_TEST')
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
  let createdPersonUuid = null;
  let createdStudentUuid = null;

  try {
    const staleStudents = await dataSource.query(
      `SELECT student_uuid, person_uuid FROM student_term
       WHERE "FirstName_Onec" = 'พิมพ์ชนก' AND "LastName_Onec" = 'อินทรกำแหง'`,
    );
    for (const stale of staleStudents) {
      await dataSource.query(`DELETE FROM student_term WHERE student_uuid = $1`, [stale.student_uuid]);
      await dataSource.query(`DELETE FROM student_person WHERE person_uuid = $1`, [stale.person_uuid]);
    }

    const [classroom] = await dataSource.query(
      `
        SELECT c.id, c.school_id, c.grade_level_id, c.legacy_room_number,
               t.academic_year, t.semester
        FROM school_classrooms c
        JOIN school_terms t ON t.id = c.school_term_id
        WHERE c.classroom_status = 'ACTIVE' AND c.deleted_at IS NULL AND t.deleted_at IS NULL
        ORDER BY t.academic_year DESC, t.semester DESC, c.id
        LIMIT 1
      `,
    );
    assert(classroom, 'Smoke DB has no ACTIVE classroom — seed the smoke database first');
    const [outsideClassroom] = await dataSource.query(
      `
        SELECT c.id, c.school_id
        FROM school_classrooms c
        JOIN school_terms t ON t.id = c.school_term_id
        WHERE c.classroom_status = 'ACTIVE' AND c.deleted_at IS NULL AND t.deleted_at IS NULL
          AND c.school_id <> $1
        ORDER BY t.academic_year DESC, t.semester DESC, c.id
        LIMIT 1
      `,
      [classroom.school_id],
    );
    assert(outsideClassroom, 'Smoke DB needs ACTIVE classrooms from at least two schools');
    const [loginStatus] = await dataSource.query(
      `
        SELECT code FROM student_status
        WHERE category = 'STUDYING' AND is_active_for_login IS TRUE AND is_enabled IS TRUE
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
      permissions: ['students', 'manage-students', 'dashboard'],
      role: 'ADMIN',
      dataScope: { global: true },
    });
    await upsertSmokeUser(dataSource, {
      username: LIMITED_USERNAME,
      passwordHash: await passwordService.hash(adminPassword),
      firstName: 'Contact',
      lastName: 'Browser Limited',
      permissions: ['students', 'manage-students'],
      role: 'ADMIN',
      dataScope: { school_ids: [classroom.school_id] },
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

    // --- Management list → avatar detail → edit → back keeps its origin. ---
    await navigate(client, `${FRONTEND_URL}/manage-students`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('input[placeholder="ค้นหาชื่อนักเรียน..."]'))`,
          ),
        ),
      'Managed student search did not render',
    );
    await fillInput(client, 'input[placeholder="ค้นหาชื่อนักเรียน..."]', 'อินทรกำแหง');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('พิมพ์ชนก อินทรกำแหง'),
      'Managed student row did not render',
    );
    const managementControls = await evaluate(
      client,
      `Boolean([...document.querySelectorAll('button')].find((button) => button.textContent.includes('เพิ่มนักเรียน')))
       && Boolean(document.querySelector('button[aria-label="แก้ไขข้อมูลของ พิมพ์ชนก อินทรกำแหง"]'))`,
    );
    assert(managementControls === true, 'Managed student list is missing add/edit actions');
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('เพิ่มนักเรียน'))`,
      'Add-student button was not found',
    );
    await waitFor(
      async () => String(await evaluate(client, 'location.pathname')) === '/manage-students/new',
      'Add-student button did not open the create page',
    );
    const createFields = await evaluate(
      client,
      `Boolean(document.querySelector('#student-national-id'))
       && document.body.innerText.includes('โรงเรียน ปีการศึกษา ชั้น และห้อง')
       && document.body.innerText.includes('สถานะนักเรียน')`,
    );
    assert(createFields === true, 'Student create page is missing identity or education fields');
    const createdNationalId = randomThaiNationalId();
    const createResult = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/students`)}, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            PersonID_Onec: ${JSON.stringify(createdNationalId)},
            FirstName_Onec: 'สร้างจริง',
            LastName_Onec: 'ผ่านเบราว์เซอร์',
            classroom_id: ${Number(classroom.id)},
            student_status_code: ${Number(loginStatus.code)},
            contact: { phone: '0811112233' },
            guardians: [{
              relation: 'MOTHER',
              first_name: 'ผู้ปกครอง',
              last_name: 'ทดสอบ',
              is_primary: true,
            }],
          }),
        });
        return { status: response.status, body: await response.json() };
      })()`,
    );
    assert(createResult?.status === 201, `Creating a student failed with ${createResult?.status}`);
    const [createdRow] = await dataSource.query(
      `
        SELECT enrollment.student_uuid, enrollment.person_uuid,
          enrollment.classroom_id, enrollment.student_status_code,
          contact.phone,
          COUNT(guardian.id)::int AS guardian_count,
          COUNT(profile.student_uuid)::int AS risk_profile_count
        FROM student_person_identifier identifier
        JOIN student_term enrollment ON enrollment.person_uuid = identifier.person_uuid
        LEFT JOIN student_person_contact contact ON contact.person_uuid = enrollment.person_uuid
        LEFT JOIN student_guardian guardian
          ON guardian.person_uuid = enrollment.person_uuid AND guardian.deleted_at IS NULL
        LEFT JOIN student_risk_profiles profile ON profile.student_uuid = enrollment.student_uuid
        WHERE identifier.identifier_type = 'NATIONAL_ID'
          AND identifier.identifier_normalized = $1
          AND identifier.deleted_at IS NULL
        GROUP BY enrollment.student_uuid, enrollment.person_uuid,
          enrollment.classroom_id, enrollment.student_status_code, contact.phone
      `,
      [createdNationalId],
    );
    assert(createdRow, 'Created student was not persisted');
    createdStudentUuid = createdRow.student_uuid;
    createdPersonUuid = createdRow.person_uuid;
    assert(String(createdRow.classroom_id) === String(classroom.id), 'Created student lost classroom');
    assert(
      Number(createdRow.student_status_code) === Number(loginStatus.code),
      'Created student lost status',
    );
    assert(createdRow.phone === '0811112233', 'Created student contact was not atomic');
    assert(createdRow.guardian_count === 1, 'Created student guardian was not persisted');
    assert(createdRow.risk_profile_count === 1, 'Created student risk profile was not recalculated');

    const duplicateResult = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/students`)}, {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            PersonID_Onec: ${JSON.stringify(createdNationalId)}, FirstName_Onec: 'ซ้ำ',
            LastName_Onec: 'ทดสอบ', classroom_id: ${Number(classroom.id)},
            student_status_code: ${Number(loginStatus.code)}
          }),
        });
        return { status: response.status };
      })()`,
    );
    assert(duplicateResult?.status === 409, `Duplicate student returned ${duplicateResult?.status}`);
    await navigate(client, `${FRONTEND_URL}/manage-students`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('input[placeholder="ค้นหาชื่อนักเรียน..."]'))`,
          ),
        ),
      'Managed student search did not render after returning from create',
    );
    await fillInput(client, 'input[placeholder="ค้นหาชื่อนักเรียน..."]', 'อินทรกำแหง');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('พิมพ์ชนก อินทรกำแหง'),
      'Managed student row did not render after returning from create',
    );
    await click(
      client,
      `document.querySelector('button[aria-label="เปิดข้อมูลนักเรียน พิมพ์ชนก อินทรกำแหง"]')`,
      'Student avatar did not open the detail page',
    );
    await waitFor(
      async () => String(await evaluate(client, 'location.pathname')) === `/students/${studentUuid}`,
      'Student avatar did not preserve the management detail route',
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `[...document.querySelectorAll('button')].some((button) => button.textContent.includes('แก้ไขข้อมูล'))`,
          ),
        ),
      'Student detail edit button did not render',
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('แก้ไขข้อมูล'))`,
      'Student detail edit button was not found',
    );
    await waitFor(
      async () => String(await evaluate(client, 'location.pathname')).endsWith('/edit'),
      'Student detail did not open edit page',
    );
    await waitFor(
      async () =>
        Boolean(await evaluate(client, `Boolean(document.querySelector('#student_number'))`)),
      'Student education fields did not render on edit page',
    );
    const expandedEditFields = await evaluate(
      client,
      `Boolean(document.querySelector('#student_number'))
       && Boolean(document.querySelector('#student_status_code'))
       && document.body.innerText.includes('ข้อมูลระบุตัวตน')
       && document.body.innerText.includes('ข้อมูลการเรียน')`,
    );
    assert(expandedEditFields === true, 'Student edit page is missing identity/education fields');
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'ย้อนกลับ')`,
      'Edit-page back button was not found',
    );
    await waitFor(
      async () => String(await evaluate(client, 'location.pathname')) === `/students/${studentUuid}`,
      'Edit-page back button did not return to student detail',
    );
    assert(
      String(await evaluate(client, 'document.body.innerText')).includes('จัดการนักเรียน'),
      'Student detail breadcrumb lost the จัดการนักเรียน origin',
    );

    // --- Edit form: student contact + guardians ---
    await navigate(client, `${FRONTEND_URL}/manage-students/${studentUuid}/edit`);
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
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('button[aria-label="ดูเบอร์ติดต่อนักเรียนและผู้ปกครอง"]'))`,
          ),
        ),
      'Student contact action did not render',
    );
    await click(
      client,
      'document.querySelector(\'button[aria-label="ดูเบอร์ติดต่อนักเรียนและผู้ปกครอง"]\')',
      'Student contact action could not be opened',
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'ช่องทางติดต่อนักเรียนและผู้ปกครอง',
        ),
      'Student contact dialog did not render',
    );
    const detailText = String(await evaluate(client, 'document.body.innerText'));
    assert(detailText.includes('สมพงษ์ อินทรกำแหง'), 'Father name missing on detail page');
    assert(detailText.includes('ผู้ปกครอง (ยาย)'), 'Guardian relation note missing on detail page');
    assert(detailText.includes('ผู้ติดต่อหลัก'), 'Primary badge missing on detail page');
    assert(detailText.includes('0819998877'), 'Student phone missing on detail page');
    await navigate(client, `${FRONTEND_URL}/students/${studentUuid}`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('button[aria-label="ดูเบอร์ติดต่อนักเรียนและผู้ปกครอง"]'))`,
          ),
        ),
      'Student profile did not render after returning to it',
    );
    const profileActionPresentation = await evaluate(
      client,
      `(() => {
        const labels = ['แก้ไขข้อมูล', 'ย้อนกลับ'];
        const buttons = labels.map((label) =>
          [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === label),
        );
        const visibleButtons = buttons.filter(Boolean);
        return {
          heights: visibleButtons.map((button) => button.getBoundingClientRect().height),
        };
      })()`,
    );
    assert(
      profileActionPresentation.heights.every(
        (height) => height > 0 && Math.abs(height - profileActionPresentation.heights[0]) < 0.5,
      ),
      'Student detail action buttons do not share the same height',
    );
    await capture(client, '/tmp/sts-student-contact-detail.png');

    const limitedLogin = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/users/login`)}, {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            username: ${JSON.stringify(LIMITED_USERNAME)},
            password: ${JSON.stringify(adminPassword)},
          }),
        });
        return { status: response.status };
      })()`,
    );
    assert(limitedLogin?.status === 201, `Limited-scope login failed with ${limitedLogin?.status}`);
    const deniedNationalId = randomThaiNationalId();
    const deniedCreate = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/students`)}, {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            PersonID_Onec: ${JSON.stringify(deniedNationalId)}, FirstName_Onec: 'นอก',
            LastName_Onec: 'ขอบเขต', classroom_id: ${Number(outsideClassroom.id)},
            student_status_code: ${Number(loginStatus.code)}
          }),
        });
        return { status: response.status };
      })()`,
    );
    assert(deniedCreate?.status === 404, `Out-of-scope create returned ${deniedCreate?.status}`);
    const [deniedPersisted] = await dataSource.query(
      `SELECT 1 FROM student_person_identifier
       WHERE identifier_type = 'NATIONAL_ID' AND identifier_normalized = $1 AND deleted_at IS NULL`,
      [deniedNationalId],
    );
    assert(!deniedPersisted, 'Out-of-scope create persisted an identity');

    console.log(
      JSON.stringify({
        status: 'student_contact_browser_smoke_ok',
        screenshots: ['/tmp/sts-student-contact-edit.png', '/tmp/sts-student-contact-detail.png'],
        checked: [
          'edit page renders contact + guardian sections',
          'managed list exposes add/edit actions',
          'add action opens a real student form with identity and education fields',
          'create API persists identity, enrollment, contact, guardian, and risk profile',
          'duplicate identity returns 409',
          'out-of-scope classroom creation returns 404 without persistence',
          'avatar → detail → edit → back keeps the จัดการนักเรียน origin',
          'edit page exposes identity and education fields',
          'guardian rows default FATHER → MOTHER → GUARDIAN',
          'GUARDIAN row shows relation-note field',
          'first guardian defaults to primary',
          'staff saves contact for a student without an account',
          'detail page shows guardians, note, primary badge, phone',
          'student detail actions share one height',
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
      `UPDATE users SET status = 'DISABLED' WHERE username = ANY($1::text[])`,
      [[ADMIN_USERNAME, LIMITED_USERNAME]],
    );
    if (createdPersonUuid) {
      if (createdStudentUuid) {
        await dataSource.query(`DELETE FROM student_risk_profiles WHERE student_uuid = $1`, [
          createdStudentUuid,
        ]);
      }
      await dataSource.query(`DELETE FROM student_term WHERE person_uuid = $1`, [createdPersonUuid]);
      await dataSource.query(`DELETE FROM student_person WHERE person_uuid = $1`, [createdPersonUuid]);
    }
    if (personUuid) {
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
