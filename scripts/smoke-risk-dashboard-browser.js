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
const USERNAME = 'risk_dashboard_browser_smoke';

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
        `location.pathname === '/student-risk-report'
          && location.search === '?source=legacy'
          && location.hash === '#summary'`,
      ),
    'Legacy dashboard route did not preserve its search/hash while redirecting',
  );

  const legacyTaskId = '00000000-0000-4000-8000-000000000000';
  await navigate(
    client,
    `${FRONTEND_URL}/task-detail/${legacyTaskId}?source=legacy#detail`,
  );
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

  await navigate(
    client,
    `${FRONTEND_URL}/field-followers-review/history?source=legacy`,
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        `location.pathname === '/field-follower-applications/history'
          && location.search === '?source=legacy'`,
      ),
    'Legacy field-follower review history route did not preserve its search',
  );

  await navigate(
    client,
    `${FRONTEND_URL}/admin-access?next=%2Fstudent-risk-report`,
  );
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
    'attendance-dashboard',
    'dashboard',
    'field-monitor',
    'home',
    'login-links',
    'manage-student-accounts',
    'manage-users-list',
    'review-cases',
    'students',
  ];
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    USERNAME,
  ]);
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
            data_scope = '{"global":true}'::jsonb,
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
        '{"global":true}'::jsonb, FALSE, 'AUTOMATED_TEST', NULL, NULL
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

async function fetchRiskDashboard(client, sortDirection = 'desc') {
  return evaluate(
    client,
    `(async () => {
      const response = await fetch(${JSON.stringify(
        `${BACKEND_URL}/api/dashboard/risk-watchlist?limit=10&sortBy=risk&sortDirection=${sortDirection}`,
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
  assert(result.invalidStatus === 400, `Invalid user accountStatus returned ${result.invalidStatus}`);
}

async function clickRiskSortHeader(client) {
  const clicked = await evaluate(
    client,
    `(() => {
      const button = Array.from(document.querySelectorAll('th button'))
        .find((candidate) => candidate.innerText.includes('ระดับ'));
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert(clicked, 'Risk sort header button was not found');
}

async function assertRiskSortDirection(client, direction, label) {
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const header = Array.from(document.querySelectorAll('th[aria-sort="${direction}"]'))
            .find((candidate) => candidate.innerText.includes('ระดับ'));
          return Boolean(header);
        })()`,
      ),
    `${label} risk sort header did not switch to ${direction}`,
  );
}

async function assertRiskSortCleared(client, label) {
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const header = Array.from(document.querySelectorAll('th'))
            .find((candidate) => candidate.innerText.includes('ระดับ'));
          return Boolean(header && !header.hasAttribute('aria-sort'));
        })()`,
      ),
    `${label} risk sort header did not return to the unsorted state`,
  );
}

async function assertVisibleStudentProfileLink(client, label) {
  const linkFound = await evaluate(
    client,
    `(() => Array.from(document.querySelectorAll('a[href^="/students/"]'))
      .some((link) => link.offsetParent !== null && link.innerText.trim().length > 0))()`,
  );
  assert(linkFound, `${label} did not expose a visible student profile link`);
}

