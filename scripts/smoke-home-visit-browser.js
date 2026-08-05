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
  throw new Error('Refusing to run home visit browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5173';
const BROWSER_BACKEND_URL =
  process.env.SMOKE_BROWSER_BACKEND_URL || BACKEND_URL.replace('127.0.0.1', 'localhost');
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9235);
const CREATOR_USERNAME = 'home_visit_browser_creator';
const NO_CREATE_USERNAME = 'home_visit_browser_no_permission';
const ASSIGNEE_EMAIL = 'home.visit.browser@example.test';
const ASSIGNEE_NAME = 'Home Visit Browser Smoke';
const REASON_FLAGGED = 'Automated home visit browser smoke';

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
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  takeEvents(method) {
    const matched = [];
    const remaining = [];
    for (const event of this.events) {
      if (event.method === method) matched.push(event);
      else remaining.push(event);
    }
    this.events = remaining;
    return matched;
  }

  close() {
    this.socket.close();
  }
}

async function openChrome() {
  assert(fs.existsSync(CHROME_PATH), 'Google Chrome executable was not found');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-home-visit-chrome-'));
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

async function captureScreenshot(client, outputPath) {
  if (!outputPath) return;
  const screenshot = await client.call('Page.captureScreenshot', {
    captureBeyondViewport: true,
    format: 'png',
    fromSurface: true,
  });
  fs.writeFileSync(outputPath, Buffer.from(screenshot.data, 'base64'));
}

async function navigate(client, url, label = 'page') {
  try {
    await client.call('Page.navigate', { url });
  } catch (error) {
    throw new Error(`Could not navigate to ${label}: ${errorMessage(error)}`);
  }
  await waitFor(
    async () => (await evaluate(client, 'document.readyState')) === 'complete',
    `Page did not finish loading: ${url}`,
  );
}

async function setInputValue(client, selector, value) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) throw new Error('Input not found: ${selector}');
      input.focus();
      const prototype = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) {
        setter.call(input, ${JSON.stringify(value)});
      } else {
        input.value = ${JSON.stringify(value)};
      }
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
  await waitFor(
    async () =>
      (await evaluate(
        client,
        `document.querySelector(${JSON.stringify(selector)})?.value || ''`,
      )) === value,
    `Input value did not update: ${selector}`,
  );
}

async function click(client, expression, message) {
  try {
    await evaluate(
      client,
      `(() => {
        const target = ${expression};
        if (!target) throw new Error(${JSON.stringify(message)});
        target.click();
      })()`,
    );
  } catch (error) {
    throw new Error(`${message}: ${errorMessage(error)}`);
  }
}

async function clearBrowserSession(client) {
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

async function loginSession(client, user, sessionCookie) {
  await navigate(client, `${FRONTEND_URL}/login`, 'login');
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

async function fetchBrowserJson(client, url) {
  return await evaluate(
    client,
    `fetch(${JSON.stringify(url)}, { credentials: 'include' })
      .then(async (response) => ({
        ok: response.ok,
        status: response.status,
        body: await response.json().catch(() => null),
      }))`,
  );
}

function browserUser(row, username, permissions) {
  return {
    id: row.id,
    username,
    FirstName: 'Home Visit',
    LastName: 'Smoke',
    roles: ['ADMIN'],
    permissions,
    data_scope: { global: true },
    must_change_password: false,
  };
}

async function upsertUser(
  dataSource,
  { username, passwordHash, firstName, permissions },
) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = $3,
            "LastName" = 'Smoke',
            status = 'ACTIVE',
            permissions = $4::jsonb,
            role = 'ADMIN',
            data_scope = '{"global":true}'::jsonb,
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            affiliation = 'Automated home visit browser smoke',
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
        WHERE id = $1
      `,
      [existing.id, passwordHash, firstName, JSON.stringify(permissions)],
    );
    return existing;
  }

  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code, email, phone
      )
      VALUES ($1, $2, $3, 'Smoke', 'ACTIVE', $4::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'Automated home visit browser smoke',
        'AUTOMATED_TEST', NULL, NULL)
      RETURNING id
    `,
    [username, passwordHash, firstName, JSON.stringify(permissions)],
  );
  return row;
}

