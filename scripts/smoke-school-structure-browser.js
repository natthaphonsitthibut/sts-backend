const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');

if (process.env.NODE_ENV === 'production') throw new Error('Refusing production browser smoke');
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9253);
const DIRECTOR_USERNAME = 'school_structure_browser_director';
const MULTI_DIRECTOR_USERNAME = 'classrooms_browser_multi_director';
const TEACHER_USERNAME = 'school_structure_browser_teacher';
const ACADEMIC_YEAR = 2999;
const ROOM_NUMBER = 991;
const DIAGNOSTIC_PATH = process.env.SMOKE_DIAGNOSTIC_PATH || '';
const SCREENSHOT_PATH = process.env.SMOKE_SCREENSHOT_PATH || '';

function diagnostic(message) {
  if (DIAGNOSTIC_PATH) fs.appendFileSync(DIAGNOSTIC_PATH, `${message}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    `Page did not load: ${url}`,
  );
}

async function openChrome() {
  assert(fs.existsSync(CHROME_PATH), 'Google Chrome executable was not found');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-school-structure-chrome-'));
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
  fs.rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 5 });
}

async function login(password, username = DIRECTOR_USERNAME) {
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
    cookieName: cookiePair.slice(0, separator),
    cookieValue: cookiePair.slice(separator + 1),
  };
}

async function upsertUser(dataSource, passwordHash, input) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    input.username,
  ]);
  const values = [
    input.username,
    passwordHash,
    input.firstName,
    input.lastName,
    input.role,
    JSON.stringify(input.permissions),
    JSON.stringify(input.dataScope),
  ];
  const result = existing
    ? await dataSource.query(
        `UPDATE users
         SET password=$2, "FirstName"=$3, "LastName"=$4, role=$5,
             permissions=$6::jsonb, data_scope=$7::jsonb, status='ACTIVE',
             must_change_password=FALSE, deactivated_at=NULL, deactivated_by=NULL,
             deactivation_reason_code=NULL, deactivation_note=NULL,
             data_origin_code='AUTOMATED_TEST', email=NULL, phone=NULL
         WHERE username=$1 RETURNING id`,
        values,
      )
    : await dataSource.query(
        `INSERT INTO users (
           username, password, "FirstName", "LastName", role, permissions, data_scope,
           status, must_change_password, data_origin_code
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'ACTIVE',FALSE,'AUTOMATED_TEST')
         RETURNING id`,
        values,
      );
  const rows = Array.isArray(result[0]) ? result[0] : result;
  const [row] = rows;
  assert(row?.id, `Smoke user ${input.username} was not persisted`);
  return row;
}

async function browserRequest(client, method, requestPath, body) {
  return evaluate(
    client,
    `(async () => {
      const response = await fetch(${JSON.stringify(`${BACKEND_URL}${requestPath}`)}, {
        method: ${JSON.stringify(method)},
        credentials: 'include',
        headers: ${body === undefined ? '{}' : "{'content-type':'application/json'}"},
        body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))}
      });
      const text = await response.text();
      return { status: response.status, payload: text ? JSON.parse(text) : null };
    })()`,
  );
}

async function browserCsvRequest(client, requestPath, fields, csv) {
  return evaluate(
    client,
    `(async () => {
      const form = new FormData();
      form.append('file', new File([${JSON.stringify(csv)}], 'smoke.csv', { type: 'text/csv' }));
      const fields = ${JSON.stringify(fields)};
      Object.entries(fields).forEach(([key, value]) => form.append(key, String(value)));
      const response = await fetch(${JSON.stringify(`${BACKEND_URL}${requestPath}`)}, {
        method: 'POST', credentials: 'include', body: form
      });
      const text = await response.text();
      return { status: response.status, payload: text ? JSON.parse(text) : null };
    })()`,
  );
}

async function chooseCombobox(client, ariaLabel, optionLabel, searchTerm = '') {
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const input = document.querySelector(${JSON.stringify(`[aria-label="${ariaLabel}"]`)});
            return input && !input.disabled;
          })()`,
        ),
      ),
    `Combobox was not enabled: ${ariaLabel}`,
  );
  const opened = await evaluate(
    client,
    `document.querySelector(${JSON.stringify(`[aria-label="${ariaLabel}"]`)})?.click() === undefined`,
  );
  assert(opened, `Could not open combobox: ${ariaLabel}`);
  if (searchTerm) {
    await evaluate(
      client,
      `document.querySelector(${JSON.stringify(`[aria-label="${ariaLabel}"]`)})?.focus()`,
    );
    await client.call('Input.insertText', { text: searchTerm });
    await waitFor(
      async () =>
        (await evaluate(
          client,
          `document.querySelector(${JSON.stringify(`[aria-label="${ariaLabel}"]`)})?.value`,
        )) === searchTerm,
      `Combobox search did not settle: ${ariaLabel}`,
    );
  }
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `Array.from(document.querySelectorAll('button')).some((button) => button.textContent.trim() === ${JSON.stringify(optionLabel)})`,
        ),
      ),
    `Combobox option was not available: ${optionLabel}`,
  );
  const selected = await evaluate(
    client,
    `(() => {
      const option = Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent.trim() === ${JSON.stringify(optionLabel)});
      if (!option) return false;
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      option.click();
      return true;
    })()`,
  );
  assert(selected, `Could not choose combobox option: ${optionLabel}`);
  await waitFor(
    async () =>
      (await evaluate(
        client,
        `document.querySelector(${JSON.stringify(`[aria-label="${ariaLabel}"]`)})?.value`,
      )) === optionLabel,
    `Combobox selection did not settle: ${optionLabel}`,
  );
}

async function changeNativeSelect(client, ariaLabel, value) {
  const changed = await evaluate(
    client,
    `(() => {
      const select = document.querySelector(${JSON.stringify(`[aria-label="${ariaLabel}"]`)});
      if (!select || select.disabled) return false;
      select.value = ${JSON.stringify(String(value))};
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value === ${JSON.stringify(String(value))};
    })()`,
  );
  assert(changed, `Could not select ${value} from ${ariaLabel}`);
}

async function readSummaryMetric(client, label) {
  return evaluate(
    client,
    `(() => {
      const labelNode = Array.from(document.querySelectorAll('div'))
        .find((node) => node.children.length === 0 && node.textContent.trim() === ${JSON.stringify(label)});
      return labelNode?.parentElement?.children[1]?.textContent?.trim() ?? null;
    })()`,
  );
}

