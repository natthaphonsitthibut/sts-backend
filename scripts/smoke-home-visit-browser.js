const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { TaskRepository } = require('../dist/task/task.repository');
const { FILE_STORAGE_ADAPTER } = require('../dist/files/storage/file-storage.types');

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
const REASON_FLAGGED = 'Automated home visit browser smoke';
const SMTP_CAPTURE_PORT = Number(process.env.SMOKE_SMTP_PORT || 2526);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorMessage(error) {
  if (error instanceof AggregateError) {
    return error.errors.map((cause) => cause?.message || String(cause)).join(' | ');
  }
  return error?.message || String(error);
}

async function startSmtpCapture() {
  const messages = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let dataLines = null;
    let loginStep = 0;
    socket.setEncoding('utf8');
    socket.write('220 localhost STS smoke SMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const lineEnd = buffer.indexOf('\r\n');
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);

        if (dataLines) {
          if (line === '.') {
            messages.push(dataLines.join('\r\n'));
            dataLines = null;
            socket.write('250 2.0.0 accepted\r\n');
          } else {
            dataLines.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }

        if (loginStep === 1) {
          loginStep = 2;
          socket.write('334 UGFzc3dvcmQ6\r\n');
          continue;
        }
        if (loginStep === 2) {
          loginStep = 0;
          socket.write('235 2.7.0 authenticated\r\n');
          continue;
        }

        const command = line.toUpperCase();
        if (command.startsWith('EHLO') || command.startsWith('HELO')) {
          socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
        } else if (command.startsWith('AUTH PLAIN')) {
          socket.write('235 2.7.0 authenticated\r\n');
        } else if (command === 'AUTH LOGIN') {
          loginStep = 1;
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (command.startsWith('MAIL FROM:') || command.startsWith('RCPT TO:')) {
          socket.write('250 2.1.0 ok\r\n');
        } else if (command === 'DATA') {
          dataLines = [];
          socket.write('354 end with <CRLF>.<CRLF>\r\n');
        } else if (command === 'RSET' || command === 'NOOP') {
          socket.write('250 2.0.0 ok\r\n');
        } else if (command === 'QUIT') {
          socket.end('221 2.0.0 bye\r\n');
        } else {
          socket.write('250 2.0.0 ok\r\n');
        }
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(SMTP_CAPTURE_PORT, '127.0.0.1', resolve);
  });

  return {
    messages,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
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

async function postBrowserJson(client, url, body) {
  return await evaluate(
    client,
    `fetch(${JSON.stringify(url)}, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: ${JSON.stringify(JSON.stringify(body))}
    }).then(async (response) => ({
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

async function cleanupSmokeTasks(dataSource, storage) {
  const rows = await dataSource.query(
    `
      SELECT DISTINCT t.id AS task_id, t.case_id, tl.id AS link_id
      FROM tasks t
      JOIN task_links tl ON tl.task_id = t.id
      JOIN cases c ON c.id = t.case_id
      WHERE c.reason_flagged = $1
    `,
    [REASON_FLAGGED],
  );
  const taskIds = rows.map((row) => row.task_id).filter(Boolean);
  const linkIds = rows.map((row) => row.link_id).filter(Boolean);
  if (linkIds.length && storage) {
    const attachmentRows = await dataSource.query(
      `SELECT photo_paths FROM task_submissions WHERE task_link_id = ANY($1::uuid[])`,
      [linkIds],
    );
    for (const row of attachmentRows) {
      const paths = Array.isArray(row.photo_paths)
        ? row.photo_paths
        : typeof row.photo_paths === 'string'
          ? JSON.parse(row.photo_paths)
          : [];
      for (const storedPath of paths) {
        if (typeof storedPath === 'string' && storedPath.startsWith('/uploads/visit-attachments/')) {
          await storage.delete(storedPath.slice('/uploads/'.length));
        }
      }
    }
  }
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
            completion_outcome_code = COALESCE(completion_outcome_code, 'CLOSED'),
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
        AND NOT EXISTS (
          SELECT 1
          FROM cases active_case
          WHERE active_case.student_uuid = s.student_uuid
            AND active_case.deleted_at IS NULL
            AND active_case.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
        )
        AND EXISTS (
          SELECT 1
          FROM school_teacher_memberships membership
          JOIN teachers teacher
            ON teacher.id = membership.teacher_id
           AND teacher.teacher_status = 'ACTIVE'
           AND teacher.deleted_at IS NULL
          JOIN users teacher_user
            ON teacher_user.id = membership.teacher_user_id
           AND teacher_user.status = 'ACTIVE'
          WHERE membership.school_id = s."SchoolID_Onec"
            AND membership.membership_status = 'ACTIVE'
            AND membership.deleted_at IS NULL
        )
      ORDER BY s.student_uuid
      LIMIT 1
    `,
  );
  assert(student, 'No active student with address fixture was available for home visit smoke');
  return student;
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

async function toggleMultiSelectOption(client, selector, label) {
  const listboxSelector = `${selector}-listbox`;
  await click(client, `document.querySelector(${JSON.stringify(selector)})`, `Multi select was not found: ${selector}`);
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `(() => {
            const label = ${JSON.stringify(label)};
            return [...document.querySelectorAll(${JSON.stringify(`${listboxSelector} li button`)})].some(
              (button) => button.textContent.trim() === label
            );
          })()`,
        ),
      ),
    `Multi select option did not render: ${label}`,
  );
  await click(
    client,
    `(() => {
      const label = ${JSON.stringify(label)};
      return [...document.querySelectorAll(${JSON.stringify(`${listboxSelector} li button`)})].find(
        (button) => button.textContent.trim() === label
      );
    })()`,
    `Multi select option was not found: ${label}`,
  );
}

/**
 * Fonts inside controls that only exist while open — the calendar, the hour and
 * minute pickers, the assessment list and the chip dropdown. These are exactly
 * the places a component could ship its own stack unnoticed, so each one is
 * opened, scanned and closed again.
 */
