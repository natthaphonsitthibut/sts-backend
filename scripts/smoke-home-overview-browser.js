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
  const expected = new URL(url);
  await waitFor(
    async () =>
      await evaluate(
        client,
        `location.origin === ${JSON.stringify(expected.origin)}
          && location.pathname === ${JSON.stringify(expected.pathname)}
          && document.readyState === 'complete'`,
      ),
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
    `SELECT count(*)::int AS count
     FROM cases
     WHERE status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW')
       AND deleted_at IS NULL`,
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
        return (
          text.includes('นักเรียนทั้งหมด') &&
          text.includes('พื้นที่ที่มีนักเรียนเสี่ยงสูง Top 5') &&
          text.includes('สัดส่วนสาเหตุความเสี่ยง')
        );
      },
      `${label} home dashboard did not render`,
    );
  } catch (error) {
    const currentUrl = await evaluate(client, 'location.href');
    const currentBody = (await bodyText(client)).slice(0, 1_000);
    const summaryResponse = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(
          `${BACKEND_URL}/api/home-dashboard/summary`,
        )}, { credentials: 'include' });
        return { status: response.status, body: (await response.text()).slice(0, 1_000) };
      })()`,
    ).catch((fetchError) => ({ status: 0, body: errorMessage(fetchError) }));
    throw new Error(
      `${errorMessage(error)}; url=${currentUrl}; body=${currentBody}; summary=${JSON.stringify(summaryResponse)}`,
    );
  }
  const text = await bodyText(client);
  assert(!text.includes('ต้องดำเนินการวันนี้'), `${label} rendered the removed action queue`);
  assert(!text.includes('ทางลัดทำงานต่อ'), `${label} rendered the removed shortcut section`);
  assert(text.includes('นักเรียนทั้งหมด'), `${label} student summary metric was missing`);
  assert(
    text.includes('พื้นที่ที่มีนักเรียนเสี่ยงสูง Top 5'),
    `${label} high-risk area ranking was missing`,
  );
  for (const metricLabel of [
    'นักเรียนกลุ่มเสี่ยง',
    'เคสทั้งหมด',
    'เคสที่กำลังดำเนินการ',
    'เคสที่เสร็จสิ้น',
  ]) {
    assert(text.includes(metricLabel), `${label} metric was missing: ${metricLabel}`);
  }
  assert(text.includes('สัดส่วนสาเหตุความเสี่ยง'), `${label} cause chart was missing`);
  const riskDimension = await evaluate(
    client,
    `document.querySelector('[data-risk-area-dimension]')?.getAttribute('data-risk-area-dimension')`,
  );
  assert(
    riskDimension === (expectations.riskDimension || 'PROVINCE'),
    `${label} default risk dimension was ${riskDimension}`,
  );
  assert(!text.includes('แนวโน้มการมาเรียน'), `${label} rendered the retired attendance chart`);
  assert(!text.includes('การกระจายระดับความเสี่ยง'), `${label} rendered the retired risk chart`);
  assert(!text.includes('เคสเปิดใหม่เทียบปิดแล้ว'), `${label} rendered the retired case chart`);
  const hasExportNavigation = await evaluate(
    client,
    `Boolean(document.querySelector('a[href="/data-exports"]'))`,
  );
  if (expectations.exports) {
    assert(hasExportNavigation, `${label} export navigation was missing`);
  } else {
    assert(!hasExportNavigation, `${label} rendered export navigation without permission`);
  }
  const attendanceNavigation = await evaluate(
    client,
    `Boolean(document.querySelector('a[href="/attendance"]'))`,
  );
  assert(
    attendanceNavigation === expectations.attendanceNavigation,
    `${label} attendance navigation did not match the stored permission`,
  );
  if (expectations.cases) {
    const activeCaseCardText = await evaluate(client, `(() => document.body.innerText)()`);
    assert(
      String(activeCaseCardText).includes(expectedActiveCases.toLocaleString()),
      `${label} did not render expected active case count ${expectedActiveCases}\n${String(activeCaseCardText)}`,
    );
  }
  if (expectations.risk) {
    const riskMetricLink = await evaluate(
      client,
      `document.querySelector('[data-home-metric="watchStudents"]')?.getAttribute('href')`,
    );
    assert(
      String(riskMetricLink).includes('riskTier=HIGH'),
      `${label} high-risk metric did not retain its filter context`,
    );
  }
}

async function assertAdministrativeMap(client, dimension, expectedFeatureCount) {
  await waitFor(
    async () =>
      Number(
        await evaluate(
          client,
          `document.querySelectorAll('[data-administrative-map="${dimension}"] path[data-area-code]').length`,
        ),
      ) === expectedFeatureCount,
    `${dimension} administrative map did not render ${expectedFeatureCount} boundaries`,
  );
  const invalidBoundaries = await evaluate(
    client,
    `Array.from(document.querySelectorAll('[data-administrative-map="${dimension}"] path[data-area-code]'))
      .filter((path) => !/^\\d+$/.test(path.getAttribute('data-area-code') || '')
        || !/^\\d+$/.test(path.getAttribute('data-area-count') || '')).length`,
  );
  assert(
    invalidBoundaries === 0,
    `${dimension} administrative map rendered boundaries without code/count metadata`,
  );
  if (dimension === 'PROVINCE') {
    const zeroBoundaries = await evaluate(
      client,
      `document.querySelectorAll('[data-administrative-map="PROVINCE"] path[data-area-count="0"]').length`,
    );
    assert(zeroBoundaries > 0, 'National map did not render zero-risk boundaries');
  }
}

async function selectMapArea(client, dimension) {
  return await evaluate(
    client,
    `(() => {
      const paths = Array.from(
        document.querySelectorAll('[data-administrative-map="${dimension}"] path[data-area-code][role="button"]')
      );
      const selected = paths.find((path) => Number(path.getAttribute('data-area-count')) > 0) || paths[0];
      const name = selected?.getAttribute('data-area-name') || null;
      selected?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return name;
    })()`,
  );
}

async function selectMapAreaByKeyboard(client, dimension) {
  return await evaluate(
    client,
    `(() => {
      const paths = Array.from(
        document.querySelectorAll('[data-administrative-map="${dimension}"] path[data-area-code][role="button"]')
      );
      const selected = paths.find((path) => Number(path.getAttribute('data-area-count')) > 0) || paths[0];
      const name = selected?.getAttribute('data-area-name') || null;
      selected?.focus();
      selected?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
      return name;
    })()`,
  );
}

async function mapFeatureCount(client, dimension) {
  await waitFor(
    async () =>
      Number(
        await evaluate(
          client,
          `document.querySelectorAll('[data-administrative-map="${dimension}"] path[data-area-code]').length`,
        ),
      ) > 0,
    `${dimension} administrative map did not render`,
  );
  return Number(
    await evaluate(
      client,
      `document.querySelectorAll('[data-administrative-map="${dimension}"] path[data-area-code]').length`,
    ),
  );
}

async function assertNoSchoolPins(client) {
  const markerCount = await evaluate(
    client,
    `document.querySelectorAll('[data-home-risk-map-surface] > svg [data-school-marker], [data-home-risk-map-surface] > svg circle').length`,
  );
  assert(markerCount === 0, 'Administrative map rendered school pins at school drill-down');
}

async function assertMapTooltipAndZoom(client) {
  const target = await evaluate(
    client,
    `(async () => {
      const surface = document.querySelector('[data-home-risk-map-surface]');
      surface?.scrollIntoView({ block: 'center' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const path = document.querySelector('[data-administrative-map="PROVINCE"] path[data-area-code]');
      const rect = path?.getBoundingClientRect();
      const surfaceRect = surface?.getBoundingClientRect();
      if (!rect || !surfaceRect) return null;
      path.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }));
      return {
        x: surfaceRect.left + surfaceRect.width / 2,
        y: surfaceRect.top + surfaceRect.height / 2,
      };
    })()`,
  );
  assert(target, 'Province map did not expose a tooltip target');
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `document.querySelector('[data-home-risk-map-surface] [role="tooltip"]')?.textContent?.includes('นักเรียนเสี่ยง')`,
        ),
      ),
    'Map hover did not render the floating risk tooltip',
  );
  const duplicateNativeTitles = await evaluate(
    client,
    `document.querySelectorAll('[data-home-risk-map-surface] path title').length`,
  );
  assert(duplicateNativeTitles === 0, 'Map retained duplicate native SVG tooltips');

  const before = await evaluate(
    client,
    `(() => {
      const surface = document.querySelector('[data-home-risk-map-surface]');
      const scrollContainer = surface?.closest('main');
      return {
        scrollTop: scrollContainer?.scrollTop ?? null,
        transform: surface?.querySelector(':scope > svg > g')?.style.transform ?? null,
      };
    })()`,
  );
  await client.call('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: target.x,
    y: target.y,
    deltaX: 0,
    deltaY: -240,
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const after = await evaluate(
    client,
    `(() => {
      const surface = document.querySelector('[data-home-risk-map-surface]');
      const scrollContainer = surface?.closest('main');
      return {
        scrollTop: scrollContainer?.scrollTop ?? null,
        transform: surface?.querySelector(':scope > svg > g')?.style.transform ?? null,
        controls: ['ซูมออก', 'รีเซ็ตขนาดแผนที่', 'ซูมเข้า'].every((label) =>
          Boolean(surface?.querySelector('button[aria-label="' + label + '"]'))
        ),
      };
    })()`,
  );
  assert(after.controls, 'Map zoom controls were incomplete');
  assert(after.transform !== before.transform, 'Mouse wheel did not zoom the map');
  assert(
    Math.abs(after.scrollTop - before.scrollTop) < 1,
    'Map wheel interaction leaked into page scrolling',
  );
  await client.call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: target.x,
    y: target.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await client.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: target.x + 60,
    y: target.y + 35,
    button: 'left',
    buttons: 1,
  });
  await client.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: target.x + 60,
    y: target.y + 35,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  const draggedTransform = await evaluate(
    client,
    `document.querySelector('[data-home-risk-map-surface] > svg > g')?.style.transform ?? null`,
  );
  assert(draggedTransform !== after.transform, 'Dragging did not pan the zoomed map');
  await evaluate(
    client,
    `document.querySelector('[data-home-risk-map-surface] button[aria-label="รีเซ็ตขนาดแผนที่"]')?.click()`,
  );
}

async function assertReducedMotionMap(client) {
  await client.call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  const transitionDuration = await evaluate(
    client,
    `getComputedStyle(document.querySelector('[data-home-risk-map-surface] > svg > g')).transitionDuration`,
  );
  assert(transitionDuration === '0s', `Reduced-motion map transition was ${transitionDuration}`);
  await client.call('Emulation.setEmulatedMedia', { features: [] });
}

async function assertMapAssetErrorAndRecovery(client) {
  await client.call('Network.setCacheDisabled', { cacheDisabled: true });
  await client.call('Network.setBlockedURLs', {
    urls: ['*maps/thailand-administrative/provinces.geojson*'],
  });
  await navigate(client, `${FRONTEND_URL}/?period=7_DAYS`);
  await waitFor(
    async () => (await bodyText(client)).includes('โหลดขอบเขตแผนที่ไม่สำเร็จ'),
    'Blocked map asset did not render an explicit error state',
  );
  await client.call('Network.setBlockedURLs', { urls: [] });
  await navigate(client, `${FRONTEND_URL}/?period=30_DAYS`);
  await assertAdministrativeMap(client, 'PROVINCE', 77);
  await client.call('Network.setCacheDisabled', { cacheDisabled: false });
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
        permissions: ['home', 'dashboard', 'students', 'export-data'],
        dataScope: { global: true },
        expectations: {
          attendance: true,
          risk: true,
          cases: true,
          exports: true,
          attendanceNavigation: false,
        },
      },
      {
        label: 'attendance-only',
        username: `${USERNAME_PREFIX}_attendance`,
        firstName: 'Home Attendance',
        role: 'DIRECTOR',
        permissions: ['home', 'attendance'],
        dataScope: { global: true },
        expectations: {
          attendance: true,
          risk: false,
          cases: false,
          exports: false,
          attendanceNavigation: true,
        },
      },
      {
        label: 'reviewer',
        username: `${USERNAME_PREFIX}_reviewer`,
        firstName: 'Home Reviewer',
        role: 'ADMIN',
        permissions: ['home', 'dashboard'],
        dataScope: { global: true },
        expectations: {
          attendance: false,
          risk: false,
          cases: true,
          exports: false,
          attendanceNavigation: false,
        },
      },
      {
        label: 'dashboard',
        username: `${USERNAME_PREFIX}_dashboard`,
        firstName: 'Home Dashboard',
        role: 'ADMIN',
        permissions: ['home', 'dashboard'],
        dataScope: { global: true },
        expectations: {
          attendance: false,
          risk: true,
          cases: false,
          exports: false,
          attendanceNavigation: false,
        },
      },
    ];
    const scopeSchools = await dataSource.query(
      `SELECT id FROM schools ORDER BY id LIMIT 2`,
    );
    assert(scopeSchools.length === 2, 'Home dashboard scope smoke needs at least two schools');
    actors.push({
      label: 'school-scoped',
      username: `${USERNAME_PREFIX}_school_scoped`,
      firstName: 'Home School Scope',
      role: 'DIRECTOR',
      permissions: ['home'],
      dataScope: { school_ids: [Number(scopeSchools[0].id)] },
      expectations: {
        attendance: false,
        risk: false,
        cases: false,
        exports: false,
        attendanceNavigation: false,
        riskDimension: 'SCHOOL',
      },
    });
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
    await assertAdministrativeMap(client, 'PROVINCE', 77);
    await assertMapTooltipAndZoom(client);
    await assertReducedMotionMap(client);
    const selectedProvince = await selectMapAreaByKeyboard(client, 'PROVINCE');
    assert(selectedProvince, 'National map did not expose a province drill-down area');
    await waitFor(
      async () =>
        evaluate(
          client,
          `document.querySelector('[data-risk-area-dimension]')
            ?.getAttribute('data-risk-area-dimension') === 'DISTRICT'`,
        ),
      'Selecting a province did not drill the risk ranking down to districts',
    );
    const districtBoundaryCount = await mapFeatureCount(client, 'DISTRICT');
    assert(districtBoundaryCount > 0, 'Province map did not contain current district boundaries');
    const drilledSearch = await evaluate(client, 'location.search');
    assert(
      String(drilledSearch).includes(`province=${encodeURIComponent(selectedProvince)}`),
      'Province drill-down did not retain the selected scope in the URL',
    );

    const selectedDistrict = await selectMapArea(client, 'DISTRICT');
    assert(selectedDistrict, 'Province map did not expose a district drill-down area');
    await waitFor(
      async () =>
        evaluate(
          client,
          `document.querySelector('[data-risk-area-dimension]')
            ?.getAttribute('data-risk-area-dimension') === 'SUB_DISTRICT'`,
        ),
      'Selecting a district did not drill the risk ranking down to sub-districts',
    );
    const subDistrictBoundaryCount = await mapFeatureCount(client, 'SUB_DISTRICT');
    assert(
      subDistrictBoundaryCount > 0,
      'District map did not contain current sub-district boundaries',
    );

    const selectedSubDistrict = await selectMapArea(client, 'SUB_DISTRICT');
    assert(selectedSubDistrict, 'District map did not expose a sub-district drill-down area');
    await waitFor(
      async () =>
        evaluate(
          client,
          `document.querySelector('[data-risk-area-dimension]')
            ?.getAttribute('data-risk-area-dimension') === 'SCHOOL'`,
        ),
      'Selecting a sub-district did not drill the ranking down to schools',
    );
    assert(
      (await mapFeatureCount(client, 'SUB_DISTRICT')) === subDistrictBoundaryCount,
      'School drill-down replaced the sub-district boundary map',
    );
    await assertNoSchoolPins(client);

    const backLabel = await evaluate(
      client,
      `document.querySelector('button[data-administrative-map-back]')?.textContent?.trim() || null`,
    );
    assert(backLabel === 'กลับไปดูตำบล/แขวง', `Unexpected map back label: ${backLabel}`);
    for (const expectedDimension of ['SUB_DISTRICT', 'DISTRICT', 'PROVINCE']) {
      await evaluate(
        client,
        `document.querySelector('button[data-administrative-map-back]')?.click()`,
      );
      await waitFor(
        async () =>
          evaluate(
            client,
            `document.querySelector('[data-risk-area-dimension]')
              ?.getAttribute('data-risk-area-dimension') === '${expectedDimension}'`,
          ),
        `Risk ranking back control did not return to ${expectedDimension}`,
      );
    }
    const restoredSearch = await evaluate(client, 'location.search');
    assert(
      !String(restoredSearch).includes('province='),
      'Risk ranking back control did not clear the selected province',
    );
    await assertMapAssetErrorAndRecovery(client);
    const apiActiveCases = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/home-dashboard/summary`)}, {
          credentials: 'include'
        });
        const payload = await response.json();
        return payload.data.metrics.find((metric) => metric.key === 'inProgressCases')?.value;
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
    const outOfScopeStatus = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(
          `${BACKEND_URL}/api/home-dashboard/summary?schoolId=${Number(scopeSchools[1].id)}`,
        )}, { credentials: 'include' });
        return response.status;
      })()`,
    );
    assert(outOfScopeStatus === 403, `Out-of-scope home filter returned ${outOfScopeStatus}`);

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
    const hasHorizontalOverflow = await evaluate(
      client,
      `document.documentElement.scrollWidth > window.innerWidth + 1`,
    );
    assert(!hasHorizontalOverflow, 'Mobile home dashboard has horizontal overflow');
    await capture(client, '/tmp/sts-home-overview-mobile.png');
    await evaluate(
      client,
      `Array.from(document.querySelectorAll('h2')).find((heading) => heading.textContent.includes('แนวโน้มการมาเรียน'))?.scrollIntoView({ block: 'start' })`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await capture(client, '/tmp/sts-home-overview-trends-mobile.png');

    console.log(
      'home dashboard browser smoke passed (77-boundary map, province/district/sub-district drill-down, zero-area metadata, no school pins, permission navigation, scoped denial, desktop/mobile render)',
    );
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