async function assertFullStudentSurfaceNavigation(client, label) {
  const clicked = await evaluate(
    client,
    `(() => {
      const surface = Array.from(document.querySelectorAll('[data-student-navigation]'))
        .find((candidate) => candidate.offsetParent !== null);
      if (!surface) return false;
      surface.click();
      return true;
    })()`,
  );
  assert(clicked, `${label} did not expose a clickable student row/card`);
  await waitFor(
    async () => evaluate(client, `window.location.pathname.startsWith('/students/')`),
    `${label} student row/card did not navigate to the student detail page`,
  );
  await navigate(client, `${FRONTEND_URL}/student-risk-report`);
  await waitFor(
    async () => (await bodyText(client)).includes('รายงานนักเรียน'),
    `${label} dashboard did not render again after row/card navigation`,
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => Array.from(document.querySelectorAll('[data-student-navigation]'))
          .some((candidate) => candidate.offsetParent !== null))()`,
      ),
    `${label} dashboard rows did not render again after row/card navigation`,
  );
}

async function assertManualCaseFlow(client, row, createdCaseIds) {
  const studentId = String(row.studentId);
  const expectedRiskTier = String(row.riskTier);
  const reason = `Browser smoke manual case ${Date.now()}`;

  await navigate(client, `${FRONTEND_URL}/student-risk-report`);
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const row = Array.from(document.querySelectorAll('[data-student-navigation]'))
            .find((candidate) => candidate.offsetParent !== null
              && candidate.getAttribute('data-student-navigation') === ${JSON.stringify(studentId)});
          return Boolean(row?.querySelector('button[aria-label="เปิดเคสติดตามนักเรียน"]'));
        })()`,
      ),
    'risk dashboard did not expose the manual case action',
  );
  await evaluate(
    client,
    `(() => {
      const row = Array.from(document.querySelectorAll('[data-student-navigation]'))
        .find((candidate) => candidate.offsetParent !== null
          && candidate.getAttribute('data-student-navigation') === ${JSON.stringify(studentId)});
      row?.querySelector('button[aria-label="เปิดเคสติดตามนักเรียน"]')?.click();
    })()`,
  );
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return Boolean(dialog
            && dialog.innerText.includes('เปิดเคสติดตามนักเรียน')
            && getComputedStyle(dialog).textAlign === 'left');
        })()`,
      ),
    'manual case dialog did not render with canonical left alignment',
  );
  await evaluate(
    client,
    `Array.from(document.querySelectorAll('[role="dialog"] button'))
      .find((button) => button.innerText.trim() === 'ยกเลิก')?.click()`,
  );

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
  await waitFor(
    async () => {
      const text = await bodyText(client);
      return text.includes('รายละเอียดเคส') && text.includes(reason);
    },
    'case detail did not render the submitted reason',
  );

  const caseId = Number(
    await evaluate(client, `Number(window.location.pathname.split('/').filter(Boolean).at(-1))`),
  );
  assert(Number.isInteger(caseId) && caseId > 0, 'opened case id was invalid');
  createdCaseIds.push(caseId);

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
  assert(duplicate.payload?.created === false, 'duplicate manual case request created another case');
  assert(Number(duplicate.payload?.data?.id) === caseId, 'duplicate request returned another case');

  await navigate(client, `${FRONTEND_URL}/student-risk-report`);
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const row = Array.from(document.querySelectorAll('[data-student-navigation]'))
            .find((candidate) => candidate.offsetParent !== null
              && candidate.getAttribute('data-student-navigation') === ${JSON.stringify(studentId)});
          return Boolean(row?.querySelector('button[aria-label^="ดูเคสที่กำลังติดตาม"]'));
        })()`,
      ),
    'risk dashboard did not expose the active case list action',
  );
  await evaluate(
    client,
    `(() => {
      const row = Array.from(document.querySelectorAll('[data-student-navigation]'))
        .find((candidate) => candidate.offsetParent !== null
          && candidate.getAttribute('data-student-navigation') === ${JSON.stringify(studentId)});
      row?.querySelector('button[aria-label^="ดูเคสที่กำลังติดตาม"]')?.click();
    })()`,
  );
  await waitFor(
    async () => {
      const text = await evaluate(
        client,
        `document.querySelector('[role="dialog"]')?.innerText ?? ''`,
      );
      return text.includes('เคสที่กำลังติดตาม') && text.includes(reason);
    },
    'active case list dialog did not render the student case',
  );
  await evaluate(
    client,
    `Array.from(document.querySelectorAll('[role="dialog"] button'))
      .find((button) => button.innerText.trim() === 'ดูรายละเอียด')?.click()`,
  );
  await waitFor(
    async () => evaluate(client, `window.location.pathname === ${JSON.stringify(`/cases/${caseId}`)}`),
    'active case list did not navigate to the selected case detail',
  );
  await capture(client, '/tmp/sts-manual-case-detail.png');
}