async function assertOpenControlFonts(client) {
  const controls = [
    ['button[aria-label="วันที่ลงพื้นที่"]', '[role="dialog"][aria-label="เลือกวันที่"]', 'ปฏิทิน'],
    ['button[aria-label="เวลาที่ลงพื้นที่"]', '[role="dialog"][aria-label="เลือกเวลา"]', 'ตัวเลือกเวลา'],
    ['#follow-up-assessment', '#follow-up-assessment ~ ul, #follow-up-assessment-listbox', 'ผลการติดตาม'],
    ['#residence-environment', '#residence-environment-listbox', 'สภาพแวดล้อม'],
  ];

  for (const [trigger, scope, label] of controls) {
    // The first click can be swallowed by whatever popover is still open, so the
    // trigger is pressed again when nothing appeared.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await click(client, `document.querySelector(${JSON.stringify(trigger)})`, `${label} trigger was not found`);
      const opened = await evaluate(
        client,
        `Boolean(document.querySelector(${JSON.stringify(scope)}))`,
      );
      if (opened) break;
    }
    await waitFor(
      async () => Boolean(await evaluate(client, `Boolean(document.querySelector(${JSON.stringify(scope)}))`)),
      `${label} did not open for the font sweep`,
    );
    const offenders = await evaluate(
      client,
      `(() => {
        const root = document.querySelector(${JSON.stringify(scope)});
        if (!root) return ['missing'];
        const found = new Set();
        [root, ...root.querySelectorAll('*')].forEach((node) => {
          const family = getComputedStyle(node).fontFamily || '';
          if (!family.includes('TH Sarabun PSK')) {
            found.add(node.tagName.toLowerCase() + ' :: ' + family);
          }
        });
        return [...found].slice(0, 5);
      })()`,
    );
    assert(
      Array.isArray(offenders) && offenders.length === 0,
      `${label} renders in another font: ${(offenders || []).join(' | ')}`,
    );
    await evaluate(
      client,
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    );
    await evaluate(client, `document.querySelector('h1')?.click()`);
  }
}

function multiSelectChipsExpression(selector) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return '';
    return [...input.parentElement.querySelectorAll('span')]
      .map((chip) => chip.firstChild?.textContent?.trim() || '')
      .filter(Boolean)
      .join('|');
  })()`;
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

async function setAssignmentEnd(client) {
  const tomorrowParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
    })
      .formatToParts(new Date(Date.now() + 24 * 60 * 60 * 1000))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const todayMonth = new Intl.DateTimeFormat('en-CA', {
    month: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date());

  await click(
    client,
    `document.querySelector('button[aria-label="วันที่สิ้นสุดมอบหมาย"]')`,
    'Assignment end-date picker was not found',
  );
  if (tomorrowParts.month !== todayMonth) {
    await click(
      client,
      `document.querySelector('[role="dialog"][aria-label="เลือกวันที่"] button[aria-label="ถัดไป"]')`,
      'Assignment end-date next-month button was not found',
    );
  }
  await click(
    client,
    `(() => [...document.querySelectorAll('[role="dialog"][aria-label="เลือกวันที่"] button')]
      .find((button) => button.textContent.trim() === ${JSON.stringify(String(Number(tomorrowParts.day)))}))()`,
    'Tomorrow was not selectable in the assignment end-date picker',
  );

  await click(
    client,
    `document.querySelector('button[aria-label="เวลาสิ้นสุดมอบหมาย"]')`,
    'Assignment end-time picker was not found',
  );
  await evaluate(
    client,
    `(() => {
      const select = document.querySelector('[role="dialog"][aria-label="เลือกเวลา"] select[aria-label="ชั่วโมง"]');
      if (!select) throw new Error('Assignment end hour select was not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, '23');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `document.querySelector('[role="dialog"][aria-label="เลือกเวลา"] select[aria-label="ชั่วโมง"]')?.value === '23'`,
        ),
      ),
    'Assignment end hour did not update',
  );
  await evaluate(
    client,
    `(() => {
      const select = document.querySelector('[role="dialog"][aria-label="เลือกเวลา"] select[aria-label="นาที"]');
      if (!select) throw new Error('Assignment end minute select was not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, '59');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
  await click(
    client,
    `(() => [...document.querySelectorAll('[role="dialog"][aria-label="เลือกเวลา"] button')]
      .find((button) => button.textContent.trim() === 'เสร็จสิ้น'))()`,
    'Assignment end-time done button was not found',
  );
}

async function selectFirstVisitAssignee(client) {
  const hasDefault = await evaluate(
    client,
    `Boolean(document.querySelector('input[aria-label="ครูผู้ได้รับมอบหมาย"]')?.value)`,
  );
  if (hasDefault) return;
  await click(
    client,
    `document.querySelector('input[aria-label="ครูผู้ได้รับมอบหมาย"]')`,
    'Visit assignee combobox was not found',
  );
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `Boolean(document.querySelector('input[aria-label="ครูผู้ได้รับมอบหมาย"]')?.parentElement?.querySelector('ul li button'))`,
        ),
      ),
    'Visit assignee options did not load',
  );
  await click(
    client,
    `document.querySelector('input[aria-label="ครูผู้ได้รับมอบหมาย"]')?.parentElement?.querySelector('ul li button')`,
    'No active teacher was available for visit assignment',
  );
}

async function attachVisitEvidence(client) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('input[type="file"]');
      if (!input) throw new Error('Visit attachment input was not found');
      const transfer = new DataTransfer();
      transfer.items.add(new File(['not allowed'], 'unsafe.txt', { type: 'text/plain' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
  await waitFor(
    async () => (await evaluate(client, 'document.body.innerText')).includes('รองรับเฉพาะไฟล์'),
    'Visit attachment type validation did not render',
  );
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('input[type="file"]');
      if (!input) throw new Error('Visit attachment input was not found');
      const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'visit-proof.png', { type: 'image/png' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
  await waitFor(
    async () => (await evaluate(client, 'document.body.innerText')).includes('visit-proof.png'),
    'Valid visit evidence did not appear in the attachment list',
  );
}

async function getCreatedLink(dataSource, taskRepository, caseId, expectedNote) {
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
        tl.assigned_to_last_name,
        tl.assigned_to_name,
        tl.assigned_to_email,
        tl.assignment_note,
        tl.opens_at,
        tl.expires_at
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      JOIN cases c ON c.id = t.case_id
      WHERE c.id = $1
        AND t.task_type = 'VISIT'
        AND t.deleted_at IS NULL
        AND tl.deleted_at IS NULL
      ORDER BY tl.created_at DESC
      LIMIT 1
    `,
    [caseId],
  );
  assert(row, 'Created home visit task link was not persisted');
  assert(row.assigned_to_name, 'Created task link did not persist the selected teacher');
  assert(row.assignment_note === expectedNote, 'Assignment note was not persisted');
  assert(new Date(row.expires_at) > new Date(row.opens_at), 'Assignment window was not persisted in order');
  const detail = await taskRepository.findLinkDetailById(row.link_id);
  assert(detail?.magic_link, 'Created task link could not be reconstructed');
  return { ...row, magic_link: detail.magic_link };
}