async function cleanup(dataSource, actorId, schoolId, studentIdentifier = null) {
  const [identifier] = studentIdentifier
    ? await dataSource.query(
        `SELECT identifier.person_uuid
         FROM student_person_identifier identifier
         JOIN student_term enrollment ON enrollment.person_uuid = identifier.person_uuid
         JOIN school_terms term ON term.id = enrollment.school_term_id
         WHERE identifier.identifier_type='NATIONAL_ID'
           AND identifier.identifier_normalized=$1
           AND enrollment."SchoolID_Onec"=$2
           AND term.academic_year=$3
         LIMIT 1`,
        [studentIdentifier, schoolId, ACADEMIC_YEAR],
      )
    : [];
  if (identifier) {
    await dataSource.query(
      `DELETE FROM attendance
       WHERE student_uuid IN (
         SELECT student_uuid FROM student_term
         WHERE person_uuid=$1 AND "SchoolID_Onec"=$2
       )`,
      [identifier.person_uuid, schoolId],
    );
    await dataSource.query(
      `DELETE FROM student_term enrollment
       USING school_terms term
       WHERE enrollment.school_term_id=term.id
         AND enrollment.person_uuid=$1
         AND enrollment."SchoolID_Onec"=$2
         AND term.academic_year=$3`,
      [identifier.person_uuid, schoolId, ACADEMIC_YEAR],
    );
    const [{ enrollment_count: remainingEnrollmentCount }] = await dataSource.query(
      `SELECT COUNT(*)::int AS enrollment_count FROM student_term WHERE person_uuid=$1`,
      [identifier.person_uuid],
    );
    if (remainingEnrollmentCount === 0) {
      await dataSource.query(`DELETE FROM student_person_identifier WHERE person_uuid=$1`, [
        identifier.person_uuid,
      ]);
      await dataSource.query(`DELETE FROM student_person WHERE person_uuid=$1`, [
        identifier.person_uuid,
      ]);
    }
  }
  const batches = await dataSource.query(
    `SELECT id FROM student_import_batches WHERE created_by=$1`,
    [actorId],
  );
  if (batches.length > 0) {
    const ids = batches.map((batch) => batch.id);
    await dataSource.query(`DELETE FROM student_import_quarantine_rows WHERE batch_id=ANY($1::uuid[])`, [ids]);
    await dataSource.query(`DELETE FROM student_import_batches WHERE id=ANY($1::uuid[])`, [ids]);
  }
  await dataSource.query(
    `DELETE FROM classroom_teacher_assignments WHERE school_id=$1 AND created_by=$2`,
    [schoolId, actorId],
  );
  await dataSource.query(
    `DELETE FROM school_teacher_memberships WHERE school_id=$1 AND created_by=$2`,
    [schoolId, actorId],
  );
  await dataSource.query(
    `DELETE FROM school_classrooms WHERE school_id=$1 AND room_code=$2 AND created_by=$3`,
    [schoolId, String(ROOM_NUMBER), actorId],
  );
  await dataSource.query(
    `DELETE FROM school_terms WHERE school_id=$1 AND academic_year=$2 AND created_by=$3`,
    [schoolId, ACADEMIC_YEAR, actorId],
  );
}