async function cleanupManualCases(dataSource, caseIds, actorId) {
  if (caseIds.length === 0 || !actorId) return;
  const ids = caseIds.map(String);
  await dataSource.query(
    `DELETE FROM notifications WHERE ref_entity = 'case' AND ref_id = ANY($1::text[])`,
    [ids],
  );
  await dataSource.query(
    `DELETE FROM audit_logs WHERE target_type = 'case' AND target_id = ANY($1::text[])`,
    [ids],
  );
  await dataSource.query(
    `DELETE FROM cases WHERE id = ANY($1::int[]) AND created_by = $2`,
    [caseIds, actorId],
  );
}

async function assertCanonicalPageWidths(client) {
  const routes = ['/student-risk-report', '/manage-users', '/manage-student-accounts'];
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
    widths.every((width) => width === '1180px'),
    `Authenticated page widths drifted: ${routes.map((route, index) => `${route}=${widths[index]}`).join(', ')}`,
  );

  await navigate(client, `${FRONTEND_URL}/login`);
  await waitFor(
    async () =>
      evaluate(client, `Boolean(document.querySelector('[data-page-container="guest"]'))`),
    'Guest/auth page container did not render',
  );
  await waitFor(
    async () => (await bodyText(client)).includes('เข้าสู่ระบบ STS'),
    'Guest/auth login content did not render',
  );
  const guestLayout = await evaluate(
    client,
    `(() => {
      const container = document.querySelector('[data-page-container="guest"]');
      return {
        className: container?.className ?? null,
        maxWidth: container ? getComputedStyle(container).maxWidth : null,
        contentMaxWidth: container?.firstElementChild
          ? getComputedStyle(container.firstElementChild).maxWidth
          : null,
      };
    })()`,
  );
  assert(
    guestLayout.maxWidth === 'none' && guestLayout.contentMaxWidth === '1024px',
    `Guest/auth page width drifted: shell=${guestLayout.maxWidth}, content=${guestLayout.contentMaxWidth} (${guestLayout.className})`,
  );
}