async function verifyGuestOtp(client, createdLink, guestLink) {
  const smtpCapture = await startSmtpCapture();
  try {
    await navigate(client, guestLink, 'guest OTP gate');
    // The gate now offers AraID or email; this smoke covers the email path.
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean([...document.querySelectorAll('button')]
              .find((button) => button.textContent.trim().startsWith('อีเมล')))`,
          ),
        ),
      'Guest task did not render the identity method choice',
    );
    await click(
      client,
      `(() => [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim().startsWith('อีเมล')))()`,
      'Email verification choice was not found',
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean([...document.querySelectorAll('button')]
              .find((button) => button.textContent.includes('รับรหัส OTP')))`,
          ),
        ),
      'Guest task did not render the OTP gate; start the backend with the smoke SMTP settings',
    );
    await click(
      client,
      `(() => [...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes('รับรหัส OTP')))()`,
      'Guest OTP request button was not found',
    );

    await waitFor(() => smtpCapture.messages.length === 1, 'Guest OTP email was not delivered');
    const deliveredCodes = [
      ...new Set(smtpCapture.messages[0].match(/\b\d{6}\b/g) || []),
    ];
    assert(deliveredCodes.length === 1, 'Guest OTP email did not contain one six-digit challenge');
    const [otpCode] = deliveredCodes;

    const gateText = String(await evaluate(client, 'document.body.innerText'));
    assert(gateText.includes('ระบบส่งรหัสไปที่'), 'Guest OTP gate did not show the masked recipient');
    assert(
      !gateText.includes(createdLink.assigned_to_email) && !gateText.includes(otpCode),
      'Guest OTP gate exposed a full recipient address or OTP code',
    );

    for (let index = 0; index < otpCode.length; index += 1) {
      await evaluate(
        client,
        `document.querySelector('[aria-label="รหัส OTP หลักที่ ${index + 1}"]')?.focus()`,
      );
      await client.call('Input.insertText', { text: otpCode[index] });
    }
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean([...document.querySelectorAll('button')]
              .find((button) => button.textContent.includes('ตรวจสอบรหัส') && !button.disabled))`,
          ),
        ),
      'Guest OTP verify button did not become enabled',
    );
    await click(
      client,
      `(() => [...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes('ตรวจสอบรหัส')))()`,
      'Guest OTP verify button was not found',
    );
  } finally {
    await smtpCapture.close();
  }
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
        submission.parental_status_code,
        submission.guardian_type_code,
        submission.guardian_type_detail,
        submission.residence_environment_detail,
        (
          SELECT string_agg(env.residence_environment_code, ',' ORDER BY env.residence_environment_code)
          FROM task_submission_residence_environments env
          WHERE env.task_submission_id = submission.id
        ) AS residence_environment_codes,
        submission.cause_detail,
        submission.case_follow_up_decision,
        submission.photo_paths
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
  assert(row.home_visit_exception_code === null, 'Normal visit unexpectedly stored an exception');
  assert(
    row.follow_up_assessment_code === 'CONTINUE_FOLLOW_UP',
    `Expected CONTINUE_FOLLOW_UP assessment, received ${row.follow_up_assessment_code}`,
  );
  assert(
    row.case_follow_up_decision === 'REQUEST_REVIEW',
    `Expected REQUEST_REVIEW, received ${row.case_follow_up_decision}`,
  );
  assert(
    row.parental_status_code === 'DIVORCED',
    `Expected DIVORCED parental status, received ${row.parental_status_code}`,
  );
  assert(
    row.guardian_type_code === 'OTHER' && row.guardian_type_detail === 'พี่ชายของบิดา',
    `Guardian answer was not persisted: ${row.guardian_type_code} / ${row.guardian_type_detail}`,
  );
  assert(
    row.residence_environment_codes === 'AREA_CRIME,NEAR_DRUG_AREA',
    `Expected both observed environments, received ${row.residence_environment_codes}`,
  );
  assert(
    row.residence_environment_detail === 'มีบ้านร้างท้ายซอยและมีคนแปลกหน้าเข้าออก',
    'Residence environment detail was not persisted',
  );
  const photoPaths = Array.isArray(row.photo_paths)
    ? row.photo_paths
    : typeof row.photo_paths === 'string'
      ? JSON.parse(row.photo_paths)
      : [];
  assert(
    photoPaths.length === 1 && photoPaths[0].startsWith('/uploads/visit-attachments/'),
    'Uploaded visit evidence was not persisted in private attachment storage',
  );

  // A case can legitimately emit one notification per workflow transition.
  // What must never happen is duplicate delivery of the same status event to
  // the same recipient.
  const duplicateRecipients = await dataSource.query(
    `
      SELECT recipient_user_id, COUNT(*)::int AS notification_count
      FROM notifications
      WHERE (case_id = (SELECT case_id FROM tasks WHERE id = $1) OR ref_id = $1::text)
        AND type_code = 'CASE_STATUS_CHANGED'
      GROUP BY recipient_user_id, case_status_code
      HAVING COUNT(*) > 1
    `,
    [createdLink.task_id],
  );
  assert(
    duplicateRecipients.length === 0,
    `One status transition produced duplicate notifications for ${duplicateRecipients.length} recipient/status pair(s)`,
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
  const taskRepository = app.get(TaskRepository);
  const storage = app.get(FILE_STORAGE_ADAPTER);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let chrome;

  try {
    await cleanupSmokeTasks(dataSource, storage);
    const student = await findStudentFixture(dataSource);
    const creator = await upsertUser(dataSource, {
      username: CREATOR_USERNAME,
      passwordHash: await passwordService.hash(`HomeVisitCreator-${suffix}-Password`),
      firstName: 'Home Visit Creator',
      permissions: ['home', 'create', 'review-cases', 'close-case', 'manage-student-observations'],
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
      browserUser(creator, CREATOR_USERNAME, [
        'home',
        'create',
        'review-cases',
        'close-case',
        'manage-student-observations',
      ]),
      createSessionCookie(sessionCookieService, creator.id),
    );
    const openCaseResult = await postBrowserJson(client, `${BROWSER_BACKEND_URL}/api/cases`, {
      student_id: student.student_uuid,
      reason: REASON_FLAGGED,
    });
    assert(openCaseResult.status === 200, `Open case expected 200, received ${openCaseResult.status}`);
    assert(openCaseResult.body?.created === true, 'Home visit smoke did not create a fresh OPEN case');
    const caseId = Number(openCaseResult.body?.data?.id);
    assert(Number.isInteger(caseId), 'Open case response did not return a case id');
    const visitAssigneesResult = await fetchBrowserJson(
      client,
      `${BROWSER_BACKEND_URL}/api/tasks/visit-assignees/${encodeURIComponent(student.student_uuid)}`,
    );
    assert(
      visitAssigneesResult.status === 200 && visitAssigneesResult.body?.data?.length > 0,
      `Visit assignee API returned status=${visitAssigneesResult.status} count=${visitAssigneesResult.body?.data?.length ?? 0}`,
    );

    await navigate(client, `${FRONTEND_URL}/cases/${caseId}`, 'open case assignment');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('รอมอบหมาย') &&
        Boolean(await evaluate(client, `Boolean(document.querySelector('button[aria-label="วันที่เริ่มมอบหมาย"]'))`)) &&
        Boolean(await evaluate(client, `Boolean(document.querySelector('button[aria-label="วันที่สิ้นสุดมอบหมาย"]'))`)),
      'OPEN case assignment form did not render',
    );

    await click(
      client,
      `(() => [...document.querySelectorAll('button')]
        .find((button) => button.offsetParent !== null && button.textContent.includes('มอบหมาย')))()`,
      'Assignment submit button was not found',
    );
    // The end time opens on the current time like the start time, so the date
    // is the only part of the end window still missing at this point.
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(
          'กรุณาระบุ วันที่สิ้นสุด',
        ) &&
        Boolean(
          await evaluate(
            client,
            `/^\\d{2}:\\d{2}$/.test(document.querySelector('button[aria-label="เวลาสิ้นสุดมอบหมาย"]')?.textContent?.trim() || '')`,
          ),
        ),
      'Assignment form did not validate the missing end date with a prefilled end time',
    );
    await setAssignmentEnd(client);
    await selectFirstVisitAssignee(client);
    await setInputValue(
      client,
      'textarea[placeholder="คำอธิบาย"]',
      'ตรวจสอบการมาเรียนและพูดคุยกับผู้ปกครอง',
    );
    await click(
      client,
      `(() => [...document.querySelectorAll('button')]
        .find((button) => button.offsetParent !== null && button.textContent.includes('มอบหมาย')))()`,
      'Assignment submit button was not found after completing the form',
    );
    await waitFor(
      async () => (await evaluate(client, 'document.body.innerText')).includes('ยืนยันการมอบหมาย'),
      'Assignment confirmation dialog did not render',
    );
    await click(
      client,
      `(() => [...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent.trim() === 'ยืนยัน'))()`,
      'Assignment confirmation button was not found',
    );
    await waitFor(
      async () => {
        const [row] = await dataSource.query(
          `SELECT status FROM cases WHERE id = $1`,
          [caseId],
        );
        return row?.status === 'IN_PROGRESS';
      },
      'Assignment did not persist the IN_PROGRESS case state',
    );
    const assignmentDetailResult = await fetchBrowserJson(
      client,
      `${BROWSER_BACKEND_URL}/api/cases/${caseId}`,
    );
    const latestAssignment = assignmentDetailResult.body?.data?.follow_up_rounds?.at(-1);
    assert(latestAssignment, 'Assigned case detail did not return a follow-up round');
    assert(
      new Date(latestAssignment.assignment_ends_at).getTime() > Date.now(),
      `Assigned case returned an expired end time: ${latestAssignment.assignment_ends_at}`,
    );
    assert(
      latestAssignment.assignment_note === 'ตรวจสอบการมาเรียนและพูดคุยกับผู้ปกครอง',
      `Assigned case returned an incorrect note: ${latestAssignment.assignment_note}`,
    );
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        const savedNoteVisible = await evaluate(
          client,
          `([...document.querySelectorAll('textarea:disabled')]
            .some((textarea) => textarea.value === 'ตรวจสอบการมาเรียนและพูดคุยกับผู้ปกครอง'))`,
        );
        if (!text.includes('รอติดตาม') || !savedNoteVisible) {
          throw new Error(`Current case page: ${text.slice(0, 1400)}`);
        }
        return true;
      },
      'Assigned case did not enter IN_PROGRESS with its saved assignment note',
    );

    const createdLink = await getCreatedLink(
      dataSource,
      taskRepository,
      caseId,
      'ตรวจสอบการมาเรียนและพูดคุยกับผู้ปกครอง',
    );
    const guestPath = new URL(createdLink.magic_link, FRONTEND_URL).pathname;
    const guestLink = `${FRONTEND_URL}${guestPath}`;
    await verifyGuestOtp(client, createdLink, guestLink);
    await waitFor(
      async () => {
        const pageText = String(await evaluate(client, 'document.body.innerText'));
        const ready =
          pageText.includes(REASON_FLAGGED) &&
          pageText.includes('ขั้นตอนการติดตาม') &&
          Boolean(await evaluate(client, `Boolean(document.querySelector('#visited-time'))`));
        if (!ready) {
          throw new Error(
            `Guest link=${guestLink} pathname=${await evaluate(client, 'location.pathname')} page=${pageText.slice(0, 500)}`,
          );
        }
        return true;
      },
      'Guest link did not open the report form with persisted visit details',
    );
    assert(
      String(await evaluate(client, 'document.body.innerText')).includes('รอติดตาม : ติดตาม'),
      'Follow-up link did not show the same composed status and phase as the case',
    );
    // Autosave: what the visitor typed must survive leaving and reopening the
    // link, otherwise a dropped connection loses the whole report.
    await setInputValue(client, '#cause-detail', 'ร่างเยี่ยมบ้านที่ยังไม่ได้ส่ง');
    await waitFor(
      async () =>
        await evaluate(
          client,
          `new Promise((resolve) => {
            const open = indexedDB.open('sts-visit-report-drafts', 1);
            open.onsuccess = () => {
              const tx = open.result.transaction('drafts', 'readonly');
              const all = tx.objectStore('drafts').getAll();
              all.onsuccess = () => resolve(all.result.some((row) =>
                row.formValues && row.formValues.causeDetail === 'ร่างเยี่ยมบ้านที่ยังไม่ได้ส่ง'));
              all.onerror = () => resolve(false);
            };
            open.onerror = () => resolve(false);
          })`,
        ),
      'the home visit report draft was never written',
    );
    await navigate(client, `${FRONTEND_URL}/`, 'draft round trip');
    await navigate(client, guestLink, 'guest link after draft round trip');
    await waitFor(
      async () =>
        (await evaluate(client, `(document.querySelector('#cause-detail') || {}).value`)) ===
        'ร่างเยี่ยมบ้านที่ยังไม่ได้ส่ง',
      'the home visit report draft was not restored after reopening the link',
    );
    // Clear it again so the later validation steps see an empty detail field.
    await setInputValue(client, '#cause-detail', '');

    await click(
      client,
      `document.querySelector('button[aria-label="ดูเบอร์ติดต่อนักเรียน"]')`,
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

    // A multi-row selection is the case that used to break the layout: the chip
    // box grew and dragged the right column out of step with the left one.
    await toggleMultiSelectOption(client, '#residence-environment', 'อยู่ใกล้แหล่งสารเสพติด');
    await toggleMultiSelectOption(client, '#residence-environment', 'อยู่ใกล้แหล่งมั่วสุม');
    await toggleMultiSelectOption(client, '#residence-environment', 'มีความเสี่ยงด้านความรุนแรง');
    await toggleMultiSelectOption(client, '#residence-environment', 'มีปัญหาอาชญากรรมในพื้นที่');
    await evaluate(client, `document.body.click()`);
    // Narrower desktop: the columns have to shrink here, so a field that refuses
    // to go below its content width would push the page into sideways scroll.
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await captureScreenshot(client, process.env.SMOKE_LAYOUT_SCREENSHOT_PATH);

    const reportAlignment = await evaluate(
      client,
      `(() => {
        const detailBox = document.querySelector('[data-visit-report-fields]');
        const uploadBox = document.querySelector('[data-visit-report-context]');
        const detail = detailBox?.getBoundingClientRect();
        const upload = uploadBox?.getBoundingClientRect();
        const exceptions = document.querySelector('[data-home-visit-exceptions]')?.getBoundingClientRect();
        if (!detail || !upload || !exceptions) return null;
        const overflowing = [detailBox, uploadBox].flatMap((column) => {
          const bounds = column.getBoundingClientRect();
          return [...column.children]
            .filter((child) => child.getBoundingClientRect().right > bounds.right + 1)
            .map((child) => child.className);
        });
        return {
          topDelta: Math.abs(detail.top - upload.top),
          bottomDelta: Math.abs(detail.bottom - upload.bottom),
          widthDelta: Math.abs(detail.width - upload.width),
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          chipBoxHeight: Math.round(
            document.querySelector('#residence-environment')?.parentElement?.getBoundingClientRect()
              .height ?? 0,
          ),
          timeFieldHeight: Math.round(
            document.querySelector('#visited-time')?.getBoundingClientRect().height ?? 0,
          ),
          // Every control has to render in the app's own face; a component that
          // sets its own stack (chips, badges, pickers) would stand out.
          foreignFonts: (() => {
            const offenders = new Set();
            document.querySelectorAll('form *').forEach((node) => {
              const family = getComputedStyle(node).fontFamily || '';
              if (!family.includes('TH Sarabun PSK')) {
                offenders.add(node.tagName.toLowerCase() + ' :: ' + family);
              }
            });
            return [...offenders].slice(0, 5);
          })(),
          probe: (() => {
            const box = (selector) => {
              const rect = document.querySelector(selector)?.getBoundingClientRect();
              return rect ? [Math.round(rect.top), Math.round(rect.bottom)] : null;
            };
            return {
              parentalLabel: box('label[for="parental-status"]'),
              parentalInput: box('#parental-status'),
              envLabel: box('label[for="residence-environment-detail"]'),
              envArea: box('#residence-environment-detail'),
              guardianInput: box('#guardian-type'),
            };
          })(),
          envTopVsParental: Math.round(
            (document.querySelector('#residence-environment-detail')?.getBoundingClientRect().top ?? 0) -
              (document.querySelector('#parental-status')?.getBoundingClientRect().top ?? 0),
          ),
          envBottomVsGuardian: Math.round(
            (document.querySelector('#residence-environment-detail')?.getBoundingClientRect().bottom ?? 0) -
              (document.querySelector('#guardian-type')?.getBoundingClientRect().bottom ?? 0),
          ),
          dividerGaps: (() => {
            const rule = [...document.querySelectorAll('form div')].find(
              (node) => node.className.includes('bg-slate-200') && node.className.includes('h-px'),
            );
            const guardian = document.querySelector('#guardian-type')?.getBoundingClientRect();
            const assessment = document
              .querySelector('label[for="follow-up-assessment"]')
              ?.getBoundingClientRect();
            if (!rule || !guardian || !assessment) return null;
            const line = rule.getBoundingClientRect();
            return {
              above: Math.round(line.top - guardian.bottom),
              below: Math.round(assessment.top - line.bottom),
            };
          })(),
          overflowing,
          exceptionsClearBoth: exceptions.top > Math.max(detail.bottom, upload.bottom),
          trackingStepTop: document.querySelector('[data-flow-step="2"]')?.getBoundingClientRect().top,
        };
      })()`,
    );
    assert(
      reportAlignment && reportAlignment.foreignFonts.length === 0,
      `A report control renders in another font: ${reportAlignment?.foreignFonts.join(' | ')}`,
    );
    await assertOpenControlFonts(client);
    assert(
      reportAlignment && reportAlignment.envTopVsParental === 0,
      `Environment detail starts ${reportAlignment?.envTopVsParental}px off the parental status field`,
    );
    assert(
      reportAlignment && reportAlignment.envBottomVsGuardian === 0,
      `Environment detail ends ${reportAlignment?.envBottomVsGuardian}px off the guardian field`,
    );
    // The owner nudged the rule a couple of pixels below dead centre: the
    // reserved error line above it reads as empty space, so a mathematically
    // centred rule looks high. Keep it near the middle, not exactly on it.
    assert(
      reportAlignment?.dividerGaps &&
        Math.abs(reportAlignment.dividerGaps.above - reportAlignment.dividerGaps.below) <= 6,
      `The rule is far from the middle of the two blocks (${JSON.stringify(reportAlignment?.dividerGaps)})`,
    );
    assert(
      reportAlignment && reportAlignment.widthDelta <= 1,
      `Report columns are not the same width (${reportAlignment?.widthDelta}px apart)`,
    );
    assert(
      reportAlignment && reportAlignment.overflowing.length === 0,
      `A report field overflows its column: ${reportAlignment?.overflowing.join(' | ')}`,
    );
    assert(
      reportAlignment && reportAlignment.pageOverflow <= 1,
      `Report form scrolls sideways at 1280px (${reportAlignment?.pageOverflow}px wider than the viewport)`,
    );
    // Four picked factors must not make the field taller than the time picker
    // beside it — that is what used to knock the column spacing out of rhythm.
    assert(
      reportAlignment && reportAlignment.chipBoxHeight === reportAlignment.timeFieldHeight,
      `Environment picker is ${reportAlignment?.chipBoxHeight}px tall against ${reportAlignment?.timeFieldHeight}px for the time field`,
    );
    assert(reportAlignment, 'Report alignment elements were not rendered');
    assert(
      reportAlignment.topDelta <= 1,
      `Report field/upload columns differ at the top by ${reportAlignment.topDelta}px`,
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
    await selectCombobox(client, '#follow-up-assessment', 'ควรติดตามต่อ');
    await setInputValue(
      client,
      '#cause-detail',
      'เยี่ยมบ้านและพูดคุยกับผู้ปกครองแล้ว เห็นควรติดตามต่อ',
    );

    // Household context: the guardian note stays locked until "อื่น ๆ", and the
    // exclusive environment answer must clear any risk factor picked with it.
    await selectCombobox(client, '#parental-status', 'หย่าร้าง');
    assert(
      Boolean(await evaluate(client, `document.querySelector('#guardian-type-detail')?.disabled`)),
      'Guardian detail was editable before choosing อื่น ๆ',
    );
    await selectCombobox(client, '#guardian-type', 'อื่น ๆ (ระบุในช่อง)');
    await waitFor(
      async () =>
        !(await evaluate(client, `document.querySelector('#guardian-type-detail')?.disabled`)),
      'Guardian detail stayed locked after choosing อื่น ๆ',
    );
    await setInputValue(client, '#guardian-type-detail', 'พี่ชายของบิดา');
    await toggleMultiSelectOption(client, '#residence-environment', 'ปกติ / ไม่มีปัจจัยเสี่ยง');
    await toggleMultiSelectOption(client, '#residence-environment', 'อยู่ใกล้แหล่งสารเสพติด');
    await toggleMultiSelectOption(client, '#residence-environment', 'มีปัญหาอาชญากรรมในพื้นที่');
    await waitFor(
      async () =>
        (await evaluate(client, multiSelectChipsExpression('#residence-environment'))) ===
        'อยู่ใกล้แหล่งสารเสพติด|มีปัญหาอาชญากรรมในพื้นที่',
      'Exclusive environment option was not cleared by the risk factors',
    );
    await setInputValue(
      client,
      '#residence-environment-detail',
      'มีบ้านร้างท้ายซอยและมีคนแปลกหน้าเข้าออก',
    );
    await attachVisitEvidence(client);
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

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(client, `${FRONTEND_URL}/cases/${caseId}`, 'pending-review case');
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return text.includes('รอพิจารณา') &&
          Boolean(await evaluate(client, `Boolean(document.querySelector('img[alt="ไฟล์แนบการติดตาม 1"]'))`)) &&
          text.includes('ส่งต่อหน่วยงาน') &&
          text.includes('ปิดเคส');
      },
      'PENDING_REVIEW case did not render its attachment and separate review actions',
    );
    await waitFor(
      async () => {
        const values = await evaluate(
          client,
          `[...document.querySelectorAll('label')]
            .filter((label) => ['สถานะของบิดา-มารดา', 'ผู้ปกครอง', 'ระบุผู้ปกครอง', 'สภาพแวดล้อมรอบที่พัก']
              .includes(label.firstChild?.textContent?.trim()))
            .map((label) => label.querySelector('input')?.value || '')
            .join('|')`,
        );
        return (
          String(values) ===
          'หย่าร้าง|อื่น ๆ (ระบุในช่อง)|พี่ชายของบิดา|อยู่ใกล้แหล่งสารเสพติด, มีปัญหาอาชญากรรมในพื้นที่'
        );
      },
      'Case step 2 did not mirror the household context captured in the report',
    );
    await click(
      client,
      `(() => [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === 'ส่งต่อหน่วยงาน'))()`,
      'Refer-agency review action was not found',
    );
    await waitFor(
      async () => (await evaluate(client, 'document.body.innerText')).includes('เหตุผลการพิจารณา'),
      'Refer-agency review dialog did not render',
    );
    const reviewSubmitInitiallyDisabled = await evaluate(
      client,
      `(() => [...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent.includes('ส่งต่อหน่วยงาน'))?.disabled === true)()`,
    );
    assert(reviewSubmitInitiallyDisabled, 'Review dialog allowed an empty reason');
    await setInputValue(client, '#case-note', 'ส่งต่อหน่วยงานเพื่อดูแลต่อเนื่อง');
    await click(
      client,
      `(() => [...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent.includes('ส่งต่อหน่วยงาน')))()`,
      'Refer-agency review confirmation was not found',
    );
    await waitFor(
      async () => (await evaluate(client, 'document.body.innerText')).includes('เสร็จสิ้น'),
      'Reviewed case did not render the RESOLVED state',
    );
    const [reviewedCase] = await dataSource.query(
      `SELECT status, completion_outcome_code FROM cases WHERE id = $1`,
      [caseId],
    );
    assert(
      reviewedCase?.status === 'RESOLVED' &&
        reviewedCase?.completion_outcome_code === 'REFERRED_AGENCY',
      'Refer-agency review did not persist RESOLVED/REFERRED_AGENCY',
    );

    const studentNotFoundCaseResult = await postBrowserJson(
      client,
      `${BROWSER_BACKEND_URL}/api/cases`,
      { student_id: student.student_uuid, reason: REASON_FLAGGED },
    );
    const studentNotFoundCaseId = Number(studentNotFoundCaseResult.body?.data?.id);
    assert(
      studentNotFoundCaseResult.body?.created === true && Number.isInteger(studentNotFoundCaseId),
      'Could not create a fresh case for STUDENT_NOT_FOUND flow',
    );
    const assignmentStart = new Date();
    const assignmentEnd = new Date(assignmentStart.getTime() + 24 * 60 * 60 * 1000);
    const assignmentResult = await postBrowserJson(client, `${BROWSER_BACKEND_URL}/api/tasks`, {
      task_type: 'VISIT',
      type: 'VISIT',
      assigned_to_name: '',
      assigned_to_first_name: '',
      assigned_to_last_name: '',
      assigned_teacher_user_id: visitAssigneesResult.body.data[0].teacherUserId,
      expires_value: 1,
      expires_unit: 'days',
      opens_at: assignmentStart.toISOString(),
      expires_at: assignmentEnd.toISOString(),
      existing_case_id: String(studentNotFoundCaseId),
      student_id: student.student_uuid,
      student_name: `${student.first_name} ${student.last_name}`,
      student_school: student.school_name,
      target_school_id: student.school_id,
      reason_flagged: REASON_FLAGGED,
      assignment_note: 'ตรวจสอบกรณีไม่พบนักเรียน',
    });
    assert(assignmentResult.status === 201, `Student-not-found assignment returned ${assignmentResult.status}`);
    const studentNotFoundLink = await getCreatedLink(
      dataSource,
      taskRepository,
      studentNotFoundCaseId,
      'ตรวจสอบกรณีไม่พบนักเรียน',
    );
    await dataSource.query(`UPDATE task_links SET otp_verified = 1 WHERE id = $1`, [
      studentNotFoundLink.link_id,
    ]);
    const studentNotFoundGuestPath = new URL(studentNotFoundLink.magic_link, FRONTEND_URL).pathname;
    await navigate(client, `${FRONTEND_URL}${studentNotFoundGuestPath}`, 'student-not-found report');
    await waitFor(
      async () => Boolean(await evaluate(client, `Boolean(document.querySelector('#visited-time'))`)),
      'Student-not-found report form did not render',
    );
    await selectHomeVisitException(client, 'ไม่พบนักเรียน');
    await selectCombobox(client, '#follow-up-assessment', 'ควรติดตามต่อ');
    await setInputValue(
      client,
      '#cause-detail',
      'ตรวจบริเวณบ้านและสอบถามเพื่อนบ้านแล้ว ยังไม่พบนักเรียน',
    );
    await click(
      client,
      `document.querySelector('button[type="submit"]')`,
      'Student-not-found report submit button was not found',
    );
    await waitFor(
      async () => (await evaluate(client, 'document.body.innerText')).includes('ส่งผลการติดตาม'),
      'Student-not-found report did not reach its receipt',
    );
    const [studentNotFoundCase] = await dataSource.query(
      `SELECT status FROM cases WHERE id = $1`,
      [studentNotFoundCaseId],
    );
    assert(
      studentNotFoundCase?.status === 'STUDENT_NOT_FOUND',
      `Expected STUDENT_NOT_FOUND, received ${studentNotFoundCase?.status}`,
    );

    await navigate(client, `${FRONTEND_URL}/cases/${studentNotFoundCaseId}`, 'student-not-found case');
    await waitFor(
      async () => (await evaluate(client, 'document.body.innerText')).includes('มอบหมายอีกครั้ง'),
      'STUDENT_NOT_FOUND case did not expose re-assignment',
    );
    await click(
      client,
      `(() => [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === 'มอบหมายอีกครั้ง'))()`,
      'Re-assignment button was not found',
    );
    await setAssignmentEnd(client);
    await selectFirstVisitAssignee(client);
    await click(
      client,
      `(() => [...document.querySelectorAll('button')]
        .find((button) => button.offsetParent !== null && button.textContent.includes('มอบหมาย')))()`,
      'Student-not-found re-assignment submit was not found',
    );
    await waitFor(
      async () => (await evaluate(client, 'document.body.innerText')).includes('ยืนยันการมอบหมาย'),
      'Student-not-found re-assignment confirmation did not render',
    );
    await click(
      client,
      `(() => [...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent.trim() === 'ยืนยัน'))()`,
      'Student-not-found re-assignment confirmation was not found',
    );
    await waitFor(
      async () => {
        const [row] = await dataSource.query(`SELECT status FROM cases WHERE id = $1`, [studentNotFoundCaseId]);
        return row?.status === 'IN_PROGRESS';
      },
      'Student-not-found re-assignment did not return the case to IN_PROGRESS',
    );

    const [latestReassignment] = await dataSource.query(
      `SELECT tl.id, t.id AS task_id
       FROM tasks t
       JOIN task_links tl ON tl.task_id = t.id AND tl.deleted_at IS NULL
       WHERE t.case_id = $1 AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC, tl.created_at DESC
       LIMIT 1`,
      [studentNotFoundCaseId],
    );
    await dataSource.query(
      `UPDATE task_links
       SET opens_at = NOW() - INTERVAL '2 days', expires_at = NOW() - INTERVAL '1 day'
       WHERE id = $1`,
      [latestReassignment.id],
    );
    await navigate(client, `${FRONTEND_URL}/cases/${studentNotFoundCaseId}`, 'expired assignment renewal');
    await waitFor(
      async () => (await evaluate(client, 'document.body.innerText')).includes('ลิงก์เดิมหมดอายุแล้ว'),
      'Expired IN_PROGRESS case did not expose renewal flow',
    );
    await setAssignmentEnd(client);
    await selectFirstVisitAssignee(client);
    await click(
      client,
      `(() => [...document.querySelectorAll('button')]
        .find((button) => button.offsetParent !== null && button.textContent.includes('มอบหมาย')))()`,
      'Expired-link renewal submit was not found',
    );
    await waitFor(
      async () => (await evaluate(client, 'document.body.innerText')).includes('ยืนยันการมอบหมาย'),
      'Expired-link renewal confirmation did not render',
    );
    await click(
      client,
      `(() => [...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent.trim() === 'ยืนยัน'))()`,
      'Expired-link renewal confirmation was not found',
    );
    await waitFor(
      async () => {
        const [row] = await dataSource.query(
          `SELECT COUNT(*)::int AS live_count
           FROM tasks t JOIN task_links tl ON tl.task_id = t.id
           WHERE t.case_id = $1 AND tl.status = 'ACTIVE' AND tl.expires_at > NOW()
             AND t.deleted_at IS NULL AND tl.deleted_at IS NULL`,
          [studentNotFoundCaseId],
        );
        return Number(row?.live_count) === 1;
      },
      'Expired-link renewal did not create exactly one usable assignment',
    );

    await dataSource.query(
      `UPDATE task_links
       SET status = 'COMPLETED'
       WHERE task_id IN (SELECT id FROM tasks WHERE case_id = $1)`,
      [studentNotFoundCaseId],
    );
    await dataSource.query(`UPDATE tasks SET status = 'COMPLETED' WHERE case_id = $1`, [
      studentNotFoundCaseId,
    ]);
    await dataSource.query(
      `UPDATE cases SET status = 'PENDING_REVIEW', completion_outcome_code = NULL WHERE id = $1`,
      [studentNotFoundCaseId],
    );
    await navigate(client, `${FRONTEND_URL}/cases/${studentNotFoundCaseId}`, 'close-case review');
    await waitFor(
      async () => (await evaluate(client, 'document.body.innerText')).includes('ปิดเคส'),
      'PENDING_REVIEW case did not expose the close action',
    );
    await click(
      client,
      `(() => [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === 'ปิดเคส'))()`,
      'Close-case action was not found',
    );
    await setInputValue(client, '#case-note', 'ตรวจสอบแล้ว ปิดเคสได้');
    await click(
      client,
      `(() => [...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent.includes('ปิดเคส')))()`,
      'Close-case confirmation was not found',
    );
    await waitFor(
      async () => {
        const [row] = await dataSource.query(
          `SELECT status, completion_outcome_code FROM cases WHERE id = $1`,
          [studentNotFoundCaseId],
        );
        return row?.status === 'RESOLVED' && row?.completion_outcome_code === 'CLOSED';
      },
      'Close review did not persist RESOLVED/CLOSED',
    );

    console.log(
      'home visit browser smoke passed (OPEN assignment, IN_PROGRESS report/upload, PENDING_REVIEW review, REFER_AGENCY/CLOSE resolution, STUDENT_NOT_FOUND re-assignment, expired-link renewal)',
    );
  } finally {
    await closeChrome(chrome);
    try {
      await cleanupSmokeTasks(dataSource, storage);
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