async function disableUsers(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          data_origin_code = 'AUTOMATED_TEST',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated home visit browser smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [[CREATOR_USERNAME, NO_CREATE_USERNAME]],
  );
}

async function cleanupSmokeTasks(dataSource) {
  const rows = await dataSource.query(
    `
      SELECT DISTINCT t.id AS task_id, t.case_id, tl.id AS link_id
      FROM tasks t
      JOIN task_links tl ON tl.task_id = t.id
      WHERE tl.assigned_to_email = $1
        OR tl.assigned_to_name = $2
    `,
    [ASSIGNEE_EMAIL, ASSIGNEE_NAME],
  );
  const taskIds = rows.map((row) => row.task_id).filter(Boolean);
  const linkIds = rows.map((row) => row.link_id).filter(Boolean);
  const orphanCaseRows = await dataSource.query(
    `SELECT id FROM cases WHERE reason_flagged = $1`,
    [REASON_FLAGGED],
  );
  const caseIds = [
    ...new Set([
      ...rows.map((row) => row.case_id).filter(Boolean),
      ...orphanCaseRows.map((row) => row.id).filter(Boolean),
    ]),
  ];
  if (linkIds.length) {
    await dataSource.query(`DELETE FROM task_submissions WHERE task_link_id = ANY($1::uuid[])`, [
      linkIds,
    ]);
  }
  if (taskIds.length) {
    await dataSource.query(`DELETE FROM task_links WHERE task_id = ANY($1::uuid[])`, [taskIds]);
    await dataSource.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [taskIds]);
  }
  if (caseIds.length) {
    await dataSource.query(`DELETE FROM notifications WHERE case_id = ANY($1::int[])`, [caseIds]);
    await dataSource.query(
      `
        UPDATE cases
        SET deleted_at = COALESCE(deleted_at, NOW()),
            status = 'RESOLVED',
            result_summary = COALESCE(result_summary, 'Automated home visit browser smoke cleanup')
        WHERE id = ANY($1::int[])
          AND reason_flagged = $2
      `,
      [caseIds, REASON_FLAGGED],
    );
  }
}

async function findStudentFixture(dataSource) {
  const [student] = await dataSource.query(
    `
      SELECT
        s.student_uuid,
        s.person_uuid,
        s."FirstName_Onec" AS first_name,
        s."LastName_Onec" AS last_name,
        sc.name AS school_name,
        sc.id AS school_id,
        s.address_house_no,
        s."VillageNumber_Onec" AS village_no,
        s."Street_Onec" AS street,
        s."ProvinceNameThai_Onec" AS province,
        s."DistrictNameThai_Onec" AS district,
        s."SubDistrictNameThai_Onec" AS sub_district,
        s."PostalCode_Onec" AS postal_code
      FROM student_term s
      JOIN schools sc ON sc.id = s."SchoolID_Onec"
      JOIN student_current_enrollment_resolution current_enrollment
        ON current_enrollment.person_uuid = s.person_uuid
       AND current_enrollment.selected_student_uuid = s.student_uuid
       AND current_enrollment.resolution_state = 'ACTIVE'
      WHERE NULLIF(TRIM(s."FirstName_Onec"), '') IS NOT NULL
        AND NULLIF(TRIM(s."LastName_Onec"), '') IS NOT NULL
        AND NULLIF(TRIM(s."ProvinceNameThai_Onec"), '') IS NOT NULL
        AND NULLIF(TRIM(s."DistrictNameThai_Onec"), '') IS NOT NULL
        AND NULLIF(TRIM(s."SubDistrictNameThai_Onec"), '') IS NOT NULL
      ORDER BY s.student_uuid
      LIMIT 1
    `,
  );
  assert(student, 'No active student with address fixture was available for home visit smoke');
  return student;
}

