const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ValidationPipe } = require('@nestjs/common');
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { randomUUID } = require('crypto');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');
const { TokenEncryptionService } = require('../dist/common/crypto/token-encryption.service');
const { generateToken, hashToken } = require('../dist/common/utils/helpers');
const {
  CLASSROOM_LINK_SESSION_COOKIE,
} = require('../dist/classroom-attendance-links/classroom-attendance-links.constants');
const {
  ClassroomLinkSessionStore,
} = require('../dist/classroom-attendance-links/classroom-link-session.store');
const { RiskProfileService } = require('../dist/risk-profile/risk-profile.service');
const { FILE_STORAGE_ADAPTER } = require('../dist/files/storage/file-storage.types');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run browser smoke in production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9263);
const ALLOWED_USERNAME = 'subject_check_in_browser_allowed';
const DENIED_USERNAME = 'subject_check_in_browser_denied';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(check, message, timeoutMs = 25_000) {
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
    this.listeners = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method) {
        for (const listener of this.listeners.get(message.method) || []) {
          listener(message.params || {});
        }
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
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
    `Page did not load: ${new URL(url).pathname}`,
  );
}

async function openChrome() {
  assert(fs.existsSync(CHROME_PATH), 'Google Chrome executable was not found');
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sts-subject-check-in-chrome-'),
  );
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
  const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then(
    (response) => response.json(),
  );
  const target = targets.find((item) => item.type === 'page');
  assert(target?.webSocketDebuggerUrl, 'Chrome page target was not available');
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return { client, processRef, userDataDir };
}

