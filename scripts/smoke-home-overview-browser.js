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
  throw new Error('Refusing to run home overview browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9244);
const USERNAME_PREFIX = 'home_dashboard_browser_smoke';

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-home-overview-chrome-'));
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

async function activeCasesFromDb(dataSource) {
  const [row] = await dataSource.query(
    `SELECT count(*)::int AS count FROM cases WHERE status = 'IN_PROGRESS' AND deleted_at IS NULL`,
  );
  return Number(row?.count ?? 0);
}

async function upsertActor(dataSource, passwordHash, actor) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    actor.username,
  ]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = $4,
            "LastName" = 'Browser Smoke',
            status = 'ACTIVE',
            permissions = $3::jsonb,
            role = $5,
            data_scope = $6::jsonb,
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
      [
        existing.id,
        passwordHash,
        JSON.stringify(actor.permissions),
        actor.firstName,
        actor.role,
        JSON.stringify(actor.dataScope),
      ],
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
        $1, $2, $4, 'Browser Smoke', 'ACTIVE', $3::jsonb, $5,
        $6::jsonb, FALSE, 'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [
      actor.username,
      passwordHash,
      JSON.stringify(actor.permissions),
      actor.firstName,
      actor.role,
      JSON.stringify(actor.dataScope),
    ],
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
          deactivation_note = COALESCE(deactivation_note, 'Retained automated home overview browser smoke fixture')
      WHERE username LIKE $1
        AND data_origin_code = 'AUTOMATED_TEST'
    `,
    [`${USERNAME_PREFIX}%`],
  );
}

async function assertOverview(client, expectedActiveCases, label, expectations) {
  await navigate(client, FRONTEND_URL);
  try {
    await waitFor(
      async () => {
        const text = await bodyText(client);
        return text.includes('หน้าหลัก') && text.includes('ต้องดำเนินการวันนี้');
      },
      `${label} home dashboard did not render`,
    );
  } catch (error) {
    const currentUrl = await evaluate(client, 'location.href');
    const currentBody = (await bodyText(client)).slice(0, 1_000);
    throw new Error(`${errorMessage(error)}; url=${currentUrl}; body=${currentBody}`);
  }
  const text = await bodyText(client);
  assert(text.includes('ต้องดำเนินการวันนี้'), `${label} action queue was missing`);
  assert(text.includes('ทั้งหมด'), `${label} student summary metric was missing`);
  if (expectations.risk) {
    assert(text.includes('เสี่ยงสูง'), `${label} risk metric was missing`);
    assert(text.includes('การกระจายระดับความเสี่ยง'), `${label} risk chart was missing`);
  } else {
    assert(!text.includes('การกระจายระดับความเสี่ยง'), `${label} rendered risk chart without permission`);
  }
  if (expectations.cases) {
    assert(text.includes('สถานะเคสช่วยเหลือ'), `${label} case pipeline chart was missing`);
  } else {
    assert(!text.includes('สถานะเคสช่วยเหลือ'), `${label} rendered case chart without permission`);
  }
  if (expectations.attendance) {
    assert(text.includes('แนวโน้มการมาเรียน'), `${label} attendance trend was missing`);
  } else {
    assert(!text.includes('แนวโน้มการมาเรียน'), `${label} rendered attendance trend without permission`);
  }
  const hasExportNavigation = await evaluate(
    client,
    `Boolean(document.querySelector('a[href="/data-exports"]'))`,
  );
  if (expectations.exports) {
    assert(hasExportNavigation, `${label} export navigation was missing`);
  } else {
    assert(!hasExportNavigation, `${label} rendered export navigation without permission`);
  }
  if (expectations.cases) {
    const activeCaseCardText = await evaluate(client, `(() => document.body.innerText)()`);
    assert(
      String(activeCaseCardText).includes(expectedActiveCases.toLocaleString()),
      `${label} did not render expected active case count ${expectedActiveCases}\n${String(activeCaseCardText)}`,
    );
    const caseMetricLinks = await evaluate(
      client,
      `Array.from(document.querySelectorAll('a[href]'))
        .filter((link) => link.textContent?.includes('กำลังติดตาม') || link.textContent?.includes('รอตรวจผล'))
        .map((link) => ({ text: link.textContent?.trim(), href: link.getAttribute('href') }))`,
    );
    assert(
      caseMetricLinks.some((link) => link.text.includes('กำลังติดตาม') && link.href.includes('status=IN_PROGRESS')),
      `${label} in-progress case metric did not retain its filter context`,
    );
    assert(
      caseMetricLinks.some((link) => link.text.includes('รอตรวจผล') && link.href.includes('status=PENDING_REVIEW')),
      `${label} pending-review case metric did not retain its filter context`,
    );
  }
  if (expectations.risk) {
    const riskMetricLink = await evaluate(
      client,
      `Array.from(document.querySelectorAll('a[href]'))
        .find((link) => link.textContent?.includes('เสี่ยงสูง'))
        ?.getAttribute('href')`,
    );
    assert(
      String(riskMetricLink).includes('riskTier=HIGH'),
      `${label} high-risk metric did not retain its filter context`,
    );
  }
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
    `HomeOverviewBrowser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  let chrome;

  try {
    await disableActor(dataSource);
    const actors = [
      {
        label: 'admin',
        username: `${USERNAME_PREFIX}_admin`,
        firstName: 'Home Admin',
        role: 'ADMIN',
        permissions: ['home', 'dashboard', 'attendance-dashboard', 'review-cases', 'students'],
        dataScope: { global: true },
        expectations: { attendance: true, risk: true, cases: true, exports: true },
      },
      {
        label: 'attendance-only',
        username: `${USERNAME_PREFIX}_attendance`,
        firstName: 'Home Attendance',
        role: 'TEACHER',
        permissions: ['home', 'attendance-dashboard'],
        dataScope: { global: true },
        expectations: { attendance: true, risk: false, cases: false, exports: false },
      },
      {
        label: 'reviewer',
        username: `${USERNAME_PREFIX}_reviewer`,
        firstName: 'Home Reviewer',
        role: 'ADMIN',
        permissions: ['home', 'review-cases'],
        dataScope: { global: true },
        expectations: { attendance: false, risk: false, cases: true, exports: true },
      },
      {
        label: 'dashboard',
        username: `${USERNAME_PREFIX}_dashboard`,
        firstName: 'Home Dashboard',
        role: 'ADMIN',
        permissions: ['home', 'dashboard'],
        dataScope: { global: true },
        expectations: { attendance: false, risk: true, cases: false, exports: true },
      },
    ];
    const actorIds = new Map();
    for (const actor of actors) {
      actorIds.set(actor.label, await upsertActor(dataSource, passwordHash, actor));
    }
    const expectedActiveCases = await activeCasesFromDb(dataSource);

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
    const admin = actors[0];
    await loginInBrowser(
      client,
      {
        id: actorIds.get(admin.label),
        username: admin.username,
        FirstName: admin.firstName,
        LastName: 'Browser Smoke',
        roles: [admin.role],
        permissions: admin.permissions,
        data_scope: admin.dataScope,
        must_change_password: false,
      },
      createSessionCookie(sessionCookieService, actorIds.get(admin.label)),
    );
    await assertOverview(client, expectedActiveCases, 'desktop', admin.expectations);
    const apiActiveCases = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/home-dashboard/summary`)}, {
          credentials: 'include'
        });
        const payload = await response.json();
        return payload.data.metrics.find((metric) => metric.key === 'activeCases')?.value;
      })()`,
    );
    assert(
      Number(apiActiveCases) === expectedActiveCases,
      `API activeCases ${apiActiveCases} did not match DB ${expectedActiveCases}`,
    );
    await capture(client, '/tmp/sts-home-overview-desktop.png');
    await evaluate(
      client,
      `Array.from(document.querySelectorAll('h2')).find((heading) => heading.textContent.includes('แนวโน้มการมาเรียน'))?.scrollIntoView({ block: 'start' })`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await capture(client, '/tmp/sts-home-overview-trends-desktop.png');

    for (const actor of actors.slice(1)) {
      await loginInBrowser(
        client,
        {
          id: actorIds.get(actor.label),
          username: actor.username,
          FirstName: actor.firstName,
          LastName: 'Browser Smoke',
          roles: [actor.role],
          permissions: actor.permissions,
          data_scope: actor.dataScope,
          must_change_password: false,
        },
        createSessionCookie(sessionCookieService, actorIds.get(actor.label)),
      );
      await assertOverview(client, expectedActiveCases, actor.label, actor.expectations);
    }

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await loginInBrowser(
      client,
      {
        id: actorIds.get(admin.label),
        username: admin.username,
        FirstName: admin.firstName,
        LastName: 'Browser Smoke',
        roles: [admin.role],
        permissions: admin.permissions,
        data_scope: admin.dataScope,
        must_change_password: false,
      },
      createSessionCookie(sessionCookieService, actorIds.get(admin.label)),
    );
    await assertOverview(client, expectedActiveCases, 'mobile', admin.expectations);
    await capture(client, '/tmp/sts-home-overview-mobile.png');
    await evaluate(
      client,
      `Array.from(document.querySelectorAll('h2')).find((heading) => heading.textContent.includes('แนวโน้มการมาเรียน'))?.scrollIntoView({ block: 'start' })`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await capture(client, '/tmp/sts-home-overview-trends-mobile.png');

    console.log('home dashboard browser smoke passed (role sections, no export card, desktop/mobile render)');
  } finally {
    await closeChrome(chrome);
    await disableActor(dataSource).catch(() => null);
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