async function selectStudent(client, student) {
  const searchTerm = String(student.first_name).slice(0, 8);
  await setInputValue(client, 'input[placeholder="พิมพ์ชื่อนักเรียนเพื่อค้นหา"]', searchTerm);
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const expected = ${JSON.stringify(`${student.first_name} ${student.last_name}`)};
            return [...document.querySelectorAll('button')].some((button) => button.textContent.includes(expected));
          })()`,
        ),
      ),
    'Student picker did not show the selected roster fixture',
  );
  await click(
    client,
    `(() => {
      const expected = ${JSON.stringify(`${student.first_name} ${student.last_name}`)};
      return [...document.querySelectorAll('button')].find((button) => button.textContent.includes(expected));
    })()`,
    'Student picker result button was not found',
  );
  await waitFor(
    async () =>
      String(await evaluate(client, 'document.body.innerText')).includes(student.school_name) &&
      Boolean(await evaluate(client, `document.querySelector('#address_province')?.value`)),
    'Student selection did not prefill school and address fields',
  );
}

async function selectCombobox(client, selector, label) {
  await click(
    client,
    `document.querySelector(${JSON.stringify(selector)})`,
    `Combobox was not found: ${selector}`,
  );
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const label = ${JSON.stringify(label)};
            return [...document.querySelectorAll('button')].some(
              (button) => button.textContent.trim() === label
            );
          })()`,
        ),
      ),
    `Combobox option did not render: ${label}`,
  );
  await click(
    client,
    `(() => {
      const label = ${JSON.stringify(label)};
      return [...document.querySelectorAll('button')].find(
        (button) => button.textContent.trim() === label
      );
    })()`,
    `Combobox option was not found: ${label}`,
  );
}

async function selectHomeVisitException(client, label) {
  await click(
    client,
    `(() => {
      const label = ${JSON.stringify(label)};
      return [...document.querySelectorAll('label')].find(
        (candidate) => candidate.textContent.trim() === label
      )?.querySelector('input[type="radio"]');
    })()`,
    `Home visit exception option was not found: ${label}`,
  );
}

async function waitForMapSurface(client, message) {
  await waitFor(async () => {
    const text = String(await evaluate(client, 'document.body.innerText'));
    if (text.includes('ยังไม่ได้ตั้งค่า Google Maps')) {
      throw new Error('VITE_GOOGLE_MAPS_BROWSER_KEY is not configured for the running frontend');
    }
    if (text.includes('โหลดแผนที่ไม่สำเร็จ')) {
      throw new Error('Google Maps browser surface did not load');
    }
    return Boolean(
      await evaluate(
        client,
        `(() => {
          const surface = document.querySelector('[data-sts-map-surface]');
          return Boolean(surface?.__stsGoogleMap);
        })()`,
      ),
    );
  }, message, 35_000);
}