async function main() {
  diagnostic('main:start');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  diagnostic('main:app-context');
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  let chrome;
  let actor;
  let schoolA;
  const studentIdentifier = `98${String(Date.now()).slice(-11)}`;
  const studentNumber = `66${String(Date.now()).slice(-6)}`;
  const directImportCsvPath = path.join(
    os.tmpdir(),
    `sts-direct-import-${studentIdentifier}.csv`,
  );
  const classroomCoverPath = path.join(
    os.tmpdir(),
    `sts-classroom-cover-${studentIdentifier}.png`,
  );
  try {
    const schools = await dataSource.query(
      `SELECT id, name FROM schools WHERE school_status='ACTIVE' ORDER BY id LIMIT 2`,
    );
    diagnostic('main:fixtures-start');
    assert(schools.length === 2, 'Smoke requires two active schools');
    [schoolA] = schools;
    const schoolB = schools[1];
    const grade = (
      await dataSource.query(`SELECT id, label FROM grade_levels ORDER BY id LIMIT 1`)
    )[0];
    const status = (
      await dataSource.query(
        `SELECT code FROM student_status WHERE category <> 'UNMAPPED' ORDER BY code LIMIT 1`,
      )
    )[0];
    const password = `Structure-Smoke-${Date.now()}`;
    const hash = await passwordService.hash(password);
    actor = await upsertUser(dataSource, hash, {
      username: DIRECTOR_USERNAME,
      firstName: 'School Structure',
      lastName: 'Browser Smoke',
      role: 'DIRECTOR',
      permissions: [
        'home',
        'students',
        'manage-school-structure',
        'import-data',
        'import-school-roster',
        'export-data',
      ],
      dataScope: { school_ids: [schoolA.id] },
    });
    await upsertUser(dataSource, hash, {
      username: TEACHER_USERNAME,
      firstName: 'ครูทดสอบ',
      lastName: 'โครงสร้างโรงเรียน',
      role: 'TEACHER',
      permissions: ['attendance'],
      dataScope: { school_ids: [schoolA.id] },
    });
    await upsertUser(dataSource, hash, {
      username: MULTI_DIRECTOR_USERNAME,
      firstName: 'Multi School',
      lastName: 'Browser Smoke',
      role: 'DIRECTOR',
      permissions: ['home', 'manage-school-structure'],
      dataScope: { school_ids: [schoolA.id, schoolB.id] },
    });
    await cleanup(dataSource, actor.id, schoolA.id);
    await sharp({
      create: {
        width: 64,
        height: 36,
        channels: 3,
        background: { r: 79, g: 134, b: 232 },
      },
    })
      .png()
      .toFile(classroomCoverPath);
    const [identifierCollision] = await dataSource.query(
      `SELECT 1 FROM student_person_identifier
       WHERE identifier_type='NATIONAL_ID' AND identifier_normalized=$1`,
      [studentIdentifier],
    );
    assert(!identifierCollision, 'Generated student identifier unexpectedly already exists');
    const session = await login(password);
    diagnostic('main:login');

    chrome = await openChrome();
    diagnostic('main:chrome');
    await chrome.client.call('Page.enable');
    await chrome.client.call('Runtime.enable');
    await chrome.client.call('Network.enable');
    await chrome.client.call('DOM.enable');
    await chrome.client.call('Network.setCookie', {
      name: session.cookieName,
      value: session.cookieValue,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    await navigate(chrome.client, `${FRONTEND_URL}/login`);
    await evaluate(
      chrome.client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(session.user))});
       localStorage.setItem('admin_access','true');`,
    );
    await navigate(chrome.client, `${FRONTEND_URL}/school-structure`);
    diagnostic('main:school-structure-page');
    try {
      await waitFor(
        async () =>
          (await evaluate(chrome.client, 'document.body.innerText')).includes('โครงสร้างโรงเรียน'),
        'School structure page did not render',
      );
    } catch (error) {
      const diagnostic = await evaluate(
        chrome.client,
        `({ url: location.href, text: document.body.innerText.slice(0, 1200) })`,
      );
      throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
    }
    try {
      await waitFor(
        async () =>
          (await evaluate(
            chrome.client,
            `document.querySelector('[aria-label="เลือกโรงเรียน"]')?.value`,
          )) === schoolA.name,
        'Scoped school did not finish loading',
      );
    } catch (error) {
      const diagnostic = await evaluate(
        chrome.client,
        `({ url: location.href, text: document.body.innerText.slice(0, 1200) })`,
      );
      throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
    }
    await evaluate(
      chrome.client,
      `document.querySelector('[aria-label="เลือกโรงเรียน"]')?.click()`,
    );
    const visibleSchoolOptions = await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('button')).map((button) => button.textContent.trim())`,
    );
    assert(visibleSchoolOptions.includes(schoolA.name), 'Scoped school A was not visible');
    assert(!visibleSchoolOptions.includes(schoolB.name), 'School B leaked into scoped browser page');
    await evaluate(
      chrome.client,
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    );

    const crossSchool = await browserRequest(
      chrome.client,
      'GET',
      `/api/school-structure/classrooms?schoolId=${schoolB.id}`,
    );
    assert(crossSchool.status === 404, 'Cross-school classroom probing did not fail closed');

    const termResponse = await browserRequest(chrome.client, 'POST', '/api/attendance/terms', {
      schoolId: schoolA.id,
      academicYear: ACADEMIC_YEAR,
      semester: 1,
      startsOn: '2026-06-01',
      endsOn: '2027-03-31',
      status: 'DRAFT',
    });
    assert(
      termResponse.status === 201,
      `Term creation failed: ${termResponse.status} ${JSON.stringify(termResponse.payload)}`,
    );
    const term = termResponse.payload.data;
    const classroomResponse = await browserRequest(
      chrome.client,
      'POST',
      '/api/school-structure/classrooms',
      {
        schoolTermId: Number(term.id),
        gradeLevelId: grade.id,
        roomCode: String(ROOM_NUMBER),
        roomName: 'ห้อง Browser Smoke',
      },
    );
    assert(
      classroomResponse.status === 201,
      `Classroom creation failed: ${classroomResponse.status} ${JSON.stringify(classroomResponse.payload)}`,
    );
    const classroom = classroomResponse.payload.data;

    const teacherCsv = `username,startedOn\n${TEACHER_USERNAME},2026-07-01\n`;
    const teacherPreview = await browserCsvRequest(
      chrome.client,
      '/api/imports/teachers/preview',
      { schoolId: schoolA.id },
      teacherCsv,
    );
    assert(
      teacherPreview.status === 201 && teacherPreview.payload.rowsReady === 1,
      `Teacher preview failed: ${teacherPreview.status} ${JSON.stringify(teacherPreview.payload)}`,
    );
    const teacherImport = await browserCsvRequest(
      chrome.client,
      '/api/imports/teachers/bulk',
      { schoolId: schoolA.id },
      teacherCsv,
    );
    assert(
      teacherImport.status === 201 && teacherImport.payload.rowsInserted === 1,
      `Teacher import failed: ${teacherImport.status} ${JSON.stringify(teacherImport.payload)}`,
    );
    const teachersPageOne = await browserRequest(
      chrome.client,
      'GET',
      `/api/school-structure/teachers?schoolId=${schoolA.id}&page=1&limit=10&sortBy=name&sortDirection=asc`,
    );
    assert(
      teachersPageOne.status === 200 &&
        teachersPageOne.payload.data?.length === 10 &&
        teachersPageOne.payload.meta?.totalCount > 10 &&
        teachersPageOne.payload.meta?.totalPages > 1 &&
        teachersPageOne.payload.summary?.activeCount === teachersPageOne.payload.meta?.totalCount,
      `Teacher pagination metadata was incorrect: ${JSON.stringify(teachersPageOne.payload)}`,
    );
    const teachersPageTwo = await browserRequest(
      chrome.client,
      'GET',
      `/api/school-structure/teachers?schoolId=${schoolA.id}&page=2&limit=10&sortBy=name&sortDirection=asc`,
    );
    assert(
      teachersPageTwo.status === 200 && teachersPageTwo.payload.data?.length > 0,
      `Teacher pagination second page was empty: ${JSON.stringify(teachersPageTwo.payload)}`,
    );
    const teacherOptions = await browserRequest(
      chrome.client,
      'GET',
      `/api/school-structure/teachers/options?schoolId=${schoolA.id}&searchTerm=${encodeURIComponent(TEACHER_USERNAME)}`,
    );
    const membership = teacherOptions.payload.data?.find(
      (item) => item.username === TEACHER_USERNAME,
    );
    assert(membership, 'Imported teacher membership was not listed');
    assert(
      teacherOptions.payload.data?.some((item) => item.id === membership.id),
      'Active teacher membership was not available to assignment dropdowns',
    );
    const assignment = await browserRequest(
      chrome.client,
      'POST',
      '/api/school-structure/assignments',
      {
        classroomId: Number(classroom.id),
        teacherMembershipId: Number(membership.id),
        assignmentKind: 'HOMEROOM',
      },
    );
    assert(assignment.status === 201, 'Homeroom assignment failed');

    const studentCsv = `student_number,PersonID_Onec,FirstName_Onec,LastName_Onec,StudentStatusID_Onec,SchoolAdmissionYear_Onec\n${studentNumber},${studentIdentifier},นักเรียน,ทดสอบโครงสร้าง,${status.code},2566\n`;
    fs.writeFileSync(directImportCsvPath, studentCsv);
    const importFields = {
      target: 'student_term',
      mapping: '{}',
      schoolId: schoolA.id,
      schoolTermId: Number(term.id),
      classroomId: Number(classroom.id),
    };
    const outOfScopePreview = await browserCsvRequest(
      chrome.client,
      '/api/imports/preview',
      { ...importFields, schoolId: schoolB.id },
      studentCsv,
    );
    assert(
      outOfScopePreview.status >= 400 && outOfScopePreview.status < 500,
      `Out-of-scope import context was not rejected: ${outOfScopePreview.status}`,
    );
    const studentPreview = await browserCsvRequest(
      chrome.client,
      '/api/imports/preview',
      importFields,
      studentCsv,
    );
    assert(
      studentPreview.status === 201 && studentPreview.payload.rowsReady === 1,
      `Student preview failed: ${studentPreview.status} ${JSON.stringify(studentPreview.payload)}`,
    );
    const studentImport = await browserCsvRequest(
      chrome.client,
      '/api/imports/bulk',
      importFields,
      studentCsv,
    );
    assert(studentImport.status === 201 && studentImport.payload.rowsInserted === 1, 'Student import failed');

    const rosterResponse = await browserRequest(
      chrome.client,
      'GET',
      `/api/school-structure/roster?classroomId=${classroom.id}&page=1&limit=10&sortBy=name&sortDirection=asc`,
    );
    assert(
      rosterResponse.status === 200 &&
        rosterResponse.payload.data?.length === 1 &&
        rosterResponse.payload.data[0]?.studentNumber === studentNumber &&
        rosterResponse.payload.meta?.totalCount === 1,
      `Roster API did not return the imported student: ${rosterResponse.status} ${JSON.stringify(rosterResponse.payload)}`,
    );
    const importedStudent = rosterResponse.payload.data[0];
    const exportAuthorization = await browserRequest(
      chrome.client,
      'POST',
      `/api/school-structure/classrooms/${classroom.id}/export-events`,
      {
        exportScope: 'ROSTER',
        format: 'csv',
        columns: ['studentNumber', 'name'],
      },
    );
    assert(
      exportAuthorization.status === 201 && exportAuthorization.payload.data?.authorized === true,
      `Classroom export authorization failed: ${exportAuthorization.status} ${JSON.stringify(exportAuthorization.payload)}`,
    );
    const [exportAudit] = await dataSource.query(
      `SELECT action, metadata
       FROM audit_log
       WHERE actor_user_id = $1
         AND action = 'CLASSROOM_DATA_EXPORT'
         AND target_type = 'school_classrooms'
         AND target_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [actor.id, String(classroom.id)],
    );
    assert(
      exportAudit?.metadata?.exportScope === 'ROSTER' && exportAudit?.metadata?.format === 'csv',
      'Classroom export authorization was not audited',
    );
    const importedStudentName = [importedStudent.firstName, importedStudent.lastName]
      .filter(Boolean)
      .join(' ');
    assert(importedStudentName, 'Roster API returned the imported student without a display name');
    await dataSource.query(
      `INSERT INTO attendance (
         student_uuid, "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec",
         "AcademicYear_Onec", "Semester_Onec", "AttendanceDate", "Period",
         session_kind, "AttendanceStatus", "RecordedAt", "RecordedBy"
       ) VALUES ($1, $2, $3, $4, $5, 1, '2026-07-14', 1, 'DAILY', 1,
         '2026-07-14T08:12:08+07:00', $6)`,
      [
        importedStudent.studentUuid,
        schoolA.id,
        grade.id,
        ROOM_NUMBER,
        ACADEMIC_YEAR,
        DIRECTOR_USERNAME,
      ],
    );

    const classroomSummaryCases = [
      {
        label: 'all grades and classrooms',
        filters: `schoolId=${schoolA.id}&termId=${term.id}`,
      },
      {
        label: 'one grade and all classrooms',
        filters: `schoolId=${schoolA.id}&termId=${term.id}&gradeLevelId=${grade.id}`,
      },
      {
        label: 'one classroom',
        filters: `schoolId=${schoolA.id}&termId=${term.id}&gradeLevelId=${grade.id}&classroomId=${classroom.id}`,
      },
    ];
    for (const summaryCase of classroomSummaryCases) {
      const response = await browserRequest(
        chrome.client,
        'GET',
        `/api/school-structure/classrooms?${summaryCase.filters}&page=1&limit=10&sortBy=grade&sortDirection=asc`,
      );
      assert(
        response.status === 200 &&
          response.payload.summary?.classroomCount === 1 &&
          response.payload.summary?.teacherCount === 1 &&
          response.payload.summary?.studentCount === 1,
        `Filtered summary was incorrect for ${summaryCase.label}: ${JSON.stringify(response.payload)}`,
      );
      const filteredTeachers = await browserRequest(
        chrome.client,
        'GET',
        `/api/school-structure/teachers?${summaryCase.filters}&assignedToFilteredClassrooms=true&page=1&limit=10&sortBy=name&sortDirection=asc`,
      );
      const filteredRoster = await browserRequest(
        chrome.client,
        'GET',
        `/api/school-structure/roster?${summaryCase.filters}&page=1&limit=10&sortBy=name&sortDirection=asc`,
      );
      assert(
        filteredTeachers.status === 200 &&
          filteredTeachers.payload.meta?.totalCount === response.payload.summary.teacherCount,
        `Teacher table total did not match the card for ${summaryCase.label}`,
      );
      assert(
        filteredRoster.status === 200 &&
          filteredRoster.payload.meta?.totalCount === response.payload.summary.studentCount,
        `Roster table total did not match the card for ${summaryCase.label}`,
      );
    }

    // Direct-menu import must expose the same school → term → classroom
    // context cascade as the school-structure entry point.
    await navigate(chrome.client, `${FRONTEND_URL}/import-data?smoke=${Date.now()}`);
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('เลือกปลายทางสำหรับข้อมูลนำเข้า'),
      'Direct import page did not render its context picker',
    );
    await chooseCombobox(chrome.client, 'ค้นหาโรงเรียน', schoolA.name);
    await chooseCombobox(chrome.client, 'เลือกภาคเรียน', `ปี ${ACADEMIC_YEAR} / ภาค 1`);
    await chooseCombobox(chrome.client, 'เลือกชั้น', classroom.gradeLabel);
    await chooseCombobox(chrome.client, 'เลือกห้องเรียน', `ห้อง ${ROOM_NUMBER}`);
    const directImportContext = await evaluate(
      chrome.client,
      `({
        school: document.querySelector('[aria-label="ค้นหาโรงเรียน"]')?.value,
        term: document.querySelector('[aria-label="เลือกภาคเรียน"]')?.value,
        grade: document.querySelector('[aria-label="เลือกชั้น"]')?.value,
        classroom: document.querySelector('[aria-label="เลือกห้องเรียน"]')?.value
      })`,
    );
    assert(
      directImportContext.school === schoolA.name &&
        directImportContext.term === `ปี ${ACADEMIC_YEAR} / ภาค 1` &&
        directImportContext.grade === classroom.gradeLabel &&
        directImportContext.classroom === `ห้อง ${ROOM_NUMBER}`,
      `Direct import context did not settle: ${JSON.stringify(directImportContext)}`,
    );
    const fileInput = await chrome.client.call('Runtime.evaluate', {
      expression: 'document.querySelector(\'input[type="file"]\')',
      returnByValue: false,
    });
    assert(fileInput.result?.objectId, 'Direct import file input was not found');
    await chrome.client.call('DOM.setFileInputFiles', {
      objectId: fileInput.result.objectId,
      files: [directImportCsvPath],
    });
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes(path.basename(directImportCsvPath)),
      'Direct import did not render the selected file',
    );
    try {
      await waitFor(
        async () =>
          Boolean(
            await evaluate(
              chrome.client,
              `(() => {
                const button = Array.from(document.querySelectorAll('button'))
                  .find((item) => item.textContent.includes('ตรวจสอบไฟล์'));
                return button && !button.disabled;
              })()`,
            ),
          ),
        'Direct import preview button did not become enabled',
      );
    } catch (error) {
      const previewState = await evaluate(
        chrome.client,
        `(() => ({
          target: document.querySelector('#import-target')?.value,
          school: document.querySelector('[aria-label="ค้นหาโรงเรียน"]')?.value,
          term: document.querySelector('[aria-label="เลือกภาคเรียน"]')?.value,
          grade: document.querySelector('[aria-label="เลือกชั้น"]')?.value,
          classroom: document.querySelector('[aria-label="เลือกห้องเรียน"]')?.value,
          buttons: Array.from(document.querySelectorAll('button'))
            .filter((item) => item.textContent.includes('ตรวจสอบไฟล์'))
            .map((item) => ({ disabled: item.disabled, text: item.textContent.trim() }))
        }))()`,
      );
      throw new Error(`${error.message}; observed=${JSON.stringify(previewState)}`);
    }
    await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent.includes('ตรวจสอบไฟล์'))?.click()`,
    );
    try {
      await waitFor(
        async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('ผลตรวจสอบไฟล์'),
        'Direct import preview did not render',
      );
    } catch (error) {
      throw new Error(`${error.message}\nBody:\n${await evaluate(chrome.client, 'document.body.innerText')}`);
    }
    await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('button'))
        .filter((button) => button.textContent.includes('นำเข้าข้อมูล')).at(-1)?.click()`,
    );
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('ยืนยันการนำเข้าข้อมูล'),
      'Direct import confirmation did not open',
    );
    await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('button'))
        .filter((button) => button.textContent.includes('นำเข้าข้อมูล')).at(-1)?.click()`,
    );
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('นำเข้าข้อมูลสำเร็จ'),
      'Direct import did not complete',
    );

    await navigate(chrome.client, `${FRONTEND_URL}/school-structure?smoke=${Date.now()}`);
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('ห้อง Browser Smoke'),
      'Created classroom was not visible in the browser',
    );
    await changeNativeSelect(chrome.client, 'เลือกภาคเรียน', term.id);
    await waitFor(
      async () =>
        (await readSummaryMetric(chrome.client, 'ห้องในภาคเรียน')) === '1' &&
        (await readSummaryMetric(chrome.client, 'ครูในภาคเรียน')) === '1' &&
        (await readSummaryMetric(chrome.client, 'นักเรียนในภาคเรียน')) === '1',
      'All-grade/all-classroom summary did not match the selected term',
    );
    await chooseCombobox(chrome.client, 'กรองตามระดับชั้น', grade.label, grade.label);
    await waitFor(
      async () =>
        (await readSummaryMetric(chrome.client, 'ห้องในระดับชั้น')) === '1' &&
        (await readSummaryMetric(chrome.client, 'ครูในระดับชั้น')) === '1' &&
        (await readSummaryMetric(chrome.client, 'นักเรียนในระดับชั้น')) === '1',
      'All-classroom summary did not match the selected grade',
    );
    await chooseCombobox(
      chrome.client,
      'กรองตามห้องเรียน',
      `ห้อง ${ROOM_NUMBER}`,
      `ห้อง ${ROOM_NUMBER}`,
    );
    await waitFor(
      async () =>
        (await readSummaryMetric(chrome.client, 'ห้องที่เลือก')) === '1' &&
        (await readSummaryMetric(chrome.client, 'ครูในห้อง')) === '1' &&
        (await readSummaryMetric(chrome.client, 'นักเรียนในห้อง')) === '1',
      'Selected-classroom summary did not match the room filter',
    );
    assert(
      (await evaluate(
        chrome.client,
        `document.querySelector('[aria-label="เปิดแท็บห้องเรียน"]')?.getAttribute('aria-pressed')`,
      )) === 'true',
      'Classroom summary card did not reflect the active tab',
    );
    await evaluate(
      chrome.client,
      `document.querySelector('[aria-label="เปิดแท็บครู"]')?.click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(
          chrome.client,
          `document.querySelector('[aria-label="เปิดแท็บครู"]')?.getAttribute('aria-pressed')`,
        )) === 'true' &&
        (await evaluate(chrome.client, 'document.body.innerText')).includes('จาก 1 ครู'),
      'Teacher summary card did not open the matching tab and table',
    );
    const hasManualTeacherLinkButton = await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('button'))
        .some((button) => button.textContent.trim() === 'เชื่อมบัญชีครู')`,
    );
    assert(!hasManualTeacherLinkButton, 'Manual teacher-account linking button was still visible');
    await evaluate(
      chrome.client,
      `document.querySelector('[aria-label="เปิดแท็บนักเรียน"]')?.click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(
          chrome.client,
          `document.querySelector('[aria-label="เปิดแท็บนักเรียน"]')?.getAttribute('aria-pressed')`,
        )) === 'true' &&
        (await evaluate(chrome.client, 'document.body.innerText')).includes(importedStudentName),
      'Student summary card did not open the matching tab and roster',
    );
    const rosterUi = await evaluate(
      chrome.client,
      `({
        hasPagination: document.body.innerText.includes('จาก 1 นักเรียน'),
        sortableHeaders: Array.from(document.querySelectorAll('th button'))
          .map((button) => button.textContent.trim())
      })`,
    );
    assert(rosterUi.hasPagination, 'Roster pagination controls were not visible');
    assert(
      rosterUi.sortableHeaders.includes('ชื่อนักเรียน') &&
        rosterUi.sortableHeaders.includes('สถานะ'),
      `Roster sortable columns were not rendered: ${JSON.stringify(rosterUi.sortableHeaders)}`,
    );
    await evaluate(
      chrome.client,
      `document.querySelector('[aria-label="เปิดแท็บห้องเรียน"]')?.click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(
          chrome.client,
          `document.querySelector('[aria-label="เปิดแท็บห้องเรียน"]')?.getAttribute('aria-pressed')`,
        )) === 'true' &&
        (await evaluate(chrome.client, 'document.body.innerText')).includes('ห้อง Browser Smoke'),
      'Classroom summary card did not reopen the matching tab and table',
    );

    const pageTerms = await browserRequest(
      chrome.client,
      'GET',
      `/api/attendance/terms?schoolId=${schoolA.id}`,
    );
    const activePageTerm = pageTerms.payload.data?.find((item) => item.status === 'ACTIVE');
    assert(activePageTerm, 'All-classrooms smoke requires an active school term');
    const pageClassroomResponse = await browserRequest(
      chrome.client,
      'POST',
      '/api/school-structure/classrooms',
      {
        schoolTermId: Number(activePageTerm.id),
        gradeLevelId: grade.id,
        roomCode: String(ROOM_NUMBER),
        roomName: 'ห้อง All Classrooms Smoke',
      },
    );
    assert(
      pageClassroomResponse.status === 201,
      `Active-term classroom creation failed: ${JSON.stringify(pageClassroomResponse.payload)}`,
    );
    const pageClassroom = pageClassroomResponse.payload.data;
    const pageAssignment = await browserRequest(
      chrome.client,
      'POST',
      '/api/school-structure/assignments',
      {
        classroomId: Number(pageClassroom.id),
        teacherMembershipId: Number(membership.id),
        assignmentKind: 'HOMEROOM',
      },
    );
    assert(pageAssignment.status === 201, 'Active-term homeroom assignment failed');
    const classroomsPageProbe = await browserRequest(
      chrome.client,
      'GET',
      `/api/school-structure/classrooms?schoolId=${schoolA.id}&termId=${activePageTerm.id}&search=${encodeURIComponent(TEACHER_USERNAME)}&page=1&limit=20&sortBy=grade&sortDirection=asc`,
    );
    assert(
      classroomsPageProbe.status === 200 &&
        classroomsPageProbe.payload.data?.some((item) => item.id === pageClassroom.id),
      `All-classrooms API probe failed: ${classroomsPageProbe.status} ${JSON.stringify(classroomsPageProbe.payload)}`,
    );
    await chrome.client.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(chrome.client, `${FRONTEND_URL}/classrooms?smoke=${Date.now()}`);
    diagnostic('main:classrooms-page');
    const classroomLabel = `${pageClassroom.gradeLabel}/${ROOM_NUMBER}`;
    try {
      await waitFor(
        async () =>
          Boolean(
            await evaluate(
              chrome.client,
              `Boolean(document.querySelector('[data-classroom-card="${pageClassroom.id}"]'))`,
            ),
          ),
        'All-classrooms page did not render the scoped classroom card',
      );
    } catch (error) {
      const pageState = await evaluate(
        chrome.client,
        `({ url: location.href, text: document.body.innerText.slice(0, 1600) })`,
      );
      throw new Error(`${error.message}; observed=${JSON.stringify(pageState)}`);
    }
    assert(
      !(await evaluate(chrome.client, `Boolean(document.querySelector('[aria-label="กรองตามโรงเรียน"]'))`)),
      'Single-school actor should not see a school filter',
    );
    if (SCREENSHOT_PATH) {
      const screenshot = await chrome.client.call('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
      });
      fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
    }
    await evaluate(
      chrome.client,
      `(() => {
        const input = document.querySelector('input[placeholder="ค้นหา"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(TEACHER_USERNAME)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
    );
    await waitFor(
      async () =>
        (await evaluate(chrome.client, `document.querySelectorAll('[data-classroom-card]').length`)) === 1,
      'Classroom server search did not settle to the matching homeroom teacher',
    );
    await evaluate(
      chrome.client,
      `document.querySelector(${JSON.stringify(`[aria-label="ปักดาวห้อง ${classroomLabel}"]`)})?.click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(
          chrome.client,
          `document.querySelector(${JSON.stringify(`[aria-label="นำห้อง ${classroomLabel} ออกจากรายการโปรด"]`)})?.getAttribute('aria-pressed')`,
        )) === 'true',
      'Favorite action did not update and keep the classroom first',
    );
    const favoriteList = await browserRequest(
      chrome.client,
      'GET',
      `/api/school-structure/classrooms?schoolId=${schoolA.id}&termId=${activePageTerm.id}&search=${encodeURIComponent(TEACHER_USERNAME)}&page=1&limit=20&sortBy=grade&sortDirection=asc`,
    );
    assert(
      favoriteList.payload.data?.[0]?.id === pageClassroom.id &&
        favoriteList.payload.data?.[0]?.isFavorite === true,
      'Favorite-first API order was not applied',
    );

    await evaluate(
      chrome.client,
      `document.querySelector(${JSON.stringify(`[aria-label="ปรับแต่งการ์ดห้อง ${classroomLabel}"]`)})?.click()`,
    );
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('เลือกสี'),
      'Classroom color palette did not open',
    );
    await evaluate(chrome.client, `document.querySelector('[aria-label="เลือกสีเขียวสด"]')?.click()`);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            chrome.client,
            `document.querySelector('[data-classroom-card="${pageClassroom.id}"] > div')?.style.backgroundColor === 'rgb(60, 207, 145)'`,
          ),
        ),
      'Classroom cover color did not update',
    );

    await evaluate(
      chrome.client,
      `document.querySelector(${JSON.stringify(`[aria-label="ปรับแต่งการ์ดห้อง ${classroomLabel}"]`)})?.click()`,
    );
    await evaluate(
      chrome.client,
      `document.querySelector(${JSON.stringify(`[aria-label="เลือกรูปสำหรับห้อง ${classroomLabel}"]`)})?.click()`,
    );
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('จัดรูปปกห้อง'),
      'Classroom cover crop dialog did not open',
    );
    const coverInput = await chrome.client.call('Runtime.evaluate', {
      expression: 'document.querySelector(\'input[type="file"][accept^="image/"]\')',
      returnByValue: false,
    });
    assert(coverInput.result?.objectId, 'Classroom cover file input was not found');
    await chrome.client.call('DOM.setFileInputFiles', {
      objectId: coverInput.result.objectId,
      files: [classroomCoverPath],
    });
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('เปลี่ยนรูป'),
      'Classroom cover draft did not update the dialog preview',
    );
    const saveCoverClicked = await evaluate(
      chrome.client,
      `(() => {
        const zoom = Array.from(document.querySelectorAll('input[type="range"]')).at(-1);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(zoom, '2');
        zoom.dispatchEvent(new Event('input', { bubbles: true }));
        const save = Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('บันทึก'));
        save?.click();
        return Boolean(save);
      })()`,
    );
    assert(saveCoverClicked, 'Classroom cover save button was not found');
    try {
      await waitFor(
        async () =>
          !(await evaluate(chrome.client, 'document.body.innerText')).includes('จัดรูปปกห้อง') &&
          (await evaluate(chrome.client, `Boolean(document.querySelector('[data-classroom-card="${pageClassroom.id}"] img'))`)),
        'Confirmed classroom cover did not render on the card',
      );
    } catch (error) {
      const uploadState = await evaluate(
        chrome.client,
        `({ text: document.body.innerText.slice(-1200), resources: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/presentation')).map((entry) => ({ name: entry.name, status: entry.responseStatus })) })`,
      );
      throw new Error(`${error.message}; observed=${JSON.stringify(uploadState)}`);
    }

    await evaluate(
      chrome.client,
      `document.querySelector('[data-classroom-card="${pageClassroom.id}"]')?.click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(chrome.client, 'location.pathname')).startsWith('/classrooms/') &&
        (await evaluate(chrome.client, 'document.body.innerText')).includes('รายชื่อนักเรียน'),
      'Classroom card did not open the classroom detail page',
    );
    await navigate(chrome.client, `${FRONTEND_URL}/classrooms/${classroom.id}?smoke=${Date.now()}`);
    await waitFor(
      async () =>
        (await evaluate(chrome.client, 'document.body.innerText')).includes(studentNumber),
      `Classroom detail did not render student number ${studentNumber}`,
    );
    const openedStudentProfile = await evaluate(
      chrome.client,
      `(() => { const button = document.querySelector(${JSON.stringify(`[aria-label="เปิดข้อมูลนักเรียน ${importedStudentName}"]`)}); if (!button) return false; button.click(); return true; })()`,
    );
    assert(openedStudentProfile, 'Classroom student profile button was not available');
    await waitFor(
      async () => (await evaluate(chrome.client, 'location.pathname')).startsWith('/students/'),
      'Classroom student profile button did not navigate to the student profile',
    );
    await navigate(chrome.client, `${FRONTEND_URL}/classrooms/${classroom.id}?smoke=${Date.now()}`);
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes(studentNumber),
      'Classroom detail did not return after profile navigation',
    );
    const rosterSortHeaders = await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('th button')).map((button) => button.textContent.trim())`,
    );
    assert(
      ['รหัสประจำตัว', 'ชื่อ-นามสกุล', 'หมายเหตุ', 'สถานะนักเรียน'].every((label) =>
        rosterSortHeaders.some((header) => header.includes(label)),
      ),
      'Classroom roster sortable headers were incomplete',
    );
    await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('th button')).find((button) => button.textContent.includes('ชื่อ-นามสกุล'))?.click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(
          chrome.client,
          `Array.from(document.querySelectorAll('th')).some((header) => header.getAttribute('aria-sort') === 'descending' && header.textContent.includes('ชื่อ-นามสกุล'))`,
        )),
      'Classroom roster sort direction did not change',
    );
    const commentButtonLabel = `เพิ่มความคิดเห็นของ ${importedStudentName}`;
    const openedComment = await evaluate(
      chrome.client,
      `(() => { const button = document.querySelector(${JSON.stringify(`[aria-label="${commentButtonLabel}"]`)}); if (!button) return false; button.click(); return true; })()`,
    );
    assert(openedComment, 'Classroom student comment button was not available');
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('ความคิดเห็น'),
      'Classroom student comment dialog did not open',
    );
    const dialogActionStyles = await evaluate(
      chrome.client,
      `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const cancel = buttons.find((button) => button.textContent.trim() === 'ยกเลิก');
        const confirm = buttons.find((button) => button.textContent.includes('บันทึกข้อมูล'));
        if (!cancel || !confirm) return null;
        const cancelStyle = getComputedStyle(cancel);
        const confirmStyle = getComputedStyle(confirm);
        return {
          cancelBackground: cancelStyle.backgroundColor,
          cancelColor: cancelStyle.color,
          confirmBackground: confirmStyle.backgroundColor,
          confirmColor: confirmStyle.color,
        };
      })()`,
    );
    assert(
      dialogActionStyles?.cancelBackground === 'rgb(229, 229, 229)' &&
        dialogActionStyles?.cancelColor === 'rgb(17, 17, 17)',
      `Classroom dialog cancel action was not gray with black text: ${JSON.stringify(dialogActionStyles)}`,
    );
    assert(
      dialogActionStyles?.confirmBackground === 'rgb(15, 73, 189)' &&
        dialogActionStyles?.confirmColor === 'rgb(255, 255, 255)',
      `Classroom dialog confirm action was not blue with white text: ${JSON.stringify(dialogActionStyles)}`,
    );
    await evaluate(chrome.client, `document.querySelector('#classroom-student-comment')?.focus()`);
    await chrome.client.call('Input.insertText', { text: 'ติดตามจาก browser smoke' });
    const savedComment = await evaluate(
      chrome.client,
      `(() => { const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent.includes('บันทึกข้อมูล')); if (!button) return false; button.click(); return true; })()`,
    );
    assert(savedComment, 'Classroom student comment save button was not available');
    await waitFor(
      async () =>
        !(await evaluate(chrome.client, 'document.body.innerText')).includes('กำลังบันทึก') &&
        (await evaluate(chrome.client, 'document.body.innerText')).includes('ติดตามจาก browser smoke'),
      'Latest classroom student comment did not render in the note column',
    );
    const openedHistory = await evaluate(
      chrome.client,
      `(() => { const button = Array.from(document.querySelectorAll('[role="tab"]')).find((item) => item.textContent.includes('ประวัติการเช็คชื่อ')); if (!button) return false; button.click(); return true; })()`,
    );
    assert(openedHistory, 'Classroom attendance-history tab was not available');
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('14/07/2569'),
      'Daily classroom attendance summary did not render',
    );
    const dailySortHeaders = await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('th button')).map((button) => button.textContent.trim())`,
    );
    assert(
      ['วันที่', 'ผู้เช็คชื่อ', 'จำนวนที่มา (คน)', 'จำนวนที่ขาด (คน)'].every((label) =>
        dailySortHeaders.some((header) => header.includes(label)),
      ),
      'Daily attendance sortable headers were incomplete',
    );
    await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('th button')).find((button) => button.textContent.includes('วันที่'))?.click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(
          chrome.client,
          `Array.from(document.querySelectorAll('th')).some((header) => header.getAttribute('aria-sort') === 'ascending' && header.textContent.includes('วันที่'))`,
        )),
      'Daily attendance sort direction did not change',
    );
    const openedDailyDetail = await evaluate(
      chrome.client,
      `(() => { const button = document.querySelector('[aria-label="ดูรายละเอียดวันที่ 14/07/2569"]'); if (!button) return false; button.click(); return true; })()`,
    );
    assert(openedDailyDetail, 'Daily attendance drill-down button was not available');
    await waitFor(
      async () =>
        (await evaluate(chrome.client, 'document.body.innerText')).includes('ประวัติการเช็คชื่อรายวัน') &&
        (await evaluate(chrome.client, 'document.body.innerText')).includes(studentNumber) &&
        (await evaluate(chrome.client, `Boolean(document.querySelector('[aria-label="วันที่เช็คชื่อ"]'))`)) &&
        (await evaluate(chrome.client, `Array.from(document.querySelectorAll('th button')).some((button) => button.textContent.includes('สถานะการเข้าเรียน'))`)),
      'Daily attendance drill-down did not render the student, date picker, and sortable headers',
    );
    await evaluate(chrome.client, `document.querySelector('[aria-label="กลับไปหน้าสรุป"]')?.click()`);
    await waitFor(
      async () => await evaluate(chrome.client, `Boolean(document.querySelector('[aria-label="รูปแบบประวัติเช็คชื่อ"]'))`),
      'Attendance summary controls did not return after daily drill-down',
    );
    await changeNativeSelect(chrome.client, 'รูปแบบประวัติเช็คชื่อ', 'STUDENT');
    await waitFor(
      async () => await evaluate(chrome.client, `Boolean(document.querySelector(${JSON.stringify(`[aria-label="ดูประวัติของ ${importedStudentName}"]`)}))`),
      'Student attendance summary did not render',
    );
    await evaluate(
      chrome.client,
      `document.querySelector(${JSON.stringify(`[aria-label="ดูประวัติของ ${importedStudentName}"]`)})?.click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(chrome.client, 'document.body.innerText')).includes('ประวัติการเช็คชื่อรายคน') &&
        (await evaluate(chrome.client, `Boolean(document.querySelector('[aria-label="วันเริ่ม"]') && document.querySelector('[aria-label="วันจบ"]'))`)),
      'Student attendance drill-down or date range did not render',
    );
    if (SCREENSHOT_PATH) {
      const screenshot = await chrome.client.call('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const extension = path.extname(SCREENSHOT_PATH) || '.png';
      const detailPath = `${SCREENSHOT_PATH.slice(0, -extension.length)}-detail${extension}`;
      fs.writeFileSync(detailPath, Buffer.from(screenshot.data, 'base64'));
    }

    await chrome.client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(chrome.client, `${FRONTEND_URL}/classrooms?mobile=${Date.now()}`);
    await waitFor(
      async () =>
        (await evaluate(chrome.client, `Boolean(document.querySelector('[data-classroom-card]'))`)),
      'Classroom card did not render on mobile',
    );
    const mobileGeometry = await evaluate(
      chrome.client,
      `(() => {
        const card = document.querySelector('[data-classroom-card]')?.getBoundingClientRect();
        return { cardRight: card?.right ?? 0, viewport: document.documentElement.clientWidth,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      })()`,
    );
    assert(!mobileGeometry.overflow && mobileGeometry.cardRight <= mobileGeometry.viewport, 'Mobile classroom layout overflowed');
    await chrome.client.call('Emulation.clearDeviceMetricsOverride');

    const multiSession = await login(password, MULTI_DIRECTOR_USERNAME);
    await chrome.client.call('Network.setCookie', {
      name: multiSession.cookieName,
      value: multiSession.cookieValue,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    await evaluate(
      chrome.client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(multiSession.user))});`,
    );
    await navigate(chrome.client, `${FRONTEND_URL}/classrooms?multi=${Date.now()}`);
    await waitFor(
      async () => (await evaluate(chrome.client, `Boolean(document.querySelector('[aria-label="กรองตามโรงเรียน"]'))`)),
      'Multi-school actor did not receive the school filter',
    );
    await chooseCombobox(chrome.client, 'กรองตามโรงเรียน', schoolA.name, schoolA.name);
    await waitFor(
      async () => (await evaluate(chrome.client, `Boolean(document.querySelector('[data-classroom-card="${pageClassroom.id}"]'))`)),
      'Multi-school filter did not load the selected school classrooms',
    );
    await evaluate(
      chrome.client,
      `document.querySelector('button[aria-label^="เปิดเมนูบัญชีผู้ใช้:"]')?.click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(
          chrome.client,
          `Array.from(document.querySelectorAll('[role="menuitem"]')).some((item) => item.textContent.trim() === 'ออกจากระบบ')`,
        )),
      'Profile menu did not expose logout on the classrooms page',
    );
    const logoutClicked = await evaluate(
      chrome.client,
      `(() => {
        const logout = Array.from(document.querySelectorAll('[role="menuitem"]'))
          .find((item) => item.textContent.trim() === 'ออกจากระบบ');
        logout?.click();
        return Boolean(logout);
      })()`,
    );
    assert(logoutClicked, 'Classrooms logout action was not clickable');
    await waitFor(
      async () => (await evaluate(chrome.client, 'location.pathname')) === '/login',
      'Classrooms logout did not clear the session and navigate to login',
    );
    await chrome.client.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('เข้าสู่ระบบ STS'),
      'Login page did not render after classroom logout',
    );
    const loginGeometry = await evaluate(
      chrome.client,
      `(() => {
        const root = document.documentElement;
        const page = document.querySelector('main');
        const username = document.querySelector('#username');
        const passwordToggle = document.querySelector('button[aria-label="แสดงหรือซ่อนรหัสผ่าน"]');
        const passwordToggleIcon = passwordToggle?.querySelector('svg');
        const submit = document.querySelector('button[type="submit"]');
        const card = document.querySelector('main [class*="rounded-login-card"]');
        const rect = (element) => element ? element.getBoundingClientRect() : null;
        const style = (element) => element ? getComputedStyle(element) : null;
        return {
          hasGuestHeader: Boolean(document.querySelector('header')),
          heroColor: page ? getComputedStyle(page, '::before').backgroundColor : null,
          overflowY: Math.max(root.scrollHeight, document.body.scrollHeight) > window.innerHeight + 1,
          scrollHeight: Math.max(root.scrollHeight, document.body.scrollHeight),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          card: rect(card) ? { top: rect(card).top, bottom: rect(card).bottom, height: rect(card).height } : null,
          username: { height: rect(username)?.height ?? 0, fontSize: style(username)?.fontSize ?? null },
          passwordToggle: {
            size: rect(passwordToggle)?.width ?? 0,
            iconSize: rect(passwordToggleIcon)?.width ?? 0,
          },
          submit: { height: rect(submit)?.height ?? 0, fontSize: style(submit)?.fontSize ?? null },
        };
      })()`,
    );
    assert(!loginGeometry.hasGuestHeader, `Login page unexpectedly rendered the guest header: ${JSON.stringify(loginGeometry)}`);
    assert(loginGeometry.heroColor === 'rgb(231, 237, 248)', `Login hero color drifted: ${JSON.stringify(loginGeometry)}`);
    assert(!loginGeometry.overflowY, `Login page overflowed a 1440x900 viewport: ${JSON.stringify(loginGeometry)}`);
    assert(
      loginGeometry.username.height === 48 && loginGeometry.username.fontSize === '16px'
        && loginGeometry.passwordToggle.size === 40 && loginGeometry.passwordToggle.iconSize === 20
        && loginGeometry.submit.height === 48 && loginGeometry.submit.fontSize === '16px',
      `Login control scale drifted: ${JSON.stringify(loginGeometry)}`,
    );
    console.log('school structure browser smoke passed');
    diagnostic('main:passed');
  } finally {
    diagnostic('main:finally');
    if (actor && schoolA) {
      await cleanup(dataSource, actor.id, schoolA.id, studentIdentifier);
    }
    await dataSource.query(
      `UPDATE users SET status='DISABLED', deactivated_at=COALESCE(deactivated_at, now()),
         deactivation_reason_code=COALESCE(deactivation_reason_code, 'OTHER'),
         deactivation_note=COALESCE(deactivation_note, 'Retained automated smoke fixture')
       WHERE username=ANY($1::text[])`,
      [[DIRECTOR_USERNAME, MULTI_DIRECTOR_USERNAME, TEACHER_USERNAME]],
    );
    await closeChrome(chrome);
    fs.rmSync(directImportCsvPath, { force: true });
    fs.rmSync(classroomCoverPath, { force: true });
    await app.close();
  }
}

main().catch((error) => {
  diagnostic(`main:error:${error?.stack || String(error)}`);
  fs.writeSync(2, `${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