async function assertStatusSummaryCardFilters(client) {
  const routes = [
    '/cases',
    '/login-links',
    '/attendance-links',
    '/visit-links',
    '/field-followers',
    '/manage-users',
    '/manage-student-accounts',
  ];

  for (const route of routes) {
    await navigate(client, `${FRONTEND_URL}${route}`);
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
      throw new Error(`${errorMessage(error)}; card=${cardLabel}; states=${JSON.stringify(states)}`);
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
      const button = document.querySelector('button[aria-label="กรองเสี่ยงสูง"]');
      if (!button || button.getAttribute('aria-pressed') !== 'false') return false;
      button.click();
      return true;
    })()`,
  );
  assert(selected, `${label} high-risk summary filter was not initially selectable`);
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => document.querySelector('button[aria-label="ยกเลิกตัวกรองเสี่ยงสูง"]')
          ?.getAttribute('aria-pressed') === 'true')()`,
      ),
    `${label} high-risk summary did not expose its selected state`,
  );

  const cleared = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('button[aria-label="ยกเลิกตัวกรองเสี่ยงสูง"]');
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert(cleared, `${label} high-risk summary filter could not be toggled off`);
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => document.querySelector('button[aria-label="กรองเสี่ยงสูง"]')
          ?.getAttribute('aria-pressed') === 'false')()`,
      ),
    `${label} high-risk summary did not clear its selected state`,
  );
}

async function assertRiskCriteriaPopover(client) {
  const opened = await evaluate(
    client,
    `(() => {
      const button = document.querySelector(
        'button[aria-label="ข้อมูลเพิ่มเติม: เกณฑ์การจัดระดับความเสี่ยง"]',
      );
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert(opened, 'risk criteria info button was not found');
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => {
          const note = document.querySelector('[role="note"]');
          return Boolean(note && note.innerText.includes('ขาดติดกัน ต่ำ/กลาง/สูง'));
        })()`,
      ),
    'risk criteria popover did not expose the configured thresholds',
  );
  await evaluate(client, `new Promise((resolve) => setTimeout(resolve, 250))`);
  await capture(client, '/tmp/sts-risk-criteria-popover.png');
  await evaluate(
    client,
    `document.querySelector(
      'button[aria-label="ข้อมูลเพิ่มเติม: เกณฑ์การจัดระดับความเสี่ยง"]',
    )?.click()`,
  );
}

async function assertMobileFilterReset(client, expectedStudentName) {
  const selected = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('button[aria-label="กรองเสี่ยงสูง"]');
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
        `(() => document.querySelector('button[aria-label="กรองเสี่ยงสูง"]')
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
  const collapsed = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('button[aria-label="พับเมนูด้านข้าง"]');
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert(collapsed, 'desktop sidebar could not be collapsed');
  await waitFor(
    async () =>
      evaluate(
        client,
        `Boolean(document.querySelector('button[aria-label="ขยายเมนูด้านข้าง"]'))`,
      ),
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

  const openedGroup = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('button[aria-label="งานติดตามเคส"]');
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert(openedGroup, 'collapsed sidebar group was not clickable');
  await waitFor(
    async () =>
      evaluate(
        client,
        `(() => Array.from(document.querySelectorAll('button'))
          .some((button) => button.innerText.includes('งานติดตามเคส')
            && button.getAttribute('aria-expanded') === 'true'))()`,
      ),
    'collapsed sidebar group did not open its nested icon list',
  );
  const childVisibleAndWidthStable = await evaluate(
    client,
    `(() => {
      const child = document.querySelector('a[aria-label="เคสติดตาม"]');
      const sidebar = document.querySelector('aside');
      return Boolean(
        child
        && child.offsetParent !== null
        && sidebar
        && getComputedStyle(sidebar).width === '80px'
      );
    })()`,
  );
  assert(
    childVisibleAndWidthStable,
    'collapsed sidebar did not show its child icons while preserving the collapsed width',
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
    async () => (await bodyText(client)).includes('รายงานนักเรียน'),
    `${label} risk dashboard title did not render`,
  );
  await waitFor(
    async () => (await bodyText(client)).includes('เกณฑ์การจัดระดับ'),
    `${label} risk criteria control did not render`,
  );
  const text = await bodyText(client);
  assert(text.includes('เสี่ยงสูง'), `${label} high risk summary was missing`);
  assert(text.includes('เฝ้าระวัง'), `${label} watch summary was missing`);
  assert(text.includes('ปกติ'), `${label} normal summary was missing`);
  assert(!text.includes('ไม่สามารถโหลดรายงานนักเรียนได้'), `${label} rendered error state`);
  await waitFor(
    async () => (await bodyText(client)).includes(expectedStudentName),
    `${label} did not render first API student ${expectedStudentName}`,
  );
  await waitFor(
    async () => {
      const nextText = await bodyText(client);
      return (
        nextText.includes(expectedTotalCount.toLocaleString()) ||
        nextText.includes(String(expectedTotalCount))
      );
    },
    `${label} did not render total count ${expectedTotalCount}`,
  );
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
  assert(
    colors.previousPage === 'rgb(103, 103, 103)',
    `Previous breadcrumb ink drifted: ${colors.previousPage}`,
  );
  assert(colors.currentPage === 'rgb(17, 17, 17)', `Breadcrumb ink drifted: ${colors.currentPage}`);
  assert(
    colors.description === 'rgb(103, 103, 103)',
    `Page description ink drifted: ${colors.description}`,
  );
  assert(
    colors.tableHeadingBackground === 'rgb(15, 73, 189)' &&
      colors.tableHeadingText === 'rgb(255, 255, 255)' &&
      Number.parseFloat(colors.tableHeadingHeight) >= 48,
    `Table heading colors drifted: ${JSON.stringify(colors)}`,
  );
  assert(
    colors.notificationSurface === 'rgb(226, 233, 247)' &&
      colors.profileSurface === 'rgb(226, 233, 247)',
    `Header brand surfaces drifted: ${JSON.stringify(colors)}`,
  );
  assert(
    colors.activeNavigationSurface === 'rgb(231, 237, 248)',
    `Active navigation surface drifted: ${colors.activeNavigationSurface}`,
  );
  assert(
    colors.refreshBackground === 'rgb(255, 255, 255)' &&
      colors.refreshText === 'rgb(17, 17, 17)' &&
      colors.refreshBorder === 'rgb(212, 212, 212)',
    `Refresh button colors drifted: ${JSON.stringify(colors)}`,
  );

  await navigate(client, `${FRONTEND_URL}/manage-users`);
  await waitFor(
    async () => evaluate(client, `Boolean(document.querySelector('[role="tab"]'))`),
    'Manage-users tabs did not render',
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
  assert(
    homeBrandTile === 'rgb(226, 233, 247)',
    `Home blue-icon surface drifted: ${homeBrandTile}`,
  );
  await navigate(client, `${FRONTEND_URL}/student-risk-report`);
  await waitFor(
    async () => (await bodyText(client)).includes('รายงานนักเรียน'),
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
    const user = {
      id: actorId,
      username: USERNAME,
      FirstName: 'Risk Dashboard',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: [
        'attendance-dashboard',
        'dashboard',
        'field-monitor',
        'home',
        'login-links',
        'manage-student-accounts',
        'manage-users-list',
        'review-cases',
        'students',
      ],
      data_scope: { global: true },
      must_change_password: false,
    };

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
    await loginInBrowser(client, user, createSessionCookie(sessionCookieService, actorId));
    await assertLegacyRouteRedirects(client);
    await assertCanonicalPageWidths(client);
    await assertUserStatusFilterApi(client);
    await assertStatusSummaryCardFilters(client);

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

    await assertRiskDashboard(client, expectedStudentName, expectedTotalCount, 'desktop');
    await assertSharedVisualSystem(client);
    const manualCaseRow = apiResult.payload.data.find(
      (row) => Number(row.openCaseCount) === 0 && row.studentId,
    );
    assert(manualCaseRow, 'risk dashboard dataset had no student without an active case');
    await assertManualCaseFlow(client, manualCaseRow, createdCaseIds);
    await assertRiskDashboard(client, expectedStudentName, expectedTotalCount, 'desktop after case flow');
    await assertVisibleStudentProfileLink(client, 'desktop');
    await assertFullStudentSurfaceNavigation(client, 'desktop');
    await assertRiskSortDirection(client, 'descending', 'desktop default');
    await clickRiskSortHeader(client);
    await assertRiskSortCleared(client, 'desktop first toggle');
    await clickRiskSortHeader(client);
    await assertRiskSortDirection(client, 'ascending', 'desktop second toggle');
    await clickRiskSortHeader(client);
    await assertRiskSortDirection(client, 'descending', 'desktop third toggle');
    await assertSummaryFilterToggle(client, 'desktop');
    await assertRiskCriteriaPopover(client);
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
    await assertFullStudentSurfaceNavigation(client, 'mobile');
    assert((await bodyText(client)).includes('เรียงตาม'), 'mobile sort label was missing');
    await setMobileSort(client, 'risk:asc');
    await setMobileSort(client, 'default');
    await assertMobileFilterReset(client, expectedStudentName);
    await capture(client, '/tmp/sts-risk-dashboard-mobile.png');
    await evaluate(
      client,
      `document.querySelector('button[aria-label="กรองเสี่ยงสูง"]')?.scrollIntoView({ block: 'start' })`,
    );
    await capture(client, '/tmp/sts-risk-dashboard-mobile-summary.png');
    await navigate(client, `${FRONTEND_URL}/login`);
    await waitFor(
      async () =>
        evaluate(
          client,
          `Boolean(document.querySelector('[data-page-container="guest"]'))`,
        ),
      'mobile guest/auth page container did not render',
    );
    await waitFor(
      async () => (await bodyText(client)).includes('เข้าสู่ระบบ STS'),
      'mobile guest/auth login content did not render',
    );
    await capture(client, '/tmp/sts-admin-access-mobile.png');

    console.log(
      'risk dashboard browser smoke passed (API validation, canonical widths, seven status-card filters, desktop/mobile row navigation, criteria popover, three-state sort/reset controls, collapsed accordion, header profile menu, guest/auth mobile)',
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