async function clickMap(client) {
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const surface = document.querySelector('[data-sts-map-surface]');
            const google = window.google;
            const map = surface?.__stsGoogleMap;
            if (!surface || !google || !map) return false;
            const next = new google.maps.LatLng(13.7563, 100.5018);
            google.maps.event.trigger(map, 'click', { latLng: next });
            return true;
          })()`,
        ),
      ),
    'Home visit map was not available for click smoke',
    35_000,
  );
}

async function getCreatedLink(dataSource) {
  const [row] = await dataSource.query(
    `
      SELECT
        tl.id AS link_id,
        tl.otp_verified,
        t.id AS task_id,
        c.id AS case_id,
        c.student_lat,
        c.student_lng,
        tl.assigned_to_first_name,
        tl.assigned_to_last_name
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      JOIN cases c ON c.id = t.case_id
      WHERE tl.assigned_to_email = $1
        AND tl.assigned_to_name = $2
      ORDER BY tl.created_at DESC
      LIMIT 1
    `,
    [ASSIGNEE_EMAIL, ASSIGNEE_NAME],
  );
  assert(row, 'Created home visit task link was not persisted');
  assert(row.student_lat !== null && row.student_lng !== null, 'Created case did not persist coordinates');
  assert(
    row.assigned_to_first_name === 'Home Visit' &&
      row.assigned_to_last_name === 'Browser Smoke',
    'Created task link did not persist structured assignee names',
  );
  return row;
}

async function assertSubmittedReport(dataSource, createdLink) {
  const [row] = await dataSource.query(
    `
      SELECT
        t.status AS task_status,
        tl.status AS link_status,
        c.status AS case_status,
        submission.visited_at,
        submission.home_visit_exception_code,
        submission.cause_category,
        submission.follow_up_assessment_code,
        submission.cause_detail,
        submission.case_follow_up_decision
      FROM tasks t
      JOIN task_links tl ON tl.task_id = t.id
      JOIN cases c ON c.id = t.case_id
      JOIN task_submissions submission ON submission.task_link_id = tl.id
      WHERE t.id = $1
        AND tl.id = $2
      ORDER BY submission.submitted_at DESC
      LIMIT 1
    `,
    [createdLink.task_id, createdLink.link_id],
  );
  assert(row, 'Home visit report submission was not persisted');
  assert(row.task_status === 'COMPLETED', `Expected task COMPLETED, received ${row.task_status}`);
  assert(row.link_status === 'COMPLETED', `Expected link COMPLETED, received ${row.link_status}`);
  assert(
    row.case_status === 'PENDING_REVIEW',
    `Expected case PENDING_REVIEW, received ${row.case_status}`,
  );
  assert(row.visited_at, 'Home visit report did not persist visited_at');
  assert(
    row.home_visit_exception_code === 'STUDENT_NOT_FOUND',
    `Expected STUDENT_NOT_FOUND, received ${row.home_visit_exception_code}`,
  );
  assert(
    row.follow_up_assessment_code === 'CONTINUE_FOLLOW_UP',
    `Expected CONTINUE_FOLLOW_UP assessment, received ${row.follow_up_assessment_code}`,
  );
  assert(
    row.case_follow_up_decision === 'REQUEST_REVIEW',
    `Expected REQUEST_REVIEW, received ${row.case_follow_up_decision}`,
  );

  // One submission must not tell a single person about it twice, even though it
  // raises both a case-status and a task-submitted notification type.
  const duplicateRecipients = await dataSource.query(
    `
      SELECT recipient_user_id, COUNT(*)::int AS notification_count
      FROM notifications
      WHERE (case_id = (SELECT case_id FROM tasks WHERE id = $1) OR ref_id = $1::text)
        AND type_code IN ('CASE_STATUS_CHANGED', 'TASK_SUBMITTED')
      GROUP BY recipient_user_id
      HAVING COUNT(*) > 1
    `,
    [createdLink.task_id],
  );
  assert(
    duplicateRecipients.length === 0,
    `One submission produced duplicate notifications for ${duplicateRecipients.length} recipient(s)`,
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
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let chrome;

  try {
    await cleanupSmokeTasks(dataSource);
    const student = await findStudentFixture(dataSource);
    const creator = await upsertUser(dataSource, {
      username: CREATOR_USERNAME,
      passwordHash: await passwordService.hash(`HomeVisitCreator-${suffix}-Password`),
      firstName: 'Home Visit Creator',
      permissions: ['home', 'create', 'students'],
    });
    const noCreate = await upsertUser(dataSource, {
      username: NO_CREATE_USERNAME,
      passwordHash: await passwordService.hash(`HomeVisitNoCreate-${suffix}-Password`),
      firstName: 'Home Visit No Create',
      permissions: ['home'],
    });

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

    await loginSession(
      client,
      browserUser(noCreate, NO_CREATE_USERNAME, ['home']),
      createSessionCookie(sessionCookieService, noCreate.id),
    );
    const forbiddenGeocode = await fetchBrowserJson(
      client,
      `${BROWSER_BACKEND_URL}/api/geo/geocode?address=${encodeURIComponent('กรุงเทพมหานคร')}`,
    );
    assert(
      forbiddenGeocode.status === 403,
      `No-create actor geocode expected 403, received ${forbiddenGeocode.status}`,
    );
    await clearBrowserSession(client);

    await loginSession(
      client,
      browserUser(creator, CREATOR_USERNAME, ['home', 'create', 'students']),
      createSessionCookie(sessionCookieService, creator.id),
    );
    await navigate(client, `${FRONTEND_URL}/create/visit`, 'create visit');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('รายละเอียด') &&
        Boolean(
          await evaluate(client, `Boolean(document.querySelector('#assigned_to_first_name'))`),
        ) &&
        Boolean(
          await evaluate(client, `Boolean(document.querySelector('#assigned_to_last_name'))`),
        ) &&
        Boolean(
          await evaluate(client, `Boolean(document.querySelector('#assignment-start-time'))`),
        ) &&
        Boolean(await evaluate(client, `Boolean(document.querySelector('#assignment-end-time'))`)),
      'Create visit page did not render',
    );

    await setInputValue(client, '#assigned_to_first_name', 'Home Visit');
    await setInputValue(client, '#assigned_to_last_name', 'Browser Smoke');
    await setInputValue(client, '#assigned_to_email', ASSIGNEE_EMAIL);
    await selectStudent(client, student);
    await setInputValue(client, '#reason_flagged', REASON_FLAGGED);

    const allowedGeocode = await fetchBrowserJson(
      client,
      `${BROWSER_BACKEND_URL}/api/geo/geocode?address=${encodeURIComponent('ดอนเมือง กรุงเทพมหานคร 10210')}`,
    );
    assert(allowedGeocode.status === 200, 'Create actor could not call /api/geo/geocode');
    assert(allowedGeocode.body?.lat && allowedGeocode.body?.lng, 'Allowed geocode did not return coordinates');

    await waitForMapSurface(client, 'Home visit map surface did not render on create form');
    const mapUxText = String(await evaluate(client, 'document.body.innerText'));
    assert(
      mapUxText.includes('ผลค้นหาเป็นตำแหน่งโดยประมาณ — ลากหมุดปรับให้ตรงจุดจริง'),
      'Create-visit map did not render the approximate geocode hint',
    );
    assert(
      !mapUxText.includes('ค้นหาพิกัดจากที่อยู่'),
      'Create-visit map still rendered the legacy geocode button',
    );
    assert(
      mapUxText.includes('ใช้ที่อยู่ที่กรอกไว้'),
      'Create-visit map did not render the filled-address shortcut',
    );
    await clickMap(client);
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `document.querySelector('#address_latitude')?.value && document.querySelector('#address_longitude')?.value`,
          ),
        ),
      'Clicking the home visit map did not update coordinate inputs',
    );
    await click(
      client,
      `document.querySelector('button[type="submit"]')`,
      'Create visit submit button was not found',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('สร้างลิงก์สำเร็จ'),
      'Create visit success state did not render',
    );
    const guestLink = await evaluate(
      client,
      `document.querySelector('a[aria-label="เปิดลิงก์"]')?.href || null`,
    );
    assert(
      typeof guestLink === 'string' && guestLink.startsWith(FRONTEND_URL),
      'Create visit result did not expose a same-origin guest link',
    );

    const createdLink = await getCreatedLink(dataSource);
    await dataSource.query(`UPDATE task_links SET otp_verified = 1 WHERE id = $1`, [
      createdLink.link_id,
    ]);
    await navigate(client, guestLink, 'guest visit');
    await waitFor(
      async () => {
        const pageText = String(await evaluate(client, 'document.body.innerText'));
        const ready =
          pageText.includes(REASON_FLAGGED) &&
          pageText.includes('ขั้นตอนการติดตาม') &&
          Boolean(await evaluate(client, `Boolean(document.querySelector('#visited-time'))`));
        if (!ready) {
          throw new Error(`Current guest page: ${pageText.slice(0, 500)}`);
        }
        return true;
      },
      'Guest link did not open the report form with persisted visit details',
    );
    await click(
      client,
      `document.querySelector('button[aria-label="ดูเบอร์ติดต่อนักเรียนและผู้ปกครอง"]')`,
      'Contact dialog button was not found',
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'ช่องทางติดต่อนักเรียนและผู้ปกครอง',
        ),
      'Contact dialog did not open',
    );
    await click(
      client,
      `document.querySelector('[role="dialog"] button[aria-label="Close dialog"]')`,
      'Contact dialog close button was not found',
    );
    await click(
      client,
      `document.querySelector('button[aria-label="ดูพิกัดบ้านนักเรียน"]')`,
      'Student-home map dialog button was not found',
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('พิกัดบ้านนักเรียน'),
      'Student-home map dialog did not open',
    );
    await click(
      client,
      `document.querySelector('[role="dialog"] button[aria-label="Close dialog"]')`,
      'Student-home map dialog close button was not found',
    );
    await captureScreenshot(client, process.env.SMOKE_SCREENSHOT_PATH);
    const reportAlignment = await evaluate(
      client,
      `(() => {
        const detail = document.querySelector('#cause-detail')?.getBoundingClientRect();
        const upload = document.querySelector('[data-visit-upload-dropzone]')?.getBoundingClientRect();
        const exceptions = document.querySelector('[data-home-visit-exceptions]')?.getBoundingClientRect();
        if (!detail || !upload || !exceptions) return null;
        return {
          topDelta: Math.abs(
            document.querySelector('#visited-date')?.getBoundingClientRect().top - upload.top
          ),
          bottomDelta: Math.abs(detail.bottom - upload.bottom),
          exceptionsClearBoth: exceptions.top > Math.max(detail.bottom, upload.bottom),
          trackingStepTop: document.querySelector('[data-flow-step="2"]')?.getBoundingClientRect().top,
        };
      })()`,
    );
    assert(reportAlignment, 'Report alignment elements were not rendered');
    assert(
      reportAlignment.topDelta <= 1,
      `Report visit-date/upload tops differ by ${reportAlignment.topDelta}px`,
    );
    assert(
      reportAlignment.bottomDelta <= 1,
      `Report description/upload bottoms differ by ${reportAlignment.bottomDelta}px`,
    );
    assert(
      reportAlignment.exceptionsClearBoth,
      'Home-visit exceptions overlap the report fields',
    );
    const publicLocations = await fetchBrowserJson(
      client,
      `${BROWSER_BACKEND_URL}/api/public/locations`,
    );
    assert(
      publicLocations.status === 200 && publicLocations.body?.data?.provinces?.length > 0,
      'Guest report could not load the public cascading location catalog',
    );
    const guardedLocations = await fetchBrowserJson(
      client,
      `${BROWSER_BACKEND_URL}/api/attendance/locations`,
    );
    assert(
      guardedLocations.status === 404,
      `Attendance module still exposes an ungated locations route (${guardedLocations.status})`,
    );

    await navigate(client, `${guestLink}/delegate`, 'delegate visit');
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `[
              '#delegate-first-name',
              '#delegate-last-name',
              '#delegate-phone',
              '#delegate-email',
              '#delegate-note',
              '#delegate-expiry-date',
              '#delegate-expiry-time'
            ].every((selector) => Boolean(document.querySelector(selector)))`,
          ),
        ),
      'Delegation form did not render structured assignee and expiry fields',
    );
    await click(
      client,
      `([...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'ย้อนกลับ'))`,
      'Delegation back button was not found',
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('#visited-time')) &&
             document.body.innerText.includes('ขั้นตอนการติดตาม')`,
          ),
        ),
      'Delegation back button did not return to the report form',
    );

    await selectHomeVisitException(client, 'เปลี่ยนที่อยู่');
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean(document.querySelector('#updated-address-province'))`,
          ),
        ) &&
        String(await evaluate(client, 'document.body.innerText')).includes('ที่อยู่ใหม่') &&
        String(await evaluate(client, 'document.body.innerText')).includes('พิกัดที่อยู่ใหม่') &&
        Boolean(
          await evaluate(
            client,
            `document.querySelector('#updated-address-province')?.disabled === false`,
          ),
        ),
      'Address-changed option did not reveal the structured address form',
    );
    const expandedTrackingStepTop = await evaluate(
      client,
      `document.querySelector('[data-flow-step="2"]')?.getBoundingClientRect().top`,
    );
    assert(
      Math.abs(expandedTrackingStepTop - reportAlignment.trackingStepTop) <= 1,
      'Tracking step moved when the address-changed form expanded',
    );
    await captureScreenshot(client, process.env.SMOKE_ADDRESS_SCREENSHOT_PATH);
    await click(
      client,
      `document.querySelector('#updated-address-province')`,
      'Updated province combobox was not found',
    );
    await waitFor(
      async () =>
        Number(
          await evaluate(
            client,
            `document.querySelector('#updated-address-province')?.parentElement?.querySelectorAll('li button').length || 0`,
          ),
        ) > 0,
      'Updated province combobox did not render catalog options',
    );
    await selectHomeVisitException(client, 'ไม่พบนักเรียน');
    await waitFor(
      async () =>
        !(await evaluate(client, `Boolean(document.querySelector('#updated-address-province'))`)),
      'Switching to student-not-found did not hide the updated address form',
    );
    await selectCombobox(client, '#follow-up-assessment', 'ควรติดตามต่อ');
    await click(
      client,
      `document.querySelector('button[type="submit"]')`,
      'Report submit button was not found',
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'กรุณาระบุรายละเอียดเมื่อไม่พบนักเรียน',
        ),
      'Student-not-found did not require a report detail',
    );

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await navigate(client, guestLink, 'mobile guest visit');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('ขั้นตอนการติดตาม') &&
        Boolean(await evaluate(client, `Boolean(document.querySelector('#visited-time'))`)),
      'Mobile guest home visit report did not render',
    );
    await selectHomeVisitException(client, 'ไม่พบนักเรียน');
    await selectCombobox(client, '#follow-up-assessment', 'ควรติดตามต่อ');
    await setInputValue(
      client,
      '#cause-detail',
      'ตรวจสอบบริเวณบ้านและสอบถามเพื่อนบ้านแล้ว ไม่พบนักเรียน',
    );
    await click(
      client,
      `document.querySelector('button[type="submit"]')`,
      'Mobile report submit button was not found',
    );
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        // Receipt keeps the submitted form's heading (term + student + class),
        // proving the context survived the redirect, plus the sent confirmation.
        return (
          text.includes('แบบฟอร์มการติดตามนักเรียน') &&
          text.includes('ส่งผลการติดตามเพื่อรอผู้รับผิดชอบตรวจสอบแล้ว')
        );
      },
      'Home visit success state did not render after report submission',
    );
    await captureScreenshot(client, process.env.SMOKE_SUCCESS_SCREENSHOT_PATH);
    await assertSubmittedReport(dataSource, createdLink);

    console.log(
      'home visit browser smoke passed (assignee names, assignment times, dialogs, delegation form, aligned report, assessment, changed-address map, mobile submit, pending review)',
    );
  } finally {
    await closeChrome(chrome);
    try {
      await cleanupSmokeTasks(dataSource);
      await disableUsers(dataSource);
    } finally {
      await app.close();
    }
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
