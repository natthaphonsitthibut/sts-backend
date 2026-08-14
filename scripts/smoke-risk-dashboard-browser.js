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
  throw new Error('Refusing to run risk dashboard browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9245);
const NAVIGATION_ONLY = process.env.SMOKE_NAVIGATION_ONLY === 'true';
const FOCUSED_UI = process.env.SMOKE_FOCUSED_UI === 'true';
const USERNAME = 'risk_dashboard_browser_smoke';
const MANUAL_CASE_REASON_PREFIX = 'Browser smoke manual case';

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

/**
 * Risk profiles are recalculated off a queue, so a freshly opened case reaches
 * the dashboard a beat after the API answers. Reload between attempts: polling
 * a page that already rendered from stale data can never converge.
 */
async function waitForReload(client, url, check, message, attempts = 8) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await navigate(client, url);
    try {
      // Each attempt still needs its own settle window: the query has to land
      // before the check can mean anything.
      await waitFor(check, message, 4_000);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError ? errorMessage(lastError) : message);
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-risk-dashboard-chrome-'));
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
  if (!chrome) return;
  try {
    chrome.client.close();
  } catch {
    // best-effort cleanup only
  }
  if (chrome.processRef && !chrome.processRef.killed) {
    chrome.processRef.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => chrome.processRef.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }
  if (chrome.userDataDir) {
    fs.rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

async function bodyText(client) {
  return String(await evaluate(client, 'document.body.innerText'));
}

async function capture(client, outputPath) {
  const result = await client.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
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

async function assertLegacyRouteRedirects(client) {
  await navigate(client, `${FRONTEND_URL}/dashboard?source=legacy#summary`);
  await waitFor(
    async () =>
      evaluate(
        client,
        `location.pathname === '/student-risk-report/risk'
          && location.search === '?source=legacy'
          && location.hash === '#summary'`,
      ),
    'Legacy dashboard route did not preserve its search/hash while redirecting',
  );

  const legacyTaskId = '00000000-0000-4000-8000-000000000000';
  await navigate(client, `${FRONTEND_URL}/task-detail/${legacyTaskId}?source=legacy#detail`);
  await waitFor(
    async () =>
      evaluate(
        client,
        `location.pathname === '/tasks/${legacyTaskId}'
          && location.search === '?source=legacy'
          && location.hash === '#detail'`,
      ),
    'Legacy task-detail route did not preserve its id/search/hash while redirecting',
  );

  await navigate(client, `${FRONTEND_URL}/admin-access?next=%2Fstudent-risk-report`);
  await waitFor(
    async () =>
      evaluate(
        client,
        `location.pathname === '/login'
          && location.search === '?next=%2Fstudent-risk-report'`,
      ),
    'Legacy admin access route did not preserve next while redirecting to login',
  );
}

async function upsertActor(dataSource, passwordHash) {
  const permissions = [
    'attendance',
    'attendance-dashboard',
    'audit-log',
    'create',
    'dashboard',
    'edit-students',
    'export-data',
    'home',
    'import-data',
    'import-school-roster',
    'login-links',
    'manage-curriculum',
    'manage-role-groups',
    'manage-school-structure',
    'manage-student-observations',
    'manage-teacher-access',
    'manage-teachers',
    'manage-users-list',
    'review-cases',
    'settings',
    'students',
  ];
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [USERNAME]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'Risk Dashboard',
            "LastName" = 'Browser Smoke',
            status = 'ACTIVE',
            permissions = $3::jsonb,
            role = 'ADMIN',
            data_scope = '{"school_ids":[10010002]}'::jsonb,
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
        WHERE id = $1
      `,
      [existing.id, passwordHash, JSON.stringify(permissions)],
    );
    return Number(existing.id);
  }

  const [created] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, data_origin_code, email, phone
      )
      VALUES (
        $1, $2, 'Risk Dashboard', 'Browser Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        '{"school_ids":[10010002]}'::jsonb, FALSE, 'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [USERNAME, passwordHash, JSON.stringify(permissions)],
  );
  return Number(created.id);
}

async function disableActor(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated risk dashboard browser smoke fixture')
      WHERE username = $1
        AND data_origin_code = 'AUTOMATED_TEST'
    `,
    [USERNAME],
  );
}

// Mirror the page size the dashboard itself renders: the smoke picks the row
// it will then look for in the UI, so reasoning about a shorter list than the
// user sees makes candidates vanish for no visible reason.
async function fetchRiskDashboard(client, sortDirection = 'desc') {
  return evaluate(
    client,
    `(async () => {
      const response = await fetch(${JSON.stringify(
        `${BACKEND_URL}/api/dashboard/risk-watchlist?studentGroup=RISK&limit=20&sortBy=risk&sortDirection=${sortDirection}`,
      )}, { credentials: 'include' });
      const payload = await response.json();
      return { status: response.status, payload };
    })()`,
  );
}

async function assertUserStatusFilterApi(client) {
  const result = await evaluate(
    client,
    `(async () => {
      const validResponse = await fetch(
        ${JSON.stringify(`${BACKEND_URL}/api/users?excludeRole=STUDENT&accountStatus=ACTIVE&limit=10`)},
        { credentials: 'include' },
      );
      const validPayload = await validResponse.json();
      const invalidResponse = await fetch(
        ${JSON.stringify(`${BACKEND_URL}/api/users?excludeRole=STUDENT&accountStatus=UNKNOWN&limit=10`)},
        { credentials: 'include' },
      );
      const rows = Array.isArray(validPayload?.data) ? validPayload.data : [];
      const allActive = rows.every((row) => {
        if (row.status !== 'ACTIVE') return false;
        return row.must_change_password !== true;
      });
      return {
        validStatus: validResponse.status,
        validSuccess: validPayload?.success,
        rowCount: rows.length,
        allActive,
        invalidStatus: invalidResponse.status,
      };
    })()`,
  );
  assert(result.validStatus === 200, `ACTIVE user filter returned ${result.validStatus}`);
  assert(result.validSuccess === true, 'ACTIVE user filter did not return success=true');
  assert(result.rowCount > 0, 'ACTIVE user filter returned no rows for the smoke actor');
  assert(result.allActive, 'ACTIVE user filter returned a different lifecycle status');
  assert(
    result.invalidStatus === 400,
    `Invalid user accountStatus returned ${result.invalidStatus}`,
  );
}

async function clickRiskSortHeader(client) {
  const clicked = await evaluate(
    client,
    `(() => {
      const button = Array.from(document.querySelectorAll('th button'))
        .find((candidate) => candidate.innerText.includes('อัปเดตล่าสุด'));
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert(clicked, 'Updated-at sort header button was not found');
}

async function assertRiskSortDirection(client, direction, label) {
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const header = Array.from(document.querySelectorAll('th[aria-sort="${direction}"]'))
            .find((candidate) => candidate.innerText.includes('อัปเดตล่าสุด'));
          return Boolean(header);
        })()`,
      ),
    `${label} updated-at sort header did not switch to ${direction}`,
  );
}

async function assertRiskSortCleared(client, label) {
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const header = Array.from(document.querySelectorAll('th'))
            .find((candidate) => candidate.innerText.includes('อัปเดตล่าสุด'));
          return Boolean(header && !header.hasAttribute('aria-sort'));
        })()`,
      ),
    `${label} updated-at sort header did not return to the unsorted state`,
  );
}

async function assertVisibleStudentProfileLink(client, label) {
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => Array.from(document.querySelectorAll('a[href*="/students/"]'))
          .some((link) => link.getClientRects().length > 0))()`,
      ),
    `${label} did not expose a visible student profile link`,
  );
}