async function closeChrome(chrome) {
  chrome?.client.close();
  if (chrome?.processRef && chrome.processRef.exitCode === null) {
    const waitForExit = () =>
      new Promise((resolve) => {
        chrome.processRef.once('exit', resolve);
        setTimeout(resolve, 2_000);
      });
    chrome.processRef.kill('SIGTERM');
    await waitForExit();
    if (chrome.processRef.exitCode === null) {
      chrome.processRef.kill('SIGKILL');
      await waitForExit();
    }
  }
  if (chrome?.userDataDir) {
    fs.rmSync(chrome.userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

function stopProcess(processRef) {
  if (processRef && !processRef.killed) processRef.kill('SIGTERM');
}

function createSessionCookie(service, userId) {
  let cookie;
  service.setSession(
    {
      cookie: (name, value) => {
        cookie = { name, value };
      },
    },
    userId,
  );
  assert(cookie, 'Session cookie was not created');
  return cookie;
}

async function upsertActor(dataSource, username, permissions, schoolId) {
  const [row] = await dataSource.query(
    `INSERT INTO users (
       username, password, status, permissions, "FirstName", "LastName",
       role, data_scope, must_change_password, data_origin_code
     ) VALUES ($1, 'NOT_A_LOGIN_CREDENTIAL', 'ACTIVE', $2::jsonb,
       'ผู้ใช้งาน', 'ระบบอัตโนมัติ', 'ADMIN', $3::jsonb, FALSE, 'AUTOMATED_TEST')
     ON CONFLICT (username) DO UPDATE SET
       status = 'ACTIVE', permissions = EXCLUDED.permissions,
       role = 'ADMIN', data_scope = EXCLUDED.data_scope,
       must_change_password = FALSE, data_origin_code = 'AUTOMATED_TEST'
     RETURNING id`,
    [username, JSON.stringify(permissions), JSON.stringify({ school_ids: [schoolId] })],
  );
  return row;
}

async function login(client, user, cookie) {
  await navigate(client, `${FRONTEND_URL}/login`);
  await client.call('Network.setCookie', {
    name: cookie.name,
    value: cookie.value,
    url: BACKEND_URL,
    httpOnly: true,
    sameSite: 'Lax',
  });
  await evaluate(
    client,
    `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(user))});
     localStorage.setItem('admin_access', 'true');`,
  );
}

async function fetchApi(client, pathname) {
  return await evaluate(
    client,
    `fetch(${JSON.stringify(`${BACKEND_URL}${pathname}`)}, { credentials: 'include' })
      .then(async (response) => ({ status: response.status, body: await response.json() }))`,
  );
}

async function clickButton(client, label) {
  await waitFor(
    async () =>
      await evaluate(
        client,
        `[...document.querySelectorAll('button')].some((item) =>
          item.innerText.trim() === ${JSON.stringify(label)} &&
          !item.disabled && item.getClientRects().length > 0)`,
      ),
    `Button did not become ready: ${label}`,
  );
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.innerText.trim() === ${JSON.stringify(label)} &&
          !item.disabled && item.getClientRects().length > 0);
      if (!button) throw new Error('Button not found: ${label}');
      button.click();
    })()`,
  );
}

async function setLabeledValue(client, label, value, selector) {
  await waitFor(
    async () => await evaluate(
      client,
      `(() => {
        const fieldLabel = [...document.querySelectorAll('label')]
          .find((item) => item.textContent.trim().startsWith(${JSON.stringify(label)}));
        const field = fieldLabel?.control || fieldLabel?.querySelector(${JSON.stringify(selector)});
        if (!field) return false;
        return !(field instanceof HTMLSelectElement) ||
          [...field.options].some((option) => option.value === ${JSON.stringify(String(value))});
      })()`,
    ),
    `Field option did not become ready: ${label}`,
  );
  await evaluate(
    client,
    `(() => {
      const fieldLabel = [...document.querySelectorAll('label')]
        .find((item) => item.textContent.trim().startsWith(${JSON.stringify(label)}));
      const field = fieldLabel?.control || fieldLabel?.querySelector(${JSON.stringify(selector)});
      if (!field) throw new Error('Field not found: ${label}');
      const prototype = field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(
        field,
        ${JSON.stringify(String(value))},
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
  await waitFor(
    async () =>
      String(
        await evaluate(
          client,
          `(() => {
            const fieldLabel = [...document.querySelectorAll('label')]
              .find((item) => item.textContent.trim().startsWith(${JSON.stringify(label)}));
            return (fieldLabel?.control || fieldLabel?.querySelector(${JSON.stringify(selector)}))?.value ?? '';
          })()`,
        ),
      ) === String(value),
    `Field did not keep value: ${label}`,
  );
}

async function setAriaSelect(client, label, value) {
  await evaluate(
    client,
    `(() => {
      const field = document.querySelector(
        'select[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']'
      );
      if (!field) throw new Error('Select not found: ${label}');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(
        field,
        ${JSON.stringify(String(value))},
      );
      field.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

/** Grade and room sit inside the scope dialog, behind its trigger. */
async function openScopePicker(client) {
  await waitFor(
    async () =>
      await evaluate(
        client,
        `[...document.querySelectorAll('button')].some((item) =>
          item.innerText.includes('ขอบเขต') && item.getClientRects().length > 0)`,
      ),
    'Scope picker trigger did not render',
  );
  await evaluate(
    client,
    `[...document.querySelectorAll('button')]
      .find((item) => item.innerText.includes('ขอบเขต') &&
        item.getClientRects().length > 0).click()`,
  );
  await waitFor(
    async () =>
      await evaluate(client, `Boolean(document.querySelector('select[aria-label="ชั้น"]'))`),
    'Scope picker did not open onto the grade select',
  );
}

/** Curriculum subject cards are collapsed until their header is clicked. */
async function expandSubjectCard(client, subjectName) {
  const find = `[...document.querySelectorAll('button[aria-expanded]')]
    .find((item) => item.innerText.includes(${JSON.stringify(subjectName)}))`;
  await waitFor(
    async () => await evaluate(client, `Boolean(${find})`),
    `Subject card did not render: ${subjectName}`,
  );
  await evaluate(
    client,
    `(() => {
      const card = ${find};
      if (card.getAttribute('aria-expanded') !== 'true') card.click();
    })()`,
  );
  await waitFor(
    async () => await evaluate(client, `${find}.getAttribute('aria-expanded') === 'true'`),
    `Subject card did not expand: ${subjectName}`,
  );
}

async function selectComboboxOption(client, ariaLabel, text) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('input[aria-label=${JSON.stringify(ariaLabel)}]');
      if (!input) throw new Error('Combobox not found: ${ariaLabel}');
      input.click();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
        input,
        ${JSON.stringify(text)},
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
  await waitFor(
    async () => await evaluate(
      client,
      `[...document.querySelectorAll('ul button')].some((button) =>
        button.innerText.includes(${JSON.stringify(text)}) && button.getClientRects().length > 0)`,
    ),
    `Combobox option did not become ready: ${text}`,
  );
  await evaluate(
    client,
    `[...document.querySelectorAll('ul button')]
      .find((button) => button.innerText.includes(${JSON.stringify(text)}) &&
        button.getClientRects().length > 0).click()`,
  );
}

async function setDatePicker(client, ariaLabel, isoDate) {
  await evaluate(
    client,
    `document.querySelector('button[aria-label=${JSON.stringify(ariaLabel)}]')?.click()`,
  );
  await waitFor(
    async () => await evaluate(client, 'Boolean(document.querySelector(\'[role="dialog"][aria-label="เลือกวันที่"]\'))'),
    `Date picker did not open: ${ariaLabel}`,
  );
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [currentYear, currentMonth] = today.split('-').map(Number);
  const [targetYear, targetMonth] = isoDate.split('-').map(Number);
  const monthDelta = (targetYear - currentYear) * 12 + targetMonth - currentMonth;
  const direction = monthDelta < 0 ? 'ก่อนหน้า' : 'ถัดไป';
  for (let index = 0; index < Math.abs(monthDelta); index += 1) {
    await evaluate(
      client,
      `document.querySelector('[role="dialog"] button[aria-label=${JSON.stringify(direction)}]')?.click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  await waitFor(
    async () => await evaluate(
      client,
      `Boolean(document.querySelector('[role="dialog"] button[aria-label=${JSON.stringify(isoDate)}]'))`,
    ),
    `Date was not available: ${isoDate}`,
  );
  await evaluate(
    client,
    `document.querySelector('[role="dialog"] button[aria-label=${JSON.stringify(isoDate)}]').click()`,
  );
}

async function visibleRowIds(client) {
  return await evaluate(
    client,
    `[...document.querySelectorAll('[data-check-in-row]')]
      .filter((row) => row.getClientRects().length > 0)
      .map((row) => row.getAttribute('data-check-in-row'))`,
  );
}

async function assertCheckInAvatars(client, expectedPhotoPath) {
  await waitFor(
    async () =>
      await evaluate(
        client,
        `(() => {
          const images = [...document.querySelectorAll('[data-check-in-row] img[data-avatar-image]')];
          return images.length > 0 && images.every((image) =>
            image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
          );
        })()`,
      ),
    `Check-in photos did not load successfully from ${expectedPhotoPath}`,
  );
  const result = await evaluate(
    client,
    `(() => {
      const avatars = [...document.querySelectorAll('[data-check-in-row] [data-slot="avatar"]')];
      return {
        count: avatars.length,
        fallbackLengths: avatars
          .map((avatar) => avatar.querySelector('span')?.textContent.trim() ?? '')
          .filter(Boolean)
          .map((value) => Array.from(value).length),
        imagePaths: avatars
          .map((avatar) => avatar.querySelector('img[data-avatar-image]')?.src ?? '')
          .filter(Boolean)
          .map((value) => new URL(value).pathname),
        imageVersions: avatars
          .map((avatar) => avatar.querySelector('img[data-avatar-image]')?.src ?? '')
          .filter(Boolean)
          .map((value) => new URL(value).searchParams.get('v')),
      };
    })()`,
  );
  assert(result.count > 0, 'Check-in roster did not render shared avatars');
  assert(
    result.fallbackLengths.every((length) => length === 1),
    `Check-in avatar fallback was not one letter: ${JSON.stringify(result.fallbackLengths)}`,
  );
  assert(
    result.imagePaths.length > 0,
    'Check-in roster did not render a student photo fixture',
  );
  assert(
    result.imagePaths.every((pathname) => pathname === expectedPhotoPath),
    `Check-in photo did not use the guarded img URL: ${JSON.stringify(result.imagePaths)}`,
  );
  assert(
    result.imageVersions.every(Boolean),
    `Check-in photo did not include the cache-version query: ${JSON.stringify(result.imageVersions)}`,
  );
}

async function restoreStudentPhotoFixture(dataSource, storage, fixture) {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    await queryRunner.query(`SET LOCAL session_replication_role = 'replica'`);
    await queryRunner.query(
      `UPDATE student_person
       SET photo_storage_key = $2, updated_at = $3
       WHERE person_uuid = $1`,
      [fixture.personUuid, fixture.previousStorageKey, fixture.previousUpdatedAt],
    );
    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
  await storage.delete(fixture.storageKey);
}

async function summaryCount(client, label) {
  return await evaluate(
    client,
    `(() => {
      const item = [...document.querySelectorAll('p')]
        .find((node) => node.textContent.trim() === ${JSON.stringify(label)});
      const match = item?.nextElementSibling?.textContent.trim().match(/^\\d+/);
      return match ? Number(match[0]) : -1;
    })()`,
  );
}

async function waitForMarked(client, count) {
  await waitFor(
    async () => (await summaryCount(client, 'ยังไม่เช็ก')) >= 0 &&
      (await summaryCount(client, 'มา')) +
        (await summaryCount(client, 'สาย')) +
        (await summaryCount(client, 'ขาด')) +
        (await summaryCount(client, 'ลา')) === count,
    `Marked count did not become ${count}`,
  );
}

function requestCount(requests, method, pathname) {
  return requests.filter((item) => {
    if (item.method !== method) return false;
    try {
      return new URL(item.url).pathname === pathname;
    } catch {
      return false;
    }
  }).length;
}

async function markRemainingPresent(client) {
  await waitFor(
    async () => await evaluate(
      client,
      `[...document.querySelectorAll('button')].some((button) =>
        button.innerText.trim().startsWith('มาทั้งหมด') &&
        !button.disabled && button.getClientRects().length > 0)`,
    ),
    'Mark-all-present action did not become ready',
  );
  await evaluate(
    client,
    `[...document.querySelectorAll('button')]
      .find((button) => button.innerText.trim().startsWith('มาทั้งหมด') &&
        !button.disabled && button.getClientRects().length > 0).click()`,
  );
}

async function main() {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  const subjectCode = `นว${Date.now().toString().slice(-8)}`;
  const subjectName = `แนะแนว ${suffix}`;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RiskProfileService)
    .useValue({ requestStudentRecalculation: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
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
  app.enableCors({ origin: FRONTEND_URL, credentials: true });

  const dataSource = app.get(DataSource);
  const cookieService = app.get(SessionCookieService);
  const encryption = app.get(TokenEncryptionService);
  const sessionStore = app.get(ClassroomLinkSessionStore);
  const storage = app.get(FILE_STORAGE_ADAPTER);
  let frontend;
  let chrome;
  let scope;
  let linkId = null;
  let fixtureSubjectId = null;
  let fixtureOfferingId = null;
  let fixturePhoto = null;
  let fixtureTeacherPhoto = null;
  let allowed;
  let denied;

  try {
    [scope] = await dataSource.query(`
      SELECT classroom.id::int AS classroom_id, classroom.school_id,
             classroom.school_term_id::int, offering.id::int AS classroom_subject_id,
             classroom.grade_level_id::int,
             grade.label AS grade_label,
             classroom.room_code,
             classroom.room_name,
             grade.label || '/' || classroom.room_code AS classroom_label,
             school_subject.subject_id,
             subject.name_th AS scope_subject_name,
             membership.id::text AS teacher_membership_id,
             membership.teacher_id::text, available.check_in_date
      FROM school_classrooms classroom
      JOIN schools school
        ON school.id = classroom.school_id
       AND school.school_status = 'ACTIVE'
      JOIN grade_levels grade ON grade.id = classroom.grade_level_id
      JOIN school_terms term
        ON term.id = classroom.school_term_id
       AND term.school_id = classroom.school_id
       AND term.status = 'ACTIVE'
       AND term.deleted_at IS NULL
       AND term.id = (
         SELECT current_term.id
         FROM school_terms current_term
         WHERE current_term.school_id = classroom.school_id
           AND current_term.status = 'ACTIVE'
           AND current_term.deleted_at IS NULL
         ORDER BY current_term.academic_year DESC, current_term.semester DESC
         LIMIT 1
       )
      JOIN classroom_subjects offering
        ON offering.classroom_id = classroom.id
       AND offering.school_id = classroom.school_id
       AND offering.offering_status = 'ACTIVE'
       AND offering.deleted_at IS NULL
      JOIN school_subjects school_subject
        ON school_subject.id = offering.school_subject_id
       AND school_subject.school_id = offering.school_id
       AND school_subject.subject_status = 'ACTIVE'
       AND school_subject.deleted_at IS NULL
      JOIN subjects subject
        ON subject.id = school_subject.subject_id
       AND subject.code = 'HOMEROOM101'
       AND subject.is_active
       AND subject.deleted_at IS NULL
      JOIN school_teacher_memberships membership
        ON membership.school_id = classroom.school_id
       AND membership.membership_status = 'ACTIVE'
       AND membership.deleted_at IS NULL
      JOIN teachers teacher
        ON teacher.id = membership.teacher_id
       AND teacher.teacher_status = 'ACTIVE'
       AND teacher.deleted_at IS NULL
      JOIN LATERAL (
        SELECT candidate.check_in_date::date::text AS check_in_date
        FROM generate_series(
          term.starts_on,
          LEAST(term.ends_on, (now() AT TIME ZONE 'Asia/Bangkok')::date),
          INTERVAL '1 day'
        ) AS candidate(check_in_date)
        WHERE term.starts_on <= (now() AT TIME ZONE 'Asia/Bangkok')::date
          AND NOT EXISTS (
            SELECT 1 FROM attendance_sessions existing
            WHERE existing.school_term_id = classroom.school_term_id
              AND existing.classroom_id = classroom.id
              AND existing.classroom_subject_id = offering.id
              AND existing.attendance_date = candidate.check_in_date::date
              AND existing.deleted_at IS NULL
          )
        ORDER BY candidate.check_in_date DESC
        LIMIT 1
      ) available ON TRUE
      WHERE classroom.classroom_status = 'ACTIVE'
        AND classroom.deleted_at IS NULL
        -- A standing link is one per teacher per term, so that is what has to
        -- be free for the fixture insert below, not the room.
        AND NOT EXISTS (
          SELECT 1 FROM classroom_attendance_links link
          WHERE link.teacher_membership_id = membership.id
            AND link.school_term_id = classroom.school_term_id
            AND link.link_status = 'ACTIVE'
        )
        AND (
          SELECT count(*)
          FROM student_term enrollment
          JOIN student_current_enrollment_resolution resolution
            ON resolution.person_uuid = enrollment.person_uuid
           AND resolution.selected_student_uuid = enrollment.student_uuid
           AND resolution.resolution_state = 'ACTIVE'
          WHERE enrollment.classroom_id = classroom.id
            AND enrollment.deleted_at IS NULL
        ) >= 4
      ORDER BY classroom.id, membership.id
      LIMIT 1
    `);
    assert(scope, 'No clean classroom and school day are available');

    const [photoStudent] = await dataSource.query(
      `SELECT person.person_uuid::text AS person_uuid,
              person.photo_storage_key,
              person.updated_at
       FROM student_term enrollment
       JOIN student_current_enrollment_resolution resolution
         ON resolution.person_uuid = enrollment.person_uuid
        AND resolution.selected_student_uuid = enrollment.student_uuid
        AND resolution.resolution_state = 'ACTIVE'
       JOIN student_person person ON person.person_uuid = enrollment.person_uuid
       WHERE enrollment.classroom_id = $1
         AND enrollment.deleted_at IS NULL
       ORDER BY enrollment.student_uuid
       LIMIT 1`,
      [scope.classroom_id],
    );
    assert(photoStudent, 'No active student is available for the photo fixture');
    const photoStorageKey = `student-photos/automated-subject-check-in-${suffix}.png`;
    await storage.save(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlKzJcAAAAASUVORK5CYII=',
        'base64',
      ),
      photoStorageKey,
    );
    fixturePhoto = {
      personUuid: photoStudent.person_uuid,
      previousStorageKey: photoStudent.photo_storage_key,
      previousUpdatedAt: photoStudent.updated_at,
      storageKey: photoStorageKey,
    };
    await dataSource.query(
      `UPDATE student_person SET photo_storage_key = $2 WHERE person_uuid = $1`,
      [photoStudent.person_uuid, photoStorageKey],
    );

    allowed = await upsertActor(
      dataSource,
      ALLOWED_USERNAME,
      ['home', 'attendance', 'dashboard', 'manage-subjects', 'manage-classroom-links'],
      scope.school_id,
    );
    denied = await upsertActor(dataSource, DENIED_USERNAME, ['home'], scope.school_id);
    const allowedCookie = createSessionCookie(cookieService, allowed.id);
    const deniedCookie = createSessionCookie(cookieService, denied.id);

    const rawToken = generateToken();
    const [link] = await dataSource.query(
      // A standing link belongs to a teacher now, not to one room.
      `INSERT INTO classroom_attendance_links (
         school_id, school_term_id, teacher_membership_id, token_hash, token_encrypted,
         link_status, issued_at, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', now(), $6, $6)
       RETURNING id::text`,
      [
        scope.school_id,
        scope.school_term_id,
        scope.teacher_membership_id,
        hashToken(rawToken),
        encryption.encrypt(rawToken),
        allowed.id,
      ],
    );
    linkId = link.id;
    const publicSession = await sessionStore.issue({
      linkId,
      tokenHash: hashToken(rawToken),
      teacherId: scope.teacher_id,
      teacherMembershipId: scope.teacher_membership_id,
      schoolId: scope.school_id,
      provider: 'GOOGLE',
    });

    const backendAddress = new URL(BACKEND_URL);
    await app.listen(Number(backendAddress.port), backendAddress.hostname);
    frontend = spawn('pnpm', ['dev', '--host', '127.0.0.1', '--port', '5174'], {
      cwd: path.resolve(__dirname, '../../sts-frontend'),
      env: { ...process.env, VITE_API_BASE_URL: BACKEND_URL },
      stdio: 'ignore',
    });
    await waitFor(async () => {
      try {
        return (await fetch(FRONTEND_URL)).ok;
      } catch {
        return false;
      }
    }, 'Frontend did not start');

    chrome = await openChrome();
    const { client } = chrome;
    const networkRequests = [];
    const networkResponses = [];
    client.on('Network.requestWillBeSent', ({ request }) => {
      networkRequests.push({
        method: request.method,
        url: request.url,
        postData: request.postData,
      });
    });
    client.on('Network.responseReceived', ({ response }) => {
      networkResponses.push({ status: response.status, url: response.url });
    });
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const deniedUser = {
      id: denied.id,
      username: DENIED_USERNAME,
      roles: ['ADMIN'],
      permissions: ['home'],
      data_scope: { school_ids: [scope.school_id] },
      must_change_password: false,
    };
    await login(client, deniedUser, deniedCookie);
    await navigate(client, `${FRONTEND_URL}/curriculum`);
    await waitFor(
      async () => (await evaluate(client, 'location.pathname')) === '/forbidden',
      'Subjects page did not deny a user without manage-subjects',
    );
    await navigate(client, `${FRONTEND_URL}/attendance/check-in`);
    await waitFor(
      async () => (await evaluate(client, 'location.pathname')) === '/forbidden',
      'Check-in page did not deny a user without attendance',
    );

    const allowedUser = {
      ...deniedUser,
      id: allowed.id,
      username: ALLOWED_USERNAME,
      permissions: [
        'home',
        'attendance',
        'dashboard',
        'manage-subjects',
        'manage-classroom-links',
      ],
    };
    await login(client, allowedUser, allowedCookie);
    await navigate(client, `${FRONTEND_URL}/curriculum`);
    try {
      await waitFor(
        async () => {
          const text = String(await evaluate(client, 'document.body.innerText'));
          return text.includes('จัดการข้อมูลหลักสูตร') && text.includes(scope.grade_label);
        },
        'Curriculum grade selection did not render',
      );
    } catch (error) {
      const visibleText = String(await evaluate(client, 'document.body.innerText')).slice(-1000);
      const subjectResponses = networkResponses.filter((response) =>
        response.url.includes('/api/subjects/'),
      );
      throw new Error(`${error.message}: ${JSON.stringify({ visibleText, subjectResponses })}`);
    }
    await navigate(
      client,
      `${FRONTEND_URL}/curriculum?schoolId=${scope.school_id}&search=${encodeURIComponent(scope.grade_label)}`,
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `Boolean([...document.querySelectorAll('a')].find((anchor) =>
              new URL(anchor.href).pathname === ${JSON.stringify(`/curriculum/${scope.grade_level_id}`)}
            ))`,
          ),
        ),
      'Filtered curriculum page did not render the target grade link',
    );
    const curriculumSourceUrl = await evaluate(client, 'location.pathname + location.search');
    await evaluate(
      client,
      `([...document.querySelectorAll('a')].find((anchor) =>
        new URL(anchor.href).pathname === ${JSON.stringify(`/curriculum/${scope.grade_level_id}`)}
      )).click()`,
    );
    await waitFor(
      async () => (await evaluate(client, 'location.pathname')) === `/curriculum/${scope.grade_level_id}`,
      'Curriculum context link did not open the grade page',
    );
    await clickButton(client, 'ย้อนกลับ');
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname + location.search')) === curriculumSourceUrl,
      'Curriculum back action did not restore the full filtered parent URL',
    );
    await navigate(
      client,
      `${FRONTEND_URL}/curriculum/${scope.grade_level_id}?schoolId=${scope.school_id}`,
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('HOMEROOM101'),
      'Curriculum grade page did not render HOMEROOM101 from classroom_subjects',
    );

    await clickButton(client, 'เพิ่มรายวิชา');
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('เพิ่มข้อมูลรายวิชา'),
      'Curriculum add form did not open',
    );
    await clickButton(client, 'ยกเลิก');
    await waitFor(
      async () => (await evaluate(client, 'location.pathname')) === `/curriculum/${scope.grade_level_id}`,
      'Curriculum add form did not cancel back to the grade page',
    );
    const cancelledRows = await dataSource.query(
      `SELECT 1 FROM subjects WHERE code = $1 AND deleted_at IS NULL`,
      [subjectCode],
    );
    assert(cancelledRows.length === 0, 'Cancelling the subject form persisted data');

    await clickButton(client, 'เพิ่มรายวิชา');
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('เพิ่มข้อมูลรายวิชา'),
      'Curriculum add form did not reopen after cancel',
    );

    try {
      await setLabeledValue(client, 'รหัสวิชา', subjectCode, 'input');
    } catch (error) {
      const formState = await evaluate(
        client,
        `({ href: location.href, text: document.body.innerText.slice(-1000), labels: [...document.querySelectorAll('label')].map((label) => label.textContent.trim()) })`,
      );
      throw new Error(`${error.message}: ${JSON.stringify(formState)}`);
    }
    await setLabeledValue(client, 'ชื่อวิชา', subjectName, 'input');
    await selectComboboxOption(client, 'ห้องเรียนที่ใช้รายวิชานี้', scope.classroom_label);
    await clickButton(client, 'บันทึก');
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT school_subject.id::int, school_subject.subject_id::int,
                offering.id::int AS offering_id
         FROM school_subjects school_subject
         JOIN subjects subject ON subject.id = school_subject.subject_id
         JOIN classroom_subjects offering
           ON offering.school_subject_id = school_subject.id
          AND offering.classroom_id = $3
          AND offering.offering_status = 'ACTIVE'
          AND offering.deleted_at IS NULL
         WHERE school_subject.school_id = $1 AND subject.code = $2
           AND school_subject.subject_status = 'ACTIVE'
           AND school_subject.deleted_at IS NULL`,
        [scope.school_id, subjectCode, scope.classroom_id],
      );
      if (!row) return false;
      fixtureSubjectId = row.subject_id;
      fixtureOfferingId = row.offering_id;
      return true;
    }, 'Curriculum subject and classroom offering did not persist atomically');
    if (!fixtureOfferingId) {
      const subjectResponses = networkResponses.filter((response) =>
        response.url.includes('/api/subjects/'),
      );
      const subjectRequests = networkRequests.filter((request) =>
        request.url.includes('/api/subjects/'),
      );
      const visibleText = String(await evaluate(client, 'document.body.innerText')).slice(-800);
      throw new Error(
        `Curriculum save did not return an offering: ${JSON.stringify({ subjectRequests, subjectResponses, visibleText })}`,
      );
    }

    // Staffing an offering, from the picker down to the row it prints.
    //
    // The actor holds `manage-subjects` and not `manage-school-structure`, so
    // an options endpoint gated on the structure page alone leaves the picker
    // empty here — which is what the teacher list looked like on this screen.
    // The teacher holding the link is one of the two, so the lesson created
    // here is also the lesson their link opens onto further down.
    const teacherChoices = await dataSource.query(
      `SELECT membership.id::text AS membership_id,
              teacher.id::text AS teacher_id,
              teacher.photo_storage_key,
              teacher.updated_at,
              TRIM(teacher.first_name || ' ' || teacher.last_name) AS display_name
       FROM school_teacher_memberships membership
       JOIN teachers teacher ON teacher.id = membership.teacher_id
        AND teacher.teacher_status = 'ACTIVE'
        AND teacher.deleted_at IS NULL
       WHERE membership.school_id = $1
         AND membership.membership_status = 'ACTIVE'
         AND membership.deleted_at IS NULL
         AND (membership.id = $2::bigint OR NOT EXISTS (
           SELECT 1 FROM school_teacher_memberships holder
           JOIN teachers holder_person ON holder_person.id = holder.teacher_id
           WHERE holder.id = $2::bigint
             AND TRIM(holder_person.first_name || ' ' || holder_person.last_name)
                 = TRIM(teacher.first_name || ' ' || teacher.last_name)
         ))
       ORDER BY (membership.id = $2::bigint) DESC, membership.id
       LIMIT 2`,
      [scope.school_id, scope.teacher_membership_id],
    );
    assert(
      teacherChoices.length === 2 &&
        teacherChoices[0].display_name !== teacherChoices[1].display_name,
      'Fixture school needs two distinguishable active teachers to staff a subject',
    );

    // One of the two carries a photo, so the row proves the whole chain — the
    // aggregate carrying the id, the url the service builds, and the guard on
    // the route that serves it — and not just that a fallback initial renders.
    const teacherPhotoStorageKey = `teacher-photos/automated-subject-check-in-${suffix}.png`;
    await storage.save(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlKzJcAAAAASUVORK5CYII=',
        'base64',
      ),
      teacherPhotoStorageKey,
    );
    fixtureTeacherPhoto = {
      teacherId: teacherChoices[0].teacher_id,
      previousStorageKey: teacherChoices[0].photo_storage_key,
      previousUpdatedAt: teacherChoices[0].updated_at,
      storageKey: teacherPhotoStorageKey,
    };
    await dataSource.query(`UPDATE teachers SET photo_storage_key = $2 WHERE id = $1`, [
      fixtureTeacherPhoto.teacherId,
      teacherPhotoStorageKey,
    ]);

    await expandSubjectCard(client, subjectName);
    await clickButton(client, 'กำหนดครู');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('กำหนดครูผู้สอน'),
      'Teacher dialog did not open',
    );
    assert(
      !String(await evaluate(client, 'document.body.innerText')).includes(
        'ใช้กับทุกห้องในระดับชั้นนี้',
      ),
      'Teacher dialog still offers to overwrite the other rooms of the grade',
    );
    // The chevron end of the field, not the text sliver between the chips:
    // that padding used to swallow the click and the control read as
    // unpressable.
    await evaluate(
      client,
      `(() => {
        const input = document.querySelector('input[aria-label="ครูผู้สอน"]');
        const field = input.parentElement;
        const rect = field.getBoundingClientRect();
        field.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          clientX: rect.right - 6,
          clientY: rect.top + rect.height / 2,
        }));
      })()`,
    );
    await waitFor(
      async () =>
        await evaluate(
          client,
          `document.querySelector('input[aria-label="ครูผู้สอน"]')
            ?.getAttribute('aria-expanded') === 'true'`,
        ),
      'Clicking the end of the teacher field did not open its list',
    );
    for (const choice of teacherChoices) {
      await selectComboboxOption(client, 'ครูผู้สอน', choice.display_name);
    }
    await clickButton(client, 'บันทึก');
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT COUNT(*)::int AS staffed
         FROM classroom_subject_teachers
         WHERE classroom_subject_id = $1
           AND assignment_status = 'ACTIVE'
           AND deleted_at IS NULL`,
        [fixtureOfferingId],
      );
      return row?.staffed === 2;
    }, 'Both teachers were not saved onto the offering');
    await waitFor(async () => {
      const cell = String(await evaluate(client, 'document.body.innerText'));
      return (
        cell.includes(teacherChoices[0].display_name) &&
        cell.includes(teacherChoices[1].display_name) &&
        !cell.includes('ยังไม่กำหนดครู')
      );
    }, 'The offering row did not list both teachers');
    await waitFor(
      async () =>
        await evaluate(
          client,
          `(() => {
            const images = [...document.querySelectorAll('img')].filter((image) =>
              new URL(image.src, location.origin).pathname ===
                '/api/teacher-profiles/${fixtureTeacherPhoto.teacherId}/photo');
            return images.length > 0 && images.every((image) =>
              image.complete && image.naturalWidth > 0);
          })()`,
        ),
      'The offering row did not show the teacher photo',
    );
    assert(
      await evaluate(
        client,
        `[...document.querySelectorAll('[data-slot="avatar"]')].length >= 2`,
      ),
      'The offering row did not render an avatar per teacher',
    );

    // The face opens the teacher's record, the same affordance the teacher
    // directory and the link page use.
    const teacherAvatarLabel = `เปิดข้อมูลคุณครู ${teacherChoices[0].display_name}`;
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button[aria-label]')]
          .find((item) => item.getAttribute('aria-label') === ${JSON.stringify(teacherAvatarLabel)});
        if (!button) throw new Error('Teacher avatar button not found');
        button.click();
      })()`,
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'location.pathname')).startsWith('/teachers/') &&
        String(await evaluate(client, 'document.body.innerText')).includes('ข้อมูลทั่วไป'),
      'Curriculum teacher avatar did not open the teacher profile',
    );
    await navigate(
      client,
      `${FRONTEND_URL}/curriculum/${scope.grade_level_id}?schoolId=${scope.school_id}`,
    );
    await expandSubjectCard(client, subjectName);

    // Opening the same subject for edit. The read behind this screen resolves
    // one subject by id, and a page size it cannot accept is what turned it
    // into "ไม่พบรายวิชา".
    await clickButton(client, 'แก้ไขข้อมูล');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('แก้ไขข้อมูลรายวิชา'),
      'Curriculum edit form did not open',
    );
    await waitFor(
      async () =>
        String(
          await evaluate(
            client,
            `(() => {
              const label = [...document.querySelectorAll('label')]
                .find((item) => item.textContent.trim().startsWith('รหัสวิชา'));
              return (label?.control || label?.querySelector('input'))?.value ?? '';
            })()`,
          ),
        ) === subjectCode,
      'Curriculum edit form did not load the subject it was opened on',
    );
    assert(
      !String(await evaluate(client, 'document.body.innerText')).includes('ไม่พบรายวิชา'),
      'Curriculum edit form reported the subject as missing',
    );
    await clickButton(client, 'ย้อนกลับ');
    await waitFor(
      async () => (await evaluate(client, 'location.pathname')) === `/curriculum/${scope.grade_level_id}`,
      'Curriculum edit form did not return to the grade page',
    );

    assert(
      await evaluate(
        client,
        `[...document.querySelectorAll('a')].every((link) =>
          !link.getAttribute('href')?.startsWith('/timetable') &&
          !link.getAttribute('href')?.startsWith('/teacher-access'))`,
      ),
      'A retired timetable or teacher-access link remained visible',
    );
    await navigate(client, `${FRONTEND_URL}/timetable`);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('ไม่พบหน้านี้'),
      'Legacy timetable route did not render 404',
    );
    await navigate(client, `${FRONTEND_URL}/teacher-access`);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('ไม่พบหน้านี้'),
      'Legacy teacher-access route did not render 404',
    );

    await navigate(client, `${FRONTEND_URL}/attendance/check-in`);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('เลือกห้องเรียนเพื่อเริ่มเช็กชื่อ'),
      'Internal check-in page did not render the classroom selector',
    );
    // Grade and room live behind the scope picker now, not on the page itself.
    await openScopePicker(client);
    await setAriaSelect(client, 'ชั้น', scope.grade_level_id);
    try {
      await waitFor(
        async () =>
          await evaluate(
            client,
            `Boolean(document.querySelector('select[aria-label="ห้อง"] option[value="${scope.classroom_id}"]'))`,
          ),
        'Room select did not load options for the selected grade',
      );
    } catch (error) {
      const attendanceResponses = networkResponses.filter((response) =>
        response.url.includes('/api/attendance/'),
      );
      const visibleText = String(await evaluate(client, 'document.body.innerText')).slice(-1000);
      throw new Error(
        `${error.message}: ${JSON.stringify({ scope, attendanceResponses, visibleText })}`,
      );
    }
    await setAriaSelect(client, 'ห้อง', scope.classroom_id);
    await clickButton(client, 'เสร็จสิ้น');
    await waitFor(
      async () => await evaluate(client, 'Boolean(document.querySelector(\'button[aria-label="เลือกวันที่เช็กชื่อ"]\'))'),
      'Internal check-in workspace did not open',
    );
    await setDatePicker(client, 'เลือกวันที่เช็กชื่อ', scope.check_in_date);
    await waitFor(
      async () => (await visibleRowIds(client)).length >= 4,
      'Internal check-in roster did not render',
    );
    const initialRowIds = await visibleRowIds(client);
    const rosterCount = initialRowIds.length;
    assert(
      (await evaluate(client, `document.querySelector('input[aria-label="วิชา"]')?.value ?? ''`)) === '',
      'Internal check-in defaulted a subject before the user selected one',
    );
    await assertCheckInAvatars(client, '/api/attendance/check-in/student-photo');
    networkRequests.length = 0;
    await markRemainingPresent(client);
    await waitForMarked(client, rosterCount);
    // The subject is required at the submit bar itself: the button stays
    // disabled and the bar says why, rather than letting the refusal come back
    // from the server into an alert at the top of the page.
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('กรุณาเลือกวิชา'),
      'Internal check-in did not require a subject on submit',
    );
    assert(
      await evaluate(
        client,
        `[...document.querySelectorAll('button')].some((item) =>
          item.innerText.trim() === 'ส่งผลเช็กชื่อ' && item.disabled)`,
      ),
      'Internal check-in offered submit before a subject was selected',
    );
    assert(
      requestCount(networkRequests, 'POST', '/api/attendance/check-in/sessions/start') === 0,
      'Internal check-in started a session before a subject was selected',
    );
    await selectComboboxOption(client, 'วิชา', scope.scope_subject_name);
    await waitForMarked(client, rosterCount);
    assert(
      requestCount(networkRequests, 'POST', '/api/attendance/check-in/sessions/start') === 0,
      'Selecting the first subject started a session before another attendance action',
    );
    await evaluate(
      client,
      `[...document.querySelectorAll('[data-default-mark][aria-pressed="true"]')]
        .filter((button) => button.getClientRects().length > 0)
        .forEach((button) => button.click())`,
    );
    await waitForMarked(client, 0);
    assert(
      requestCount(networkRequests, 'POST', '/api/attendance/check-in/sessions/start') === 0,
      'Clearing the preserved marks started an attendance session',
    );
    networkRequests.length = 0;
    await evaluate(
      client,
      `[...document.querySelectorAll('[data-check-in-row]')]
        .find((row) => row.getClientRects().length > 0)
        .querySelector('[data-default-mark]').click()`,
    );
    await waitFor(
      async () =>
        requestCount(
          networkRequests,
          'POST',
          '/api/attendance/check-in/sessions/start',
        ) === 1,
      'First internal mark did not start exactly one session',
    );
    await waitFor(
      async () => {
        const rowIds = await visibleRowIds(client);
        return rowIds[0] === initialRowIds[1] && rowIds.at(-1) === initialRowIds[0];
      },
      'Checked table row did not move to the bottom while preserving roster order',
    );
    await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('[data-check-in-row]')]
          .find((item) => item.getClientRects().length > 0);
        const button = [...row.querySelectorAll('button')]
          .find((item) => item.textContent.trim() === 'ขาด');
        if (!button) throw new Error('Absent button was not found');
        button.click();
      })()`,
    );
    await waitForMarked(client, 2);
    assert(
      !(await evaluate(client, `document.body.innerText.includes('สาเหตุการขาด')`)),
      'Check-in must not ask the teacher to infer an absence reason',
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert(
      networkRequests.filter((item) => item.method === 'POST').length === 1,
      'Internal marks generated a per-mark server write',
    );

    await clickButton(client, 'การ์ด');
    await waitFor(
      async () => await evaluate(client, 'Boolean(document.querySelector("[data-active-card=true]"))'),
      'Card mode did not render after preserving table marks',
    );
    assert((await summaryCount(client, 'ยังไม่เช็ก')) === rosterCount - 2, 'Mode switch lost table marks');
    await client.call('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await evaluate(
      client,
      `(() => {
        const card = document.querySelector('[data-active-card=true]');
        card.focus();
        card.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowRight', bubbles: true,
        }));
      })()`,
    );
    await waitForMarked(client, 3);
    await clickButton(client, 'สาย');
    await waitForMarked(client, 4);
    await clickButton(client, 'ย้อนกลับ');
    await waitForMarked(client, 3);
    if (networkRequests.filter((item) => item.method === 'POST').length !== 1) {
      const debugSessions = await dataSource.query(
        `SELECT classroom_subject_id::text, subject_id, attendance_date::text,
                record_storage_mode, status
         FROM attendance_sessions
         WHERE classroom_id = $1 AND attendance_date = $2 AND deleted_at IS NULL
         ORDER BY subject_id, record_storage_mode`,
        [scope.classroom_id, scope.check_in_date],
      );
      throw new Error(
        `Card keyboard/button/undo generated an unexpected write: ${networkRequests
        .filter((item) => item.method === 'POST')
        .map((item) => new URL(item.url).pathname)
        .join(', ')}; start statuses=${networkResponses
        .filter((item) => new URL(item.url).pathname === '/api/attendance/check-in/sessions/start')
        .map((item) => item.status)
        .join(',')}; scope=${JSON.stringify(scope)}; sessions=${JSON.stringify(debugSessions)}`,
      );
    }

    await clickButton(client, 'ตาราง');
    await waitFor(
      async () => (await visibleRowIds(client)).length === rosterCount,
      'Table mode did not restore the shared roster',
    );
    await markRemainingPresent(client);
    await waitForMarked(client, rosterCount);
    await clickButton(client, 'ส่งผลเช็กชื่อ');
    await waitFor(
      async () =>
        requestCount(
          networkRequests,
          'POST',
          '/api/attendance/check-in/sessions/',
        ) > 0 ||
        String(await evaluate(client, 'document.body.innerText')).includes('ส่งแล้ว · อ่านอย่างเดียว'),
      'Internal submit did not complete',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('ส่งแล้ว · อ่านอย่างเดียว'),
      'Internal check-in did not become read-only after submit',
    );
    assert(
      networkRequests.filter((item) => item.method === 'POST').length === 2,
      'Internal check-in did not use exactly start plus submit writes',
    );

    await client.call('Network.deleteCookies', {
      name: allowedCookie.name,
      url: BACKEND_URL,
    });
    await client.call('Network.deleteCookies', {
      name: CLASSROOM_LINK_SESSION_COOKIE,
      url: BACKEND_URL,
    });
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/check-in#token=${encodeURIComponent(rawToken)}`);
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return text.includes('ยืนยันด้วย Google') && text.includes('ยืนยันด้วย AraID');
      },
      'Public token landing did not require a verified teacher identity',
    );
    assert(
      await evaluate(
        client,
        `location.hash === '' && sessionStorage.getItem('sts_classroom_link_token') === null`,
      ),
      'Public token was not removed from the URL or leaked into browser storage',
    );
    await client.call('Network.setCookie', {
      name: CLASSROOM_LINK_SESSION_COOKIE,
      value: publicSession,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    await navigate(client, `${FRONTEND_URL}/check-in`);
    // Who is signed in reads from the header popover now, not a banner over the
    // work, and the old path redirects to /classroom on the way in.
    // The link opens onto the teacher's lessons, one card per lesson, and the
    // register is reached by picking one — the subject is the card, so there is
    // no subject to choose once inside.
    await waitFor(
      async () =>
        String(await evaluate(client, 'window.location.pathname')) === '/classroom' &&
        String(await evaluate(client, 'document.body.textContent')).includes(subjectName),
      'Verified public classroom session did not list the linked lesson',
    );
    assert(
      !(await evaluate(client, `document.body.innerText.includes('เลือกห้องเรียน')`)),
      'Public link exposed a room browser',
    );
    const lessonPath = `/classroom/check-in/${scope.classroom_id}/${fixtureOfferingId}`;
    await evaluate(
      client,
      `(() => {
        const card = [...document.querySelectorAll('a')]
          .find((item) => item.getAttribute('href') === ${JSON.stringify(lessonPath)});
        if (!card) {
          throw new Error('Lesson card not found: ' + JSON.stringify(
            [...document.querySelectorAll('a')].map((item) => item.getAttribute('href')),
          ));
        }
        card.click();
      })()`,
    );
    await waitFor(
      async () => {
        const text = String(await evaluate(client, 'document.body.innerText'));
        return (
          String(await evaluate(client, 'window.location.pathname')).startsWith(
            '/classroom/check-in/',
          ) &&
          text.includes('รายชื่อ') &&
          text.includes('เช็กชื่อ')
        );
      },
      'Verified public classroom session did not open the linked lesson',
    );
    await setDatePicker(client, 'เลือกวันที่เช็กชื่อ', scope.check_in_date);
    assert(
      !(await evaluate(client, `Boolean(document.querySelector('input[aria-label="วิชา"]'))`)),
      'Public classroom link still asked for a subject inside one lesson',
    );
    await waitFor(
      async () => (await visibleRowIds(client)).length === rosterCount,
      'Public classroom-link roster did not render',
    );
    await assertCheckInAvatars(client, '/api/classroom/student-photo');
    await clickButton(client, 'การ์ด');
    await waitFor(
      async () => await evaluate(client, 'Boolean(document.querySelector("[data-active-card=true]"))'),
      'Public card mode did not render',
    );
    assert(
      (await evaluate(client, 'document.querySelectorAll("article").length')) <= 3,
      'Card mode rendered more than the bounded three-card stack',
    );
    assert(
      await evaluate(
        client,
        `(() => {
          const cards = [...document.querySelectorAll('article')];
          const active = cards.find((card) => card.dataset.activeCard === 'true');
          const background = cards.find((card) => card !== active);
          if (!active || !background) return false;
          return Number(getComputedStyle(background).opacity) < 1 &&
            getComputedStyle(active).userSelect === 'none' &&
            active.innerText.includes('รหัสประจำตัว');
        })()`,
      ),
      'Card stack did not expose a faint next card or consistent student-id wording',
    );
    assert(
      await evaluate(client, 'document.documentElement.scrollWidth <= window.innerWidth + 1'),
      'Public check-in page overflowed horizontally on mobile',
    );
    await client.call('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    networkRequests.length = 0;
    const cardRect = await evaluate(
      client,
      `(() => {
        const card = document.querySelector('[data-active-card=true]');
        card.scrollIntoView({ block: 'center' });
        const rect = card.getBoundingClientRect();
        return {
          height: rect.height,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      })()`,
    );
    await client.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: cardRect.x,
      y: cardRect.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await client.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: cardRect.x + 35,
      y: cardRect.y,
      button: 'left',
      buttons: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert(
      await evaluate(client, 'document.documentElement.scrollWidth <= window.innerWidth + 1'),
      'Partial card drag made the public page overflow horizontally',
    );
    await client.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: cardRect.x + 35,
      y: cardRect.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await waitFor(
      async () => await evaluate(
        client,
        `(() => {
          const card = document.querySelector('[data-active-card=true]');
          if (!card) return false;
          const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
          return Math.abs(matrix.m41) < 1 && Math.abs(matrix.m42) < 1 &&
            Math.abs(matrix.m12) < 0.01 && Math.abs(matrix.m21) < 0.01;
        })()`,
      ),
      'Below-threshold card drag did not return to its original position',
    );
    assert((await summaryCount(client, 'ยังไม่เช็ก')) === rosterCount, 'Below-threshold drag changed attendance');
    await client.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: cardRect.x,
      y: cardRect.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await client.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: cardRect.x + 130,
      y: cardRect.y,
      button: 'left',
      buttons: 1,
    });
    await client.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: cardRect.x + 130,
      y: cardRect.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await waitForMarked(client, 1);
    await waitFor(
      async () =>
        requestCount(networkRequests, 'POST', '/api/classroom/sessions/start') === 1,
      'Public swipe did not start exactly one session',
    );
    try {
      await clickButton(client, 'ขาด');
    } catch (error) {
      const buttonState = await evaluate(
        client,
        `[...document.querySelectorAll('button')].map((button) => ({
          text: button.innerText.trim(),
          disabled: button.disabled,
          rendered: button.getClientRects().length > 0,
        }))`,
      );
      throw new Error(`${error.message}: ${JSON.stringify(buttonState)}`);
    }
    await waitForMarked(client, 2);
    await clickButton(client, 'ย้อนกลับ');
    await waitForMarked(client, 1);
    await clickButton(client, 'ขาด');
    await waitForMarked(client, 2);
    assert(
      networkRequests.filter((item) => item.method === 'POST').length === 1,
      `Public swipe/button/undo generated an unexpected write: ${networkRequests
        .filter((item) => item.method === 'POST')
        .map((item) => new URL(item.url).pathname)
        .join(', ')}`,
    );
    for (let marked = 2; marked < rosterCount; marked += 1) {
      if (marked === rosterCount - 1) {
        await waitFor(
          async () => await evaluate(
            client,
            `document.querySelectorAll('[data-completion-card="preview"]').length === 1`,
          ),
          'The completion preview did not replace the final student background card',
        );
        assert(
          await evaluate(
            client,
            `Number(getComputedStyle(document.querySelector('[data-completion-card="preview"]')).opacity) < 1`,
          ),
          'The completion preview was not faint beneath the final student card',
        );
      }
      await clickButton(client, 'มา');
      await waitForMarked(client, marked + 1);
    }
    await waitForMarked(client, rosterCount);
    await waitFor(
      async () => await evaluate(
        client,
        `!document.querySelector('[data-active-card="true"]') &&
          !document.querySelector('[data-completion-card="preview"]') &&
          document.body.innerText.includes('ระบุสถานะครบทุกคนแล้ว') &&
          document.body.innerText.includes('ครบ ${rosterCount} คน')`,
      ),
      'Completion card did not render after the final student',
    );
    const completionMetrics = await evaluate(
      client,
      `(() => {
        const completion = [...document.querySelectorAll('article')]
          .find((article) => article.innerText.includes('ระบุสถานะครบทุกคนแล้ว'));
        return {
          centerX: completion
            ? completion.getBoundingClientRect().left + completion.getBoundingClientRect().width / 2
            : null,
          hasProgress: document.body.innerText.includes('ครบ ${rosterCount} คน'),
          height: completion?.getBoundingClientRect().height ?? null,
          userSelect: completion ? getComputedStyle(completion).userSelect : null,
          viewportWidth: window.innerWidth,
        };
      })()`,
    );
    assert(
      completionMetrics.hasProgress &&
        Math.abs(completionMetrics.height - cardRect.height) < 1 &&
        Math.abs(completionMetrics.centerX - completionMetrics.viewportWidth / 2) < 1 &&
        completionMetrics.userSelect === 'none',
      `Completion card did not preserve the student-card dimensions and progress slot: ${JSON.stringify({ activeHeight: cardRect.height, ...completionMetrics })}`,
    );
    await clickButton(client, 'ตรวจทานก่อนส่ง');
    await waitFor(
      async () => (await visibleRowIds(client)).length === rosterCount,
      'Completion review action did not return to the attendance table',
    );
    await clickButton(client, 'ส่งผลเช็กชื่อ');
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('ส่งแล้ว · อ่านอย่างเดียว'),
      'Public check-in did not submit and become read-only',
    );
    assert(
      networkRequests.filter((item) => item.method === 'POST').length === 2,
      'Public check-in did not use exactly start plus submit writes',
    );
    assert(
      await evaluate(client, 'document.documentElement.scrollWidth <= window.innerWidth + 1'),
      'Submitted public check-in overflowed horizontally on mobile',
    );

    const sessionRows = await dataSource.query(
      `SELECT session.id::text, session.period, session.status,
              session.record_storage_mode,
              (SELECT count(*)::int FROM attendance_exceptions exception WHERE exception.session_id = session.id) AS exception_count,
              (SELECT count(*)::int FROM attendance_session_roster roster WHERE roster.session_id = session.id) AS roster_count
       FROM attendance_sessions session
       WHERE session.classroom_id = $1
         AND session.classroom_subject_id = ANY($2::bigint[])
         AND session.attendance_date = $3
         AND session.period IS NULL
         AND session.deleted_at IS NULL
       ORDER BY session.classroom_subject_id`,
      [
        scope.classroom_id,
        [scope.classroom_subject_id, fixtureOfferingId],
        scope.check_in_date,
      ],
    );
    assert(
      sessionRows.length === 2 &&
        sessionRows.every(
          (row) =>
            row.status === 'SUBMITTED' &&
            row.record_storage_mode === 'EXCEPTIONS' &&
            row.roster_count === rosterCount,
        ),
      'Browser flows did not persist two clean exception-only sessions',
    );
    const [aggregateRows] = await dataSource.query(
      `SELECT
         (SELECT count(*)::int
          FROM attendance_subject_day subject_day
          WHERE subject_day."AttendanceDate" = $3
            AND subject_day.subject_id = ANY($4::bigint[])
            AND subject_day.student_uuid IN (
              SELECT roster.student_uuid
              FROM attendance_session_roster roster
              JOIN attendance_sessions session ON session.id = roster.session_id
              WHERE session.classroom_id = $1
                AND session.school_term_id = $2
                AND session.attendance_date = $3
                AND session.classroom_subject_id = ANY($5::bigint[])
            )) AS subject_day_count,
         (SELECT count(*)::int
          FROM attendance_day day
          WHERE day."AttendanceDate" = $3
            AND day.student_uuid IN (
              SELECT roster.student_uuid
              FROM attendance_session_roster roster
              JOIN attendance_sessions session ON session.id = roster.session_id
              WHERE session.classroom_id = $1
                AND session.school_term_id = $2
                AND session.attendance_date = $3
                AND session.classroom_subject_id = ANY($5::bigint[])
            )) AS day_count,
         to_regclass('public.attendance') IS NULL AS legacy_attendance_dropped`,
      [
        scope.classroom_id,
        scope.school_term_id,
        scope.check_in_date,
        [scope.subject_id, fixtureSubjectId],
        [scope.classroom_subject_id, fixtureOfferingId],
      ],
    );
    assert(
      aggregateRows?.subject_day_count === rosterCount * 2 &&
        aggregateRows?.day_count === rosterCount &&
        aggregateRows?.legacy_attendance_dropped === true,
      'History/risk aggregate views did not expose the two exception-only sessions',
    );
    await client.call('Network.setCookie', {
      name: allowedCookie.name,
      value: allowedCookie.value,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    const historyResponse = await fetchApi(
      client,
      `/api/attendance/history?date=${encodeURIComponent(scope.check_in_date)}` +
        `&schoolId=${encodeURIComponent(scope.school_id)}&sessionKind=SUBJECT`,
    );
    assert(
      historyResponse.status === 200 && Array.isArray(historyResponse.body?.data),
      'Attendance history API did not read the exception-only aggregate contract',
    );
    const riskResponse = await fetchApi(
      client,
      `/api/dashboard/risk-watchlist?schoolId=${encodeURIComponent(scope.school_id)}` +
        '&page=1&limit=10',
    );
    assert(
      riskResponse.status === 200 && Array.isArray(riskResponse.body?.data),
      'Risk dashboard API did not read the post-cutover attendance aggregate contract',
    );

    await dataSource.query(
      `UPDATE classroom_attendance_links SET link_status = 'INACTIVE' WHERE id = $1`,
      [linkId],
    );
    await client.call('Network.deleteCookies', {
      name: CLASSROOM_LINK_SESSION_COOKIE,
      url: BACKEND_URL,
    });
    await navigate(client, `${FRONTEND_URL}/check-in#token=${encodeURIComponent(rawToken)}`);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('ลิงก์นี้ใช้งานไม่ได้'),
      'Revoked public link did not fail closed with a recoverable error state',
    );

    console.error(
      '[smoke] subjects + internal/public exception check-in, history/risk aggregates, grouped absence reason, and no per-mark writes passed',
    );
  } finally {
    await closeChrome(chrome);
    stopProcess(frontend);
    try {
      if (scope) {
        const sessionRows = await dataSource.query(
          `SELECT id::text FROM attendance_sessions
           WHERE classroom_id = $1 AND classroom_subject_id = ANY($2::bigint[])
             AND attendance_date = $3 AND period IS NULL
             AND record_storage_mode = 'EXCEPTIONS'`,
          [
            scope.classroom_id,
            [scope.classroom_subject_id, fixtureOfferingId].filter(Boolean),
            scope.check_in_date,
          ],
        );
        const sessionIds = sessionRows.map((row) => row.id);
        if (sessionIds.length > 0) {
          await dataSource.query(
            `DELETE FROM attendance_exceptions WHERE session_id = ANY($1::uuid[])`,
            [sessionIds],
          );
          await dataSource.query(
            `DELETE FROM attendance_session_roster WHERE session_id = ANY($1::uuid[])`,
            [sessionIds],
          );
          await dataSource.query(
            `DELETE FROM attendance_sessions WHERE id = ANY($1::uuid[])`,
            [sessionIds],
          );
        }
      }
      if (linkId) {
        await dataSource.query(`DELETE FROM classroom_attendance_links WHERE id = $1`, [
          linkId,
        ]);
      }
      if (fixtureSubjectId) {
        await dataSource.query(
          `DELETE FROM classroom_subjects
           WHERE school_subject_id IN (
             SELECT id FROM school_subjects WHERE subject_id = $1
           )`,
          [fixtureSubjectId],
        );
        await dataSource.query(`DELETE FROM school_subjects WHERE subject_id = $1`, [
          fixtureSubjectId,
        ]);
        await dataSource.query(
          `DELETE FROM subjects
           WHERE id = $1
             AND NOT EXISTS (SELECT 1 FROM school_subjects WHERE subject_id = $1)`,
          [fixtureSubjectId],
        );
      }
      if (fixturePhoto) {
        await restoreStudentPhotoFixture(dataSource, storage, fixturePhoto);
      }
      if (fixtureTeacherPhoto) {
        await dataSource.query(
          `UPDATE teachers SET photo_storage_key = $2, updated_at = $3 WHERE id = $1`,
          [
            fixtureTeacherPhoto.teacherId,
            fixtureTeacherPhoto.previousStorageKey,
            fixtureTeacherPhoto.previousUpdatedAt,
          ],
        );
        await storage.delete(fixtureTeacherPhoto.storageKey);
      }
      await dataSource.query(
        `UPDATE users SET status = 'DISABLED', permissions = '[]'::jsonb,
           data_scope = '{"own_only":true}'::jsonb
         WHERE username = ANY($1::text[]) AND data_origin_code = 'AUTOMATED_TEST'`,
        [[ALLOWED_USERNAME, DENIED_USERNAME]],
      );
    } finally {
      await app.close();
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
