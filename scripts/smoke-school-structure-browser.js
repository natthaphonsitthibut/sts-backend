const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
const TEACHER_USERNAME = 'school_structure_browser_teacher';
const ACADEMIC_YEAR = 2999;
const ROOM_NUMBER = 991;

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

async function login(password) {
  const response = await fetch(`${BACKEND_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: DIRECTOR_USERNAME, password }),
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

async function chooseCombobox(client, ariaLabel, optionLabel) {
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
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  let chrome;
  let actor;
  let schoolA;
  const studentIdentifier = `98${String(Date.now()).slice(-11)}`;
  const directImportCsvPath = path.join(
    os.tmpdir(),
    `sts-direct-import-${studentIdentifier}.csv`,
  );
  try {
    const schools = await dataSource.query(
      `SELECT id, name FROM schools WHERE school_status='ACTIVE' ORDER BY id LIMIT 2`,
    );
    assert(schools.length === 2, 'Smoke requires two active schools');
    [schoolA] = schools;
    const schoolB = schools[1];
    const grade = (
      await dataSource.query(`SELECT id FROM grade_levels ORDER BY id LIMIT 1`)
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
      permissions: ['home', 'manage-school-structure', 'import-data', 'import-school-roster'],
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
    await cleanup(dataSource, actor.id, schoolA.id);
    const [identifierCollision] = await dataSource.query(
      `SELECT 1 FROM student_person_identifier
       WHERE identifier_type='NATIONAL_ID' AND identifier_normalized=$1`,
      [studentIdentifier],
    );
    assert(!identifierCollision, 'Generated student identifier unexpectedly already exists');
    const session = await login(password);

    chrome = await openChrome();
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
    const initialText = await evaluate(chrome.client, 'document.body.innerText');
    assert(initialText.includes(schoolA.name), 'Scoped school A was not visible');
    assert(!initialText.includes(schoolB.name), 'School B leaked into scoped browser page');

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
        legacyRoomNumber: ROOM_NUMBER,
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
    const teachers = await browserRequest(
      chrome.client,
      'GET',
      `/api/school-structure/teachers?schoolId=${schoolA.id}`,
    );
    const membership = teachers.payload.data.find((item) => item.username === TEACHER_USERNAME);
    assert(membership, 'Imported teacher membership was not listed');
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

    const studentCsv = `PersonID_Onec,FirstName_Onec,LastName_Onec,StudentStatusID_Onec\n${studentIdentifier},นักเรียน,ทดสอบโครงสร้าง,${status.code}\n`;
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
      `/api/school-structure/roster?classroomId=${classroom.id}`,
    );
    assert(
      rosterResponse.status === 200 && rosterResponse.payload.data?.length === 1,
      `Roster API did not return the imported student: ${rosterResponse.status} ${JSON.stringify(rosterResponse.payload)}`,
    );
    const importedStudent = rosterResponse.payload.data[0];
    const importedStudentName = [importedStudent.firstName, importedStudent.lastName]
      .filter(Boolean)
      .join(' ');
    assert(importedStudentName, 'Roster API returned the imported student without a display name');

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
    await chooseCombobox(chrome.client, 'เลือกห้องเรียน', String(ROOM_NUMBER));
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
        directImportContext.classroom === String(ROOM_NUMBER),
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
    await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent.trim() === 'ตรวจสอบไฟล์')?.click()`,
    );
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('ผลตรวจสอบไฟล์'),
      'Direct import preview did not render',
    );
    await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('button'))
        .filter((button) => button.textContent.trim() === 'นำเข้าข้อมูล').at(-1)?.click()`,
    );
    await waitFor(
      async () => (await evaluate(chrome.client, 'document.body.innerText')).includes('ยืนยันการนำเข้าข้อมูล'),
      'Direct import confirmation did not open',
    );
    await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('button'))
        .filter((button) => button.textContent.trim() === 'นำเข้าข้อมูล').at(-1)?.click()`,
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
    await evaluate(
      chrome.client,
      `Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === 'รายชื่อนักเรียน')?.click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(chrome.client, 'document.body.innerText')).includes(importedStudentName),
      'Imported student was not visible in classroom roster',
    );
    console.log('school structure browser smoke passed');
  } finally {
    if (actor && schoolA) {
      await cleanup(dataSource, actor.id, schoolA.id, studentIdentifier);
    }
    await dataSource.query(
      `UPDATE users SET status='DISABLED', deactivated_at=COALESCE(deactivated_at, now()),
         deactivation_reason_code=COALESCE(deactivation_reason_code, 'OTHER'),
         deactivation_note=COALESCE(deactivation_note, 'Retained automated smoke fixture')
       WHERE username=ANY($1::text[])`,
      [[DIRECTOR_USERNAME, TEACHER_USERNAME]],
    );
    await closeChrome(chrome);
    fs.rmSync(directImportCsvPath, { force: true });
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