async function assertAvatarOnlyStudentNavigation(client, label) {
  // Only the avatar link inside a row/card should navigate — clicking the
  // row/card surface itself must NOT trigger navigation anymore.
  const surfaceClickNavigated = await evaluate(
    client,
    `(() => {
      const before = window.location.pathname;
      const surface = Array.from(document.querySelectorAll('[data-student-navigation]'))
        .find((candidate) => candidate.offsetParent !== null);
      if (!surface) return null;
      // Clicking the surface element directly (not a descendant) cannot
      // trigger the nested avatar <a>'s navigation, so this isolates
      // "does the row/card itself still have its own click handler".
      surface.click();
      return window.location.pathname !== before;
    })()`,
  );
  assert(
    surfaceClickNavigated === false,
    `${label} student row/card surface still navigates on click outside the avatar`,
  );

  const clicked = await evaluate(
    client,
    `(() => {
      const surface = Array.from(document.querySelectorAll('[data-student-navigation]'))
        .find((candidate) => candidate.offsetParent !== null);
      const avatarLink = surface?.querySelector('a[href^="/students/"]');
      if (!avatarLink) return false;
      avatarLink.click();
      return true;
    })()`,
  );
  assert(clicked, `${label} did not expose a clickable student avatar`);
  await waitFor(
    async () => evaluate(client, `window.location.pathname.startsWith('/students/')`),
    `${label} student avatar did not navigate to the student detail page`,
  );

  const studentPath = await evaluate(client, 'window.location.pathname');
  const assertContextNavigation = async (expectedParent, expectedMenuRoute, contextLabel) => {
    await waitFor(
      async () =>
        evaluate(
          client,
          `(() => {
            const breadcrumb = document.querySelector('[data-page-breadcrumb]');
            const labels = breadcrumb
              ? [...breadcrumb.querySelectorAll('a, [data-breadcrumb-current]')]
                  .map((node) => node.textContent.trim())
                  .filter(Boolean)
              : [];
            return labels.join(' > ') === ${JSON.stringify(
              `หน้าหลัก > ${expectedParent} > ข้อมูลนักเรียน`,
            )}
              && Boolean(document.querySelector(
                'a[aria-current="page"][href="${expectedMenuRoute}"]',
              ))
              && !document.querySelector(
                'a[aria-current="page"][href="${
                  expectedMenuRoute === '/students' ? '/student-risk-report' : '/students'
                }"]',
              );
          })()`,
        ),
      `${label} ${contextLabel} breadcrumb/sidebar context was incorrect`,
    );
  };

  await assertContextNavigation('รายงานสถานะนักเรียน', '/student-risk-report', 'risk-to-student');
  await client.call('Page.reload', { ignoreCache: true });
  await waitFor(
    async () => evaluate(client, `document.readyState === 'complete'`),
    `${label} student detail did not reload`,
  );
  await assertContextNavigation(
    'รายงานสถานะนักเรียน',
    '/student-risk-report',
    'risk-to-student after refresh',
  );

  await evaluate(
    client,
    `(() => {
      const back = [...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes('ย้อนกลับ'));
      if (!back) throw new Error('Student detail back button not found');
      back.click();
    })()`,
  );
  await waitFor(
    async () => evaluate(client, `window.location.pathname === '/student-risk-report/risk'`),
    `${label} contextual back did not return to the risk dashboard`,
  );

  await navigate(client, `${FRONTEND_URL}${studentPath}`);
  await assertContextNavigation('รายชื่อนักเรียน', '/students', 'direct student fallback');
  await evaluate(
    client,
    `(() => {
      const back = [...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes('ย้อนกลับ'));
      if (!back) throw new Error('Direct student fallback back button not found');
      back.click();
    })()`,
  );
  await waitFor(
    async () => evaluate(client, `window.location.pathname === '/students'`),
    `${label} direct student fallback did not return to the student list`,
  );

  await navigate(client, `${FRONTEND_URL}/student-risk-report`);
  await waitFor(
    async () => (await bodyText(client)).includes('รายงานสถานะนักเรียน'),
    `${label} dashboard did not render again after avatar navigation`,
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => Array.from(document.querySelectorAll('[data-student-navigation]'))
          .some((candidate) => candidate.offsetParent !== null))()`,
      ),
    `${label} dashboard rows did not render again after avatar navigation`,
  );
}

async function assertCanonicalRouteNavigation(client) {
  const routes = [
    ['/student-risk-report/risk', 'รายงานสถานะนักเรียน', '/student-risk-report'],
    ['/student-risk-report/watchlist', 'รายงานสถานะนักเรียน', '/student-risk-report'],
    ['/student-risk-report/teacher-comments', 'ความคิดเห็นจากคุณครู', '/student-risk-report'],
    ['/students', 'รายชื่อนักเรียน', '/students'],
    ['/students/history', 'ประวัติรายชื่อนักเรียน', '/students'],
    ['/students/export', 'ส่งออกข้อมูลนักเรียน', '/students'],
    ['/attendance/roster', 'เช็คชื่อ', '/attendance'],
    ['/attendance/check-in', 'เช็คชื่อ', '/attendance'],
    ['/attendance/history', 'ประวัติการเช็คชื่อ', '/attendance'],
    ['/attendance-links', 'จัดการลิงก์เช็คชื่อ', '/attendance-links'],
    ['/attendance-operations', 'ความครบถ้วน', '/attendance-operations'],
    ['/timetable/rooms', 'ตารางสอน', '/timetable'],
    ['/classrooms', 'ห้องเรียนทั้งหมด', '/classrooms'],
    ['/school-structure', 'จัดการภาคเรียนและห้องเรียน', '/school-structure'],
    ['/import-data', 'นำเข้าข้อมูล', '/import-data'],
    ['/import-data/quarantine', 'รายการรอตรวจสอบ', '/import-data'],
    ['/import-data/history', 'ประวัติการนำเข้า', '/import-data'],
    ['/data-exports', 'ส่งออกข้อมูล', '/data-exports'],
    ['/data-exports/history', 'ประวัติการส่งออก', '/data-exports'],
    ['/manage-users', 'จัดการผู้ใช้งาน', '/manage-users'],
    ['/manage-users/new', 'เพิ่มผู้ใช้งาน', '/manage-users'],
    ['/curriculum', 'จัดการข้อมูลหลักสูตร', '/curriculum'],
    ['/manage-teachers', 'จัดการข้อมูลคุณครู', '/manage-teachers'],
    ['/manage-teachers/new', 'เพิ่มข้อมูลคุณครู', '/manage-teachers'],
    ['/manage-role-groups', 'จัดการกลุ่มเมนู', '/manage-role-groups'],
    ['/settings', 'ตั้งค่าระบบ', '/settings'],
    ['/settings/student-statuses', 'สถานะนักเรียน', '/settings'],
    ['/settings/master-data-lookups', 'ข้อมูลพื้นฐาน', '/settings'],
    ['/profile', 'โปรไฟล์ของฉัน', null],
    ['/notifications', 'การแจ้งเตือน', null],
    ['/change-password', 'เปลี่ยนรหัสผ่าน', null],
  ];

  for (const [route, currentLabel, menuRoute] of routes) {
    await navigate(client, `${FRONTEND_URL}${route}`);
    await waitFor(
      async () =>
        evaluate(
          client,
          `(() => {
            const current = document.querySelector('[data-breadcrumb-current]');
            if (location.pathname !== ${JSON.stringify(route)}
              || current?.textContent.trim() !== ${JSON.stringify(currentLabel)}) return false;
            const activeRoutes = [...document.querySelectorAll('aside a[aria-current="page"]')]
              .filter((link) => link.offsetParent !== null)
              .map((link) => link.getAttribute('href'));
            return ${
              menuRoute === null
                ? 'activeRoutes.length === 0'
                : `activeRoutes.length === 1 && activeRoutes[0] === ${JSON.stringify(menuRoute)}`
            };
          })()`,
        ),
      `Canonical breadcrumb/menu owner was incorrect for ${route}`,
    );
  }
}

async function assertManualCaseFlow(client, row, createdCaseIds) {
  const studentId = String(row.studentId);
  const expectedRiskTier = String(row.riskTier);
  const reason = `${MANUAL_CASE_REASON_PREFIX} ${Date.now()}`;

  await navigate(client, `${FRONTEND_URL}/student-risk-report`);
  assert(row.latestCaseId, 'risk row without an active case did not expose its latest case id');
  try {
    await waitFor(
      async () =>
        evaluate(
          client,
          `(() => {
            const row = Array.from(document.querySelectorAll('[data-student-navigation]'))
              .find((candidate) => candidate.offsetParent !== null
                && candidate.getAttribute('data-student-navigation') === ${JSON.stringify(studentId)});
            return Boolean(
              row?.querySelector(
                'a[aria-label^="ดูรายละเอียดเคสของ "][href="/cases/${String(row.latestCaseId)}"]',
              ) && row?.querySelector('button[aria-label="แชร์ลิงก์"]')
            );
          })()`,
        ),
      'risk dashboard did not expose the canonical case detail/share actions',
    );
  } catch (error) {
    const diagnostic = await evaluate(
      client,
      `({
        path: location.pathname,
        rows: [...document.querySelectorAll('[data-student-navigation]')]
          .filter((row) => row.offsetParent !== null)
          .map((row) => ({
            studentId: row.getAttribute('data-student-navigation'),
            actions: [...row.querySelectorAll('button[aria-label]')]
              .map((button) => button.getAttribute('aria-label'))
          }))
      })`,
    );
    throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
  }
  await navigate(client, `${FRONTEND_URL}/students/${studentId}`);
  await waitFor(
    async () =>
      evaluate(
        client,
        `document.querySelector('[data-student-risk-tier]')
          ?.getAttribute('data-student-risk-tier') === ${JSON.stringify(expectedRiskTier)}`,
      ),
    `student detail did not render persisted risk tier ${expectedRiskTier}`,
  );
  const riskBadgeColor = await evaluate(
    client,
    `getComputedStyle(document.querySelector('[data-student-risk-tier]')).color`,
  );
  const riskTierColorClass = {
    HIGH: 'text-danger',
    WATCH: 'text-brand-orange',
    NORMAL: 'text-success',
  }[expectedRiskTier];
  const expectedRiskBadgeColor = await evaluate(
    client,
    `(() => {
      const probe = document.createElement('span');
      probe.className = ${JSON.stringify(riskTierColorClass)};
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    })()`,
  );
  assert(
    riskBadgeColor === expectedRiskBadgeColor,
    `student risk badge ${expectedRiskTier} used ${riskBadgeColor}`,
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        `Boolean(document.querySelector('button[aria-label="เปิดเคสติดตามนักเรียน"]'))`,
      ),
    'student detail did not expose the manual case action',
  );
  await evaluate(
    client,
    `document.querySelector('button[aria-label="เปิดเคสติดตามนักเรียน"]')?.click()`,
  );
  await waitFor(
    async () => evaluate(client, `Boolean(document.querySelector('#open-case-reason'))`),
    'student detail case dialog did not render',
  );
  await evaluate(
    client,
    `(() => {
      const textarea = document.querySelector('#open-case-reason');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, ${JSON.stringify(reason)});
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  );
  await evaluate(
    client,
    `Array.from(document.querySelectorAll('[role="dialog"] button'))
      .find((button) => button.innerText.trim() === 'เปิดเคส')?.click()`,
  );
  await waitFor(
    async () => evaluate(client, `window.location.pathname.startsWith('/cases/')`),
    'opening a case did not navigate to case detail',
  );
  await waitFor(async () => {
    const text = await bodyText(client);
    return text.includes('เหตุผลที่เปิดเคส') && text.includes(reason);
  }, 'case detail did not render the submitted reason');

  const detailStatus = await evaluate(
    client,
    `(() => {
      const label = [...document.querySelectorAll('span')].find(
        (node) => node.textContent?.trim() === 'รอมอบหมาย'
          && node.parentElement?.textContent?.includes('สถานะการติดตาม'),
      );
      if (!label) return null;
      const style = getComputedStyle(label);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        text: label.textContent?.trim(),
      };
    })()`,
  );
  assert(detailStatus, 'case detail did not render the OPEN status text');
  assert(
    detailStatus.text === 'รอมอบหมาย',
    `OPEN detail status used unexpected label ${detailStatus.text}`,
  );
  assert(
    detailStatus.color === 'rgb(245, 158, 11)',
    `OPEN detail status used ${detailStatus.color} instead of #F59E0B`,
  );
  assert(
    detailStatus.backgroundColor === 'rgba(0, 0, 0, 0)' && detailStatus.borderWidth === '0px',
    `OPEN detail status unexpectedly used badge chrome background=${detailStatus.backgroundColor} border=${detailStatus.borderWidth}`,
  );

  const caseId = Number(
    await evaluate(client, `Number(window.location.pathname.split('/').filter(Boolean).at(-1))`),
  );
  assert(Number.isInteger(caseId) && caseId > 0, 'opened case id was invalid');
  createdCaseIds.push(caseId);

  const tableBadge = await evaluate(
    client,
    `(() => {
      const table = document.createElement('div');
      table.setAttribute('data-slot', 'data-table');
      const badge = document.createElement('span');
      badge.setAttribute('data-slot', 'badge');
      badge.setAttribute('data-case-status', 'OPEN');
      badge.setAttribute('data-variant', 'secondary');
      badge.textContent = 'รอมอบหมาย';
      table.appendChild(badge);
      document.body.appendChild(table);
      const style = getComputedStyle(badge);
      const result = {
        color: style.color,
        borderColor: style.borderTopColor,
        backgroundColor: style.backgroundColor,
      };
      table.remove();
      return result;
    })()`,
  );
  assert(tableBadge, 'case table badge treatment could not be verified');
  assert(
    tableBadge.color === 'rgb(245, 158, 11)' && tableBadge.borderColor === tableBadge.color,
    `OPEN table badge used color=${tableBadge.color} border=${tableBadge.borderColor}`,
  );
  assert(
    tableBadge.backgroundColor !== detailStatus.backgroundColor,
    'case table and detail badges unexpectedly used the same visual treatment',
  );

  const duplicate = await evaluate(
    client,
    `(async () => {
      const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/cases`)}, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: ${JSON.stringify(studentId)}, reason: ${JSON.stringify(reason)} }),
      });
      return { status: response.status, payload: await response.json() };
    })()`,
  );
  assert(duplicate.status === 200, `duplicate manual case request returned ${duplicate.status}`);
  assert(
    duplicate.payload?.created === false,
    'duplicate manual case request created another case',
  );
  assert(Number(duplicate.payload?.data?.id) === caseId, 'duplicate request returned another case');

  try {
    await waitForReload(
      client,
      `${FRONTEND_URL}/student-risk-report`,
      async () =>
        evaluate(
          client,
          `(() => {
            const row = Array.from(document.querySelectorAll('[data-student-navigation]'))
              .find((candidate) => candidate.offsetParent !== null
                && candidate.getAttribute('data-student-navigation') === ${JSON.stringify(studentId)});
            return Boolean(row?.querySelector(
              'a[aria-label^="ดูรายละเอียดเคสของ "][href="/cases/${caseId}"]',
            ));
          })()`,
        ),
      'risk dashboard did not expose the active case detail action',
    );
  } catch (error) {
    const diagnostic = await evaluate(
      client,
      `(() => {
        const row = Array.from(document.querySelectorAll('[data-student-navigation]'))
          .find((candidate) => candidate.offsetParent !== null
            && candidate.getAttribute('data-student-navigation') === ${JSON.stringify(studentId)});
        return {
          path: location.pathname,
          rowText: row?.innerText ?? null,
          buttons: row ? [...row.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')) : [],
        };
      })()`,
    );
    throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
  }
  await evaluate(
    client,
    `(() => {
      const row = Array.from(document.querySelectorAll('[data-student-navigation]'))
        .find((candidate) => candidate.offsetParent !== null
          && candidate.getAttribute('data-student-navigation') === ${JSON.stringify(studentId)});
      row?.querySelector('a[aria-label^="ดูรายละเอียดเคสของ "][href="/cases/${caseId}"]')?.click();
    })()`,
  );
  await waitFor(
    async () =>
      evaluate(client, `window.location.pathname === ${JSON.stringify(`/cases/${caseId}`)}`),
    'active case detail action did not navigate to the selected case',
  );
  await capture(client, '/tmp/sts-manual-case-detail.png');
}

/**
 * A run that dies mid-flow leaves its case behind, and that leftover occupies
 * one of the few top-ranked students the next run needs to pick from — so the
 * failure compounds into "no student without an active case". Sweep this
 * actor's own debris before starting.
 */
async function purgeStaleManualCases(dataSource, actorId) {
  if (!actorId) return;
  const stale = await dataSource.query(
    `SELECT id FROM cases WHERE created_by = $1 AND reason_flagged LIKE $2`,
    [actorId, `${MANUAL_CASE_REASON_PREFIX}%`],
  );
  await cleanupManualCases(
    dataSource,
    stale.map((row) => Number(row.id)),
    actorId,
  );
}

async function cleanupManualCases(dataSource, caseIds, actorId) {
  if (caseIds.length === 0 || !actorId) return;
  const ids = caseIds.map(String);
  await dataSource.query(
    `DELETE FROM notifications WHERE ref_entity = 'case' AND ref_id = ANY($1::text[])`,
    [ids],
  );
  // audit_log is append-only by design (a trigger rejects DELETE), so the
  // CASE_CREATE entries stay. They carry this smoke's actor, which is the
  // record we want anyway.
  // Read the owners before the delete rather than through RETURNING: the row
  // shape TypeORM hands back for a DELETE is not worth guessing, and guessing
  // wrong makes the refresh below silently do nothing.
  const owners = await dataSource.query(
    `SELECT DISTINCT student_uuid FROM cases WHERE id = ANY($1::int[]) AND created_by = $2`,
    [caseIds, actorId],
  );
  await dataSource.query(`DELETE FROM cases WHERE id = ANY($1::int[]) AND created_by = $2`, [
    caseIds,
    actorId,
  ]);

  // student_risk_profiles caches the open-case columns, and deleting the row
  // underneath it does not refresh that cache. Left stale, the next run sees a
  // student who still "has" a case that no longer exists and can run out of
  // candidates. Recompute the two columns the same way the recalculation does.
  const studentUuids = [...new Set(owners.map((row) => row.student_uuid).filter(Boolean))];
  if (studentUuids.length === 0) return;
  await dataSource.query(
    `UPDATE student_risk_profiles profile
     SET open_case_count = COALESCE(summary.open_case_count, 0),
         latest_open_case_id = summary.latest_open_case_id
     FROM (
       SELECT uuids.student_uuid,
              COUNT(c.id)::int AS open_case_count,
              (array_agg(c.id ORDER BY c.created_at DESC, c.id DESC)
                FILTER (WHERE c.id IS NOT NULL))[1] AS latest_open_case_id
       FROM UNNEST($1::uuid[]) AS uuids(student_uuid)
       LEFT JOIN cases c
         ON c.student_uuid = uuids.student_uuid
        AND c.deleted_at IS NULL
        AND c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
       GROUP BY uuids.student_uuid
     ) summary
     WHERE profile.student_uuid = summary.student_uuid`,
    [studentUuids],
  );
}

async function assertCanonicalPageWidths(client) {
  const routes = ['/student-risk-report', '/manage-users'];
  const widths = [];
  for (const route of routes) {
    await navigate(client, `${FRONTEND_URL}${route}`);
    await waitFor(
      async () =>
        evaluate(
          client,
          `Boolean(document.querySelector('[data-page-container="authenticated"]'))`,
        ),
      `Authenticated page container did not render for ${route}`,
    );
    widths.push(
      await evaluate(
        client,
        `getComputedStyle(document.querySelector('[data-page-container="authenticated"]')).maxWidth`,
      ),
    );
  }
  assert(
    widths.every((width) => width === '1700px'),
    `Authenticated page widths drifted: ${routes.map((route, index) => `${route}=${widths[index]}`).join(', ')}`,
  );
}

async function assertStatusSummaryCardFilters(client) {
  // These roster pages use fixed summaries; only this route keeps selectable cards.
  const routes = ['/student-risk-report/risk'];

  for (const route of routes) {
    await navigate(client, `${FRONTEND_URL}${route}`);
    try {
      await waitFor(
        async () =>
          evaluate(
            client,
            `(() => {
              const card = Array.from(document.querySelectorAll('button[aria-pressed="false"]'))
                .find((candidate) => candidate.offsetParent !== null
                  && candidate.getAttribute('data-summary-label'));
              return Boolean(card);
            })()`,
          ),
        `No selectable status summary card rendered for ${route}`,
      );
    } catch (error) {
      const context = await evaluate(
        client,
        `({ pathname: location.pathname, text: document.body.innerText.slice(0, 500), cards:
          Array.from(document.querySelectorAll('button[data-summary-label]')).map((button) => ({
            label: button.getAttribute('data-summary-label'),
            pressed: button.getAttribute('aria-pressed'),
            visible: button.offsetParent !== null,
          })) })`,
      );
      throw new Error(`${errorMessage(error)}; context=${JSON.stringify(context)}`);
    }
    const cardLabel = await evaluate(
      client,
      `(() => {
        const card = Array.from(document.querySelectorAll('button[aria-pressed="false"]'))
          .find((candidate) => candidate.offsetParent !== null
            && candidate.getAttribute('data-summary-label'));
        if (!card) return null;
        const label = card.getAttribute('data-summary-label');
        card.click();
        return label;
      })()`,
    );
    assert(cardLabel, `Selectable status summary card had no stable label for ${route}`);
    try {
      await waitFor(
        async () =>
          evaluate(
            client,
            `(() => Array.from(document.querySelectorAll('button[aria-pressed="true"]'))
              .some((candidate) => candidate.offsetParent !== null
                && candidate.getAttribute('data-summary-label') === ${JSON.stringify(cardLabel)}))()`,
          ),
        `Status summary card did not select its filter for ${route}`,
      );
    } catch (error) {
      const states = await evaluate(
        client,
        `(() => Array.from(document.querySelectorAll('button[data-summary-label]')).map((button) => ({
          label: button.getAttribute('data-summary-label'),
          pressed: button.getAttribute('aria-pressed'),
          visible: button.offsetParent !== null,
        })))()`,
      );
      throw new Error(
        `${errorMessage(error)}; card=${cardLabel}; states=${JSON.stringify(states)}`,
      );
    }
    const toggledOff = await evaluate(
      client,
      `(() => {
        const card = Array.from(document.querySelectorAll('button[aria-pressed="true"]'))
          .find((candidate) => candidate.offsetParent !== null
            && candidate.getAttribute('data-summary-label') === ${JSON.stringify(cardLabel)});
        if (!card) return false;
        card.click();
        return true;
      })()`,
    );
    assert(toggledOff, `Selected status summary card disappeared for ${route}`);
    await waitFor(
      async () =>
        evaluate(
          client,
          `(() => Array.from(document.querySelectorAll('button[aria-pressed="false"]'))
            .some((candidate) => candidate.offsetParent !== null
              && candidate.getAttribute('data-summary-label') === ${JSON.stringify(cardLabel)}))()`,
        ),
      `Status summary card did not clear its filter for ${route}`,
    );
  }
}

async function assertSummaryFilterToggle(client, label) {
  const selected = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('button[aria-label="กรองสถานะรอมอบหมาย"]');
      if (!button || button.getAttribute('aria-pressed') !== 'false') return false;
      button.click();
      return true;
    })()`,
  );
  assert(selected, `${label} open-case summary filter was not initially selectable`);
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => document.querySelector('button[aria-label="กรองสถานะรอมอบหมาย"]')
          ?.getAttribute('aria-pressed') === 'true')()`,
      ),
    `${label} open-case summary did not expose its selected state`,
  );

  const cleared = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('button[aria-label="กรองสถานะรอมอบหมาย"]');
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert(cleared, `${label} open-case summary filter could not be toggled off`);
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => document.querySelector('button[aria-label="กรองสถานะรอมอบหมาย"]')
          ?.getAttribute('aria-pressed') === 'false')()`,
      ),
    `${label} open-case summary did not clear its selected state`,
  );
}

async function assertMobileFilterReset(client, expectedStudentName) {
  const selected = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('button[aria-label="กรองสถานะรอมอบหมาย"]');
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert(selected, 'mobile high-risk summary filter was not selectable');
  await waitFor(
    async () => (await bodyText(client)).includes('ล้างทั้งหมด'),
    'mobile active-filter summary did not expose clear-all',
  );

  const reset = await evaluate(
    client,
    `(() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((candidate) => candidate.offsetParent !== null && candidate.innerText.includes('ล้างทั้งหมด'));
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert(reset, 'mobile clear-all button was not clickable');
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => document.querySelector('button[aria-label="กรองสถานะรอมอบหมาย"]')
          ?.getAttribute('aria-pressed') === 'false')()`,
      ),
    'mobile clear-all did not reset the risk summary selection',
  );
  await waitFor(
    async () => (await bodyText(client)).includes(expectedStudentName),
    'mobile clear-all did not restore the default result list',
  );
}

async function assertCollapsedGroupAccordion(client) {
  await navigate(client, `${FRONTEND_URL}/attendance`);
  await waitFor(
    async () => (await bodyText(client)).includes('เช็คชื่อ'),
    'Attendance page did not render before sidebar verification',
  );

  const persistedExpanded = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('button[aria-label="ขยายเมนูด้านข้าง"]');
      button?.click();
      return Boolean(button || document.querySelector('button[aria-label="พับเมนูด้านข้าง"]'));
    })()`,
  );
  assert(persistedExpanded, 'desktop sidebar expansion control was not found');
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const sidebar = document.querySelector('aside');
          return Boolean(sidebar && Number.parseFloat(getComputedStyle(sidebar).width) >= 259);
        })()`,
      ),
    'desktop sidebar did not finish expanding to 260px',
  );

  const collapsedActiveGroup = await evaluate(
    client,
    `(() => {
      const button = Array.from(document.querySelectorAll('aside button'))
        .find((candidate) => candidate.innerText.includes('ระบบเช็คชื่อ'));
      if (!button || button.getAttribute('aria-expanded') !== 'true') return false;
      button.click();
      return true;
    })()`,
  );
  assert(collapsedActiveGroup, 'active attendance group was not initially expanded');
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => Array.from(document.querySelectorAll('aside button'))
          .some((button) => button.innerText.includes('ระบบเช็คชื่อ')
            && button.getAttribute('aria-expanded') === 'false'))()`,
      ),
    'active attendance group could not be collapsed',
  );
  const reopenedActiveGroup = await evaluate(
    client,
    `(() => {
      const button = Array.from(document.querySelectorAll('aside button'))
        .find((candidate) => candidate.innerText.includes('ระบบเช็คชื่อ'));
      button?.click();
      return Boolean(button);
    })()`,
  );
  assert(reopenedActiveGroup, 'active attendance group could not be reopened');

  const collapsed = await evaluate(
    client,
    `(() => {
      const collapseButton = document.querySelector('button[aria-label="พับเมนูด้านข้าง"]');
      if (collapseButton) collapseButton.click();
      return Boolean(
        collapseButton || document.querySelector('button[aria-label="ขยายเมนูด้านข้าง"]'),
      );
    })()`,
  );
  assert(collapsed, 'desktop sidebar could not be collapsed');
  await waitFor(
    async () =>
      evaluate(client, `Boolean(document.querySelector('button[aria-label="ขยายเมนูด้านข้าง"]'))`),
    'desktop sidebar did not expose its collapsed state',
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const sidebar = document.querySelector('aside');
          return Boolean(sidebar && getComputedStyle(sidebar).width === '80px');
        })()`,
      ),
    'desktop sidebar did not finish collapsing to 80px',
  );

  const collapsedState = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('aside button[aria-label="ระบบเช็คชื่อ"]');
      const main = document.querySelector('main');
      return {
        active: button?.getAttribute('aria-current') === 'page',
        background: button ? getComputedStyle(button).backgroundColor : null,
        mainLeft: main?.getBoundingClientRect().left ?? null,
        transitionDuration: document.querySelector('aside')
          ? getComputedStyle(document.querySelector('aside')).transitionDuration
          : null,
      };
    })()`,
  );
  assert(collapsedState.active, 'collapsed sidebar did not mark the active attendance parent');
  assert(
    collapsedState.background === 'rgb(231, 237, 248)',
    `collapsed attendance parent active surface drifted: ${collapsedState.background}`,
  );
  assert(
    String(collapsedState.transitionDuration).includes('0.3s'),
    `sidebar hover transition was not 300ms: ${collapsedState.transitionDuration}`,
  );

  const sidebarPoint = await evaluate(
    client,
    `(() => {
      const rect = document.querySelector('aside')?.getBoundingClientRect();
      return rect ? { x: rect.left + 40, y: rect.top + 120 } : null;
    })()`,
  );
  assert(sidebarPoint, 'collapsed sidebar bounds were not available');
  await client.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: sidebarPoint.x,
    y: sidebarPoint.y,
  });
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const sidebar = document.querySelector('aside');
          return Boolean(sidebar && Number.parseFloat(getComputedStyle(sidebar).width) >= 259);
        })()`,
      ),
    'collapsed sidebar did not smoothly expand on hover',
  );
  const hoverState = await evaluate(
    client,
    `(() => {
      const child = document.querySelector('aside a[href="/attendance"]');
      const sidebar = document.querySelector('aside');
      const main = document.querySelector('main');
      return {
        childVisible: Boolean(child && child.offsetParent !== null),
        mainLeft: main?.getBoundingClientRect().left ?? null,
        sidebarRight: sidebar?.getBoundingClientRect().right ?? null,
        sidebarWidth: sidebar ? Number.parseFloat(getComputedStyle(sidebar).width) : null,
      };
    })()`,
  );
  assert(
    hoverState.childVisible && hoverState.sidebarWidth >= 259,
    `hover-expanded attendance group was not visible: ${JSON.stringify(hoverState)}`,
  );
  assert(
    hoverState.mainLeft >= 259 && hoverState.sidebarRight === hoverState.mainLeft,
    `sidebar hover overlapped main layout: ${JSON.stringify({ before: collapsedState.mainLeft, after: hoverState.mainLeft, sidebarRight: hoverState.sidebarRight })}`,
  );

  await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1000, y: 200 });
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const sidebar = document.querySelector('aside');
          const main = document.querySelector('main');
          return Boolean(
            sidebar
            && getComputedStyle(sidebar).width === '80px'
            && main?.getBoundingClientRect().left === ${JSON.stringify(collapsedState.mainLeft)}
          );
        })()`,
      ),
    'sidebar did not smoothly return to the collapsed rail',
  );

  await navigate(client, `${FRONTEND_URL}/student-risk-report`);
  await waitFor(
    async () => (await bodyText(client)).includes('รายงานสถานะนักเรียน'),
    'Risk dashboard did not restore after sidebar verification',
  );
}

async function assertHeaderProfileMenu(client) {
  const headerState = await evaluate(
    client,
    `(() => ({
      hasSettingsShortcut: Boolean(document.querySelector('header a[aria-label="ตั้งค่าระบบ"]')),
      opened: (() => {
        const trigger = document.querySelector('header button[aria-label^="เปิดเมนูบัญชีผู้ใช้"]');
        if (!trigger) return false;
        trigger.click();
        return true;
      })(),
    }))()`,
  );
  assert(!headerState.hasSettingsShortcut, 'header still exposed the duplicate settings shortcut');
  assert(headerState.opened, 'header profile menu trigger was not found');
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const menu = document.querySelector('[role="menu"][aria-label="บัญชีผู้ใช้"]');
          return Boolean(
            menu
            && menu.innerText.includes('แก้ไขข้อมูลส่วนตัว')
            && menu.innerText.includes('ออกจากระบบ')
          );
        })()`,
      ),
    'header profile dropdown did not expose profile and logout actions',
  );
  await capture(client, '/tmp/sts-header-profile-menu.png');
  await evaluate(
    client,
    `(() => {
      const trigger = document.querySelector('header button[aria-label^="เปิดเมนูบัญชีผู้ใช้"]');
      trigger?.click();
      trigger?.focus();
      trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    })()`,
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        `document.activeElement?.getAttribute('role') === 'menuitem'
          && document.activeElement?.innerText.includes('แก้ไขข้อมูลส่วนตัว')`,
      ),
    'ArrowDown did not open the header profile menu and focus its first action',
  );
  const keyboardState = await evaluate(
    client,
    `(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
      return {
        focusedLogout: document.activeElement?.innerText.includes('ออกจากระบบ'),
      };
    })()`,
  );
  assert(keyboardState.focusedLogout, 'ArrowDown did not move focus to the next profile action');
  await evaluate(
    client,
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const trigger = document.querySelector('header button[aria-label^="เปิดเมนูบัญชีผู้ใช้"]');
          return !document.querySelector('[role="menu"][aria-label="บัญชีผู้ใช้"]')
            && document.activeElement === trigger;
        })()`,
      ),
    'Escape did not close the profile menu and restore trigger focus',
  );
}

async function setMobileSort(client, value) {
  const selected = await evaluate(
    client,
    `(() => {
      const select = Array.from(document.querySelectorAll('select'))
        .find((candidate) => candidate.getAttribute('aria-label') === 'เรียงลำดับรายงานนักเรียน');
      if (!select) return null;
      select.value = ${JSON.stringify(value)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value;
    })()`,
  );
  assert(selected === value, `Mobile sort select did not accept ${value}`);
}

async function assertRiskDashboard(client, expectedStudentName, expectedTotalCount, label) {
  await navigate(client, `${FRONTEND_URL}/student-risk-report`);
  await waitFor(
    async () => (await bodyText(client)).includes('รายงานสถานะนักเรียน'),
    `${label} risk dashboard title did not render`,
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        `Boolean(document.querySelector('button[aria-label="กรองสถานะรอมอบหมาย"]'))`,
      ),
    `${label} case-status summary controls did not render`,
  );
  const text = await bodyText(client);
  assert(text.includes('ไม่พบนักเรียน'), `${label} student-not-found summary was missing`);
  assert(text.includes('รอมอบหมาย'), `${label} open-case summary was missing`);
  assert(text.includes('รอติดตาม'), `${label} in-progress summary was missing`);
  assert(text.includes('รอพิจารณา'), `${label} pending-review summary was missing`);
  assert(!text.includes('ไม่สามารถโหลดรายงานนักเรียนได้'), `${label} rendered error state`);
  await waitFor(
    async () => (await bodyText(client)).includes(expectedStudentName),
    `${label} did not render first API student ${expectedStudentName}`,
  );
  await waitFor(async () => {
    const nextText = await bodyText(client);
    return (
      nextText.includes(expectedTotalCount.toLocaleString()) ||
      nextText.includes(String(expectedTotalCount))
    );
  }, `${label} did not render total count ${expectedTotalCount}`);

  if (label.startsWith('desktop')) {
    const actionState = await evaluate(
      client,
      `(() => {
        const visibleTable = Array.from(document.querySelectorAll('table'))
          .find((table) => table.offsetParent !== null);
        const rows = visibleTable
          ? Array.from(visibleTable.querySelectorAll('tbody tr')).filter((row) => row.offsetParent !== null)
          : [];
        const rowActions = rows.map((row) => {
          const cell = row.lastElementChild;
          const controls = cell
            ? Array.from(cell.querySelectorAll('button, a[href]')).filter((control) => control.offsetParent !== null)
            : [];
          return controls.map((control) => ({
            background: getComputedStyle(control).backgroundColor,
            color: getComputedStyle(control).color,
            height: control.getBoundingClientRect().height,
            width: control.getBoundingClientRect().width,
          }));
        });
        return {
          actionHeading: visibleTable
            ? Array.from(visibleTable.querySelectorAll('thead th')).at(-1)?.innerText.trim()
            : null,
          rowActions,
        };
      })()`,
    );
    assert(actionState.actionHeading === 'เครื่องมือ', 'Risk action heading was not เครื่องมือ');
    assert(actionState.rowActions.length > 0, 'Risk table had no visible action rows');
    assert(
      actionState.rowActions.every(
        (actions) =>
          actions.length === 2 &&
          actions.every(
            (action) =>
              action.width === 40 &&
              action.height === 40 &&
              action.color === 'rgb(255, 255, 255)' &&
              action.background !== 'rgba(0, 0, 0, 0)',
          ),
      ),
      `Risk action slots drifted: ${JSON.stringify(actionState.rowActions.slice(0, 3))}`,
    );
  } else if (label.startsWith('mobile')) {
    const mobileActions = await evaluate(
      client,
      `(() => Array.from(document.querySelectorAll('[data-student-navigation]'))
        .filter((row) => row.offsetParent !== null)
        .map((row) => Array.from(row.lastElementChild?.querySelectorAll('button, a[aria-label]') || [])
          .filter((control) => control.offsetParent !== null)
          .map((control) => ({
            height: control.getBoundingClientRect().height,
            width: control.getBoundingClientRect().width,
          }))))()`,
    );
    assert(mobileActions.length > 0, 'Mobile risk cards had no visible action rows');
    assert(
      mobileActions.every(
        (actions) =>
          actions.length === 2 &&
          actions.every((action) => action.width === 40 && action.height === 40),
      ),
      `Mobile risk action slots drifted: ${JSON.stringify(mobileActions.slice(0, 3))}`,
    );
  }
}

async function assertSharedVisualSystem(client) {
  const colors = await evaluate(
    client,
    `(() => {
      const breadcrumb = document.querySelector('nav[aria-label="เส้นทางนำทาง"]');
      const previousPage = breadcrumb?.querySelector('a');
      const currentPage = breadcrumb?.querySelector('[aria-current="page"]');
      const description = breadcrumb?.parentElement?.querySelector('p');
      const tableHeading = document.querySelector('table thead th');
      const tableHeadingRow = tableHeading?.closest('tr');
      const main = document.querySelector('main');
      const notificationTrigger = document.querySelector('header button[aria-label^="รายการแจ้งเตือน"]');
      const profileTrigger = document.querySelector('header button[aria-label^="เปิดเมนูบัญชีผู้ใช้"]');
      const activeNavigation = document.querySelector('aside a[aria-current="page"]');
      const refreshButton = Array.from(document.querySelectorAll('button'))
        .find((button) => button.innerText.trim() === 'รีเฟรช');
      return {
        pageBackground: main ? getComputedStyle(main).backgroundColor : null,
        previousPage: previousPage ? getComputedStyle(previousPage).color : null,
        currentPage: currentPage ? getComputedStyle(currentPage).color : null,
        description: description ? getComputedStyle(description).color : null,
        tableHeadingBackground: tableHeadingRow
          ? getComputedStyle(tableHeadingRow).backgroundColor
          : null,
        tableHeadingText: tableHeading ? getComputedStyle(tableHeading).color : null,
        tableHeadingHeight: tableHeading ? getComputedStyle(tableHeading).height : null,
        notificationSurface: notificationTrigger
          ? getComputedStyle(notificationTrigger).backgroundColor
          : null,
        profileSurface: profileTrigger?.firstElementChild
          ? getComputedStyle(profileTrigger.firstElementChild).backgroundColor
          : null,
        activeNavigationSurface: activeNavigation
          ? getComputedStyle(activeNavigation).backgroundColor
          : null,
        refreshBackground: refreshButton ? getComputedStyle(refreshButton).backgroundColor : null,
        refreshText: refreshButton ? getComputedStyle(refreshButton).color : null,
        refreshBorder: refreshButton ? getComputedStyle(refreshButton).borderColor : null,
      };
    })()`,
  );
  assert(
    colors.pageBackground === 'rgb(250, 250, 250)',
    `Shared page background drifted: ${colors.pageBackground}`,
  );
  // --color-breadcrumb-muted (#525252) from the shared token sheet.
  assert(
    colors.previousPage === 'rgb(82, 82, 82)',
    `Previous breadcrumb ink drifted: ${colors.previousPage}`,
  );
  assert(colors.currentPage === 'rgb(17, 17, 17)', `Breadcrumb ink drifted: ${colors.currentPage}`);
  // PageToolbar no longer renders a description paragraph (descriptions live
  // in page content), so there is no description ink to pin here.
  assert(
    colors.tableHeadingBackground === 'rgb(15, 73, 189)' &&
      colors.tableHeadingText === 'rgb(255, 255, 255)' &&
      Number.parseFloat(colors.tableHeadingHeight) >= 48,
    `Table heading colors drifted: ${JSON.stringify(colors)}`,
  );
  // The profile trigger now renders the shared Avatar (photo or gradient
  // initial) instead of a brand-soft tile, so only the notification tile
  // keeps the brand surface.
  assert(
    colors.notificationSurface === 'rgb(226, 233, 247)',
    `Header brand surfaces drifted: ${JSON.stringify(colors)}`,
  );
  assert(
    colors.activeNavigationSurface === 'rgb(231, 237, 248)',
    `Active navigation surface drifted: ${colors.activeNavigationSurface}`,
  );
  if (colors.refreshBackground !== null) {
    assert(
      colors.refreshBackground === 'rgb(255, 255, 255)' &&
        colors.refreshText === 'rgb(17, 17, 17)' &&
        colors.refreshBorder === 'rgb(221, 221, 221)',
      `Refresh button colors drifted: ${JSON.stringify(colors)}`,
    );
  }

  // Manage-users lost its tabs in the roster redesign; the risk report keeps
  // the shared underline Tabs (กลุ่มเสี่ยง / กลุ่มเฝ้าระวัง).
  await navigate(client, `${FRONTEND_URL}/student-risk-report`);
  await waitFor(
    async () => evaluate(client, `Boolean(document.querySelector('[role="tab"]'))`),
    'Risk report tabs did not render',
  );
  const tabColors = await evaluate(
    client,
    `(() => {
      const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
      const inactiveTab = document.querySelector('[role="tab"][aria-selected="false"]');
      return {
        activeText: activeTab ? getComputedStyle(activeTab).color : null,
        activeUnderline: activeTab ? getComputedStyle(activeTab).borderBottomColor : null,
        inactiveText: inactiveTab ? getComputedStyle(inactiveTab).color : null,
      };
    })()`,
  );
  assert(
    tabColors.activeText === 'rgb(15, 73, 189)' &&
      tabColors.activeUnderline === 'rgb(15, 73, 189)' &&
      tabColors.inactiveText === 'rgb(17, 17, 17)',
    `Underline tab colors drifted: ${JSON.stringify(tabColors)}`,
  );

  await navigate(client, `${FRONTEND_URL}/`);
  await waitFor(
    async () =>
      evaluate(
        client,
        `Boolean(document.querySelector('nav[aria-label="เส้นทางนำทาง"] [aria-current="page"]'))`,
      ),
    'Home breadcrumb did not render',
  );
  const homeInk = await evaluate(
    client,
    `getComputedStyle(document.querySelector('nav[aria-label="เส้นทางนำทาง"] [aria-current="page"]')).color`,
  );
  assert(homeInk === 'rgb(17, 17, 17)', `Home breadcrumb ink drifted: ${homeInk}`);
  const homeBrandTile = await evaluate(
    client,
    `(() => {
      const tile = document.querySelector('main .bg-brand-soft');
      return tile ? getComputedStyle(tile).backgroundColor : null;
    })()`,
  );
  if (homeBrandTile !== null) {
    assert(
      homeBrandTile === 'rgb(226, 233, 247)',
      `Home blue-icon surface drifted: ${homeBrandTile}`,
    );
  }
  await navigate(client, `${FRONTEND_URL}/student-risk-report`);
  await waitFor(
    async () => (await bodyText(client)).includes('รายงานสถานะนักเรียน'),
    'Risk dashboard did not restore after visual-system checks',
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
  const passwordHash = await passwordService.hash(
    `RiskDashboardBrowser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  let chrome;
  let actorId = null;
  const createdCaseIds = [];

  try {
    await disableActor(dataSource);
    actorId = await upsertActor(dataSource, passwordHash);
    await purgeStaleManualCases(dataSource, actorId);
    const user = {
      id: actorId,
      username: USERNAME,
      FirstName: 'Risk Dashboard',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: [
        'attendance',
        'attendance-dashboard',
        'audit-log',
        'create',
        'dashboard',
        'edit-students',
        'export-data',
        'home',
        'import-data',
        'import-school-roster',
        'login-links',
        'manage-curriculum',
        'manage-role-groups',
        'manage-school-structure',
        'manage-student-observations',
        'manage-teacher-access',
        'manage-teachers',
        'manage-users-list',
        'review-cases',
        'settings',
        'students',
      ],
      data_scope: { school_ids: [10010002] },
      must_change_password: false,
    };

    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await client.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          const backendUrl = ${JSON.stringify(BACKEND_URL)};
          const rewrite = (url) => {
            if (typeof url !== 'string') return url;
            const parsed = new URL(url, window.location.origin);
            return parsed.port === '3000' ? backendUrl + parsed.pathname + parsed.search : url;
          };
          const originalFetch = window.fetch;
          window.fetch = (input, init) => originalFetch(
            typeof input === 'string' ? rewrite(input) : input,
            init,
          );
          const originalOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            return originalOpen.call(this, method, rewrite(url), ...rest);
          };
        })();
      `,
    });

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await loginInBrowser(client, user, createSessionCookie(sessionCookieService, actorId));
    if (!NAVIGATION_ONLY) {
      await assertLegacyRouteRedirects(client);
      await assertUserStatusFilterApi(client);
      await assertStatusSummaryCardFilters(client);
      await assertCanonicalPageWidths(client);
    }

    const apiResult = await fetchRiskDashboard(client);
    assert(apiResult.status === 200, `Risk dashboard API returned ${apiResult.status}`);
    assert(apiResult.payload?.success === true, 'Risk dashboard API did not return success=true');
    assert(
      Array.isArray(apiResult.payload?.data) && apiResult.payload.data.length > 0,
      'Risk dashboard API returned no student rows for the smoke dataset',
    );
    const expectedStudentName = apiResult.payload.data[0].studentName;
    const expectedTotalCount = Number(apiResult.payload.meta?.totalCount ?? 0);
    assert(expectedTotalCount > 0, 'Risk dashboard API totalCount was zero');

    if (FOCUSED_UI) {
      await assertRiskDashboard(
        client,
        expectedStudentName,
        expectedTotalCount,
        'desktop focused UI',
      );
      await capture(client, '/tmp/sts-risk-dashboard-focused-desktop.png');
      await assertCollapsedGroupAccordion(client);
      await client.call('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await assertRiskDashboard(
        client,
        expectedStudentName,
        expectedTotalCount,
        'mobile focused UI',
      );
      console.log(
        'risk dashboard focused UI smoke passed (fixed action slots plus collapsible active sidebar and push-content hover)',
      );
      return;
    }

    if (NAVIGATION_ONLY) {
      await navigate(client, `${FRONTEND_URL}/student-risk-report`);
      await waitFor(
        async () =>
          evaluate(
            client,
            `document.body.innerText.includes('รายงานสถานะนักเรียน')
              && Array.from(document.querySelectorAll('[data-student-navigation]'))
                .some((candidate) => candidate.offsetParent !== null)`,
          ),
        'desktop navigation risk dashboard rows did not render',
      );
      await assertVisibleStudentProfileLink(client, 'desktop navigation');
      await assertAvatarOnlyStudentNavigation(client, 'desktop navigation');
      await assertCanonicalRouteNavigation(client);

      await client.call('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await navigate(client, `${FRONTEND_URL}/student-risk-report`);
      await waitFor(
        async () =>
          evaluate(
            client,
            `document.body.innerText.includes('รายงานสถานะนักเรียน')
              && Array.from(document.querySelectorAll('[data-student-navigation]'))
                .some((candidate) => candidate.offsetParent !== null)`,
          ),
        'mobile navigation risk dashboard rows did not render',
      );
      await assertVisibleStudentProfileLink(client, 'mobile navigation');
      await assertAvatarOnlyStudentNavigation(client, 'mobile navigation');
      console.log(
        'risk dashboard navigation smoke passed (40 canonical routes plus contextual breadcrumb, menu ownership, reload, direct-open fallback, and safe back on desktop/mobile)',
      );
      return;
    }

    await assertRiskDashboard(client, expectedStudentName, expectedTotalCount, 'desktop');
    await assertSharedVisualSystem(client);
    const manualCaseRow = apiResult.payload.data.find(
      (row) => Number(row.openCaseCount) === 0 && row.studentId,
    );
    if (manualCaseRow) {
      await assertManualCaseFlow(client, manualCaseRow, createdCaseIds);
      await assertRiskDashboard(
        client,
        expectedStudentName,
        expectedTotalCount,
        'desktop after case flow',
      );
    }
    await assertVisibleStudentProfileLink(client, 'desktop');
    await assertAvatarOnlyStudentNavigation(client, 'desktop');
    await assertRiskSortDirection(client, 'descending', 'desktop default');
    await clickRiskSortHeader(client);
    await assertRiskSortCleared(client, 'desktop first toggle');
    await clickRiskSortHeader(client);
    await assertRiskSortDirection(client, 'ascending', 'desktop second toggle');
    await clickRiskSortHeader(client);
    await assertRiskSortDirection(client, 'descending', 'desktop third toggle');
    await assertSummaryFilterToggle(client, 'desktop');
    await assertHeaderProfileMenu(client);
    await assertCollapsedGroupAccordion(client);
    await capture(client, '/tmp/sts-risk-dashboard-desktop.png');

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await assertRiskDashboard(client, expectedStudentName, expectedTotalCount, 'mobile');
    await assertVisibleStudentProfileLink(client, 'mobile');
    await assertAvatarOnlyStudentNavigation(client, 'mobile');
    assert((await bodyText(client)).includes('เรียงตาม'), 'mobile sort label was missing');
    await setMobileSort(client, 'risk:asc');
    await setMobileSort(client, 'default');
    await assertMobileFilterReset(client, expectedStudentName);
    await capture(client, '/tmp/sts-risk-dashboard-mobile.png');
    await evaluate(
      client,
      `document.querySelector('button[aria-label="กรองสถานะรอมอบหมาย"]')?.scrollIntoView({ block: 'start' })`,
    );
    await capture(client, '/tmp/sts-risk-dashboard-mobile-summary.png');
    await navigate(client, `${FRONTEND_URL}/login`);
    await waitFor(
      async () =>
        evaluate(client, `Boolean(document.querySelector('[data-page-container="guest"]'))`),
      'mobile guest/auth page container did not render',
    );
    await waitFor(
      async () => (await bodyText(client)).includes('เข้าสู่ระบบ STS'),
      'mobile guest/auth login content did not render',
    );
    await capture(client, '/tmp/sts-admin-access-mobile.png');

    console.log(
      'risk dashboard browser smoke passed (API validation, canonical widths, status-card filters, desktop/mobile row navigation, three-state sort/reset controls, collapsed accordion, header profile menu, guest/auth mobile)',
    );
  } finally {
    await closeChrome(chrome);
    await cleanupManualCases(dataSource, createdCaseIds, actorId).catch(() => null);
    await disableActor(dataSource).catch(() => null);
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
