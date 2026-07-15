const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');

if (process.env.NODE_ENV === 'production' || !(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run executive reporting browser smoke outside a _smoke database');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3002';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5175';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9264);
const USERNAME = 'executive_reporting_browser_smoke';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorMessage(error) {
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
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error
        ? pending.reject(new Error(message.error.message))
        : pending.resolve(message.result || {});
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-executive-reporting-chrome-'));
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
  await waitFor(
    async () =>
      fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
        .then((r) => r.ok)
        .catch(() => false),
    'Chrome DevTools endpoint did not start',
  );
  const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json());
  const target = targets.find((item) => item.type === 'page');
  assert(target?.webSocketDebuggerUrl, 'Chrome page target was not available');
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return { client, processRef, userDataDir };
}

async function closeChrome(chrome) {
  if (!chrome) return;
  chrome.client.close();
  if (!chrome.processRef.killed) chrome.processRef.kill('SIGTERM');
  fs.rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

async function navigate(client, url) {
  await client.call('Page.navigate', { url });
  await waitFor(
    () => evaluate(client, 'document.readyState').then((state) => state === 'complete'),
    `Page did not finish loading: ${url}`,
  );
}

function sessionCookie(sessionCookieService, userId) {
  let captured;
  sessionCookieService.setSession(
    {
      cookie: (name, value) => {
        captured = { name, value };
      },
    },
    userId,
  );
  assert(captured, 'Session cookie was not created');
  return captured;
}

async function upsertActor(dataSource) {
  const permissions = [
    'home',
    'executive-report',
    'students',
    'review-cases',
    'report-up-cases',
    'create',
    'export-data',
  ];
  const [existing] = await dataSource.query('SELECT id FROM users WHERE username = $1', [USERNAME]);
  const values = [JSON.stringify(permissions), USERNAME];
  if (existing) {
    await dataSource.query(
      `UPDATE users SET status = 'ACTIVE', role = 'EXECUTIVE', permissions = $1::jsonb,
      data_scope = '{"global":true}'::jsonb, must_change_password = FALSE, data_origin_code = 'AUTOMATED_TEST',
      deactivated_at = NULL, deactivation_reason_code = NULL, deactivation_note = NULL WHERE username = $2`,
      values,
    );
    return Number(existing.id);
  }
  const [created] = await dataSource.query(
    `INSERT INTO users (username, password, "FirstName", "LastName", status, role, permissions, data_scope, must_change_password, data_origin_code)
    VALUES ($2, 'not-used-by-session-smoke', 'Executive', 'Browser Smoke', 'ACTIVE', 'EXECUTIVE', $1::jsonb, '{"global":true}'::jsonb, FALSE, 'AUTOMATED_TEST') RETURNING id`,
    values,
  );
  return Number(created.id);
}

async function disableActor(dataSource) {
  await dataSource.query(
    `UPDATE users SET status = 'DISABLED', deactivated_at = COALESCE(deactivated_at, NOW()),
    deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
    deactivation_note = COALESCE(deactivation_note, 'Retained executive reporting browser smoke fixture')
    WHERE username = $1 AND data_origin_code = 'AUTOMATED_TEST'`,
    [USERNAME],
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const cookies = app.get(SessionCookieService);
  let chrome;
  try {
    await disableActor(dataSource);
    const id = await upsertActor(dataSource);
    const [area] = await dataSource.query(`SELECT id, name, province, district FROM schools
      WHERE province IS NOT NULL AND district IS NOT NULL ORDER BY id LIMIT 1`);
    assert(area, 'Executive browser smoke requires one school with province and district');
    const cookie = sessionCookie(cookies, id);
    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await client.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
      const backend = ${JSON.stringify(BACKEND_URL)};
      const rewrite = (url) => typeof url === 'string' ? url.replace(/^https?:\\/\\/(?:localhost|127\\.0\\.0\\.1):3000\\/api/, backend + '/api') : url;
      const open = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(method, url, ...rest) { return open.call(this, method, rewrite(url), ...rest); };
      const originalFetch = window.fetch; window.fetch = (input, init) => originalFetch(typeof input === 'string' ? rewrite(input) : input, init);
    })()`,
    });
    await navigate(client, `${FRONTEND_URL}/login`);
    await client.call('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    const user = {
      id,
      username: USERNAME,
      FirstName: 'Executive',
      LastName: 'Browser Smoke',
      roles: ['EXECUTIVE'],
      permissions: [
        'home',
        'executive-report',
        'students',
        'review-cases',
        'report-up-cases',
        'create',
        'export-data',
      ],
      data_scope: { global: true },
      must_change_password: false,
    };
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(user))}); localStorage.setItem('admin_access', 'true');`,
    );
    await navigate(client, `${FRONTEND_URL}/executive-reporting`);
    await waitFor(async () => {
      const text = String(await evaluate(client, 'document.body.innerText'));
      return text.includes('รายงานภาพรวมผู้บริหาร') && text.includes('อ่านอย่างเดียว');
    }, 'Executive reporting page did not render');
    const select = async (id, value, label) => {
      const native = await evaluate(
        client,
        `Boolean(document.querySelector(${JSON.stringify('#' + id)})?.options)`,
      );
      if (native) {
        return await evaluate(
          client,
          `(() => {
            const element = document.querySelector(${JSON.stringify('#' + id)});
            if (![...element.options].some((option) => option.value === ${JSON.stringify(String(value))})) return false;
            element.value = ${JSON.stringify(String(value))};
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          })()`,
        );
      }
      const inputCombobox = await evaluate(
        client,
        `document.querySelector(${JSON.stringify('#' + id)})?.tagName === 'INPUT'`,
      );
      if (inputCombobox) {
        const opened = await evaluate(
          client,
          `(() => {
            const element = document.querySelector(${JSON.stringify('#' + id)});
            if (!element) return false;
            element.click();
            return true;
          })()`,
        );
        if (!opened) return false;
        await waitFor(
          () =>
            evaluate(
              client,
              `Boolean([...document.querySelector(${JSON.stringify('#' + id)}).parentElement
                .querySelectorAll('ul button')]
                .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)}))`,
            ),
          `Select ${id} did not load option ${label}`,
        );
        return await evaluate(
          client,
          `(() => {
            const input = document.querySelector(${JSON.stringify('#' + id)});
            const option = [...input.parentElement.querySelectorAll('ul button')]
              .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
            if (!option) return false;
            option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            return true;
          })()`,
        );
      }
      const opened = await evaluate(
        client,
        `(() => { const element = document.querySelector(${JSON.stringify('#' + id)}); if (!element) return false; element.click(); return true; })()`,
      );
      if (!opened) return false;
      await waitFor(
        () => evaluate(client, `document.querySelectorAll('[role="option"]').length > 0`),
        `Select ${id} did not open`,
      );
      if (label) {
        await waitFor(
          () =>
            evaluate(
              client,
              `[...document.querySelectorAll('[role="option"]')].some((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})`,
            ),
          `Select ${id} did not load option ${label}`,
        );
      }
      return await evaluate(
        client,
        `(() => {
          const option = [...document.querySelectorAll('[role="option"]')].find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
          if (!option) return false;
          option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          return true;
        })()`,
      );
    };
    assert(
      await select('executive-province', area.province, area.province),
      'Province filter option was missing',
    );
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert(
      await select('executive-group-by', 'DISTRICT', 'จัดกลุ่มตามอำเภอ'),
      'District grouping option was unavailable',
    );
    assert(
      await select('executive-district', area.district, area.district),
      'District filter option was missing',
    );
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert(
      await select('executive-group-by', 'SCHOOL', 'จัดกลุ่มตามโรงเรียน'),
      'School grouping option was unavailable',
    );
    assert(
      await select('executive-school', area.id, area.name),
      'School filter option was missing',
    );
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('รายงานภาพรวมผู้บริหาร'),
      'School aggregate view did not remain rendered',
    );
    const response = await evaluate(
      client,
      `(async () => {
      const base = ${JSON.stringify(BACKEND_URL + '/api')};
      const paths = ['/executive-reporting/overview?groupBy=PROVINCE', '/students', '/cases', '/tasks/visit-links', '/case-report-ups'];
      const result = {};
      for (const path of paths) { const r = await fetch(base + path, { credentials: 'include' }); result[path] = r.status; }
      return result;
    })()`,
    );
    assert(
      response['/executive-reporting/overview?groupBy=PROVINCE'] === 200,
      'Executive aggregate endpoint was not allowed',
    );
    for (const path of ['/students', '/cases', '/tasks/visit-links', '/case-report-ups'])
      assert(response[path] === 403, `Executive raw endpoint ${path} was not denied`);
    const pageText = String(await evaluate(client, 'document.body.innerText'));
    assert(
      pageText.includes('อ่านอย่างเดียว') && pageText.includes('ไม่แสดงรายชื่อนักเรียน'),
      'Executive UI did not state its aggregate-only boundary',
    );
    assert(
      pageText.includes('ส่งต่อระดับบน'),
      'Executive UI did not render report-up aggregate metrics',
    );
    assert(
      pageText.includes('ข้อมูลไม่เพียงพอ') || pageText.includes('0'),
      'Executive page did not render aggregate/suppression values',
    );
    for (const route of ['/students', '/cases', '/visit-links']) {
      await navigate(client, `${FRONTEND_URL}${route}`);
      const href = String(await evaluate(client, 'window.location.pathname'));
      assert(href !== route, `Executive raw route ${route} was rendered`);
    }
    await navigate(client, `${FRONTEND_URL}/data-exports`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('ส่งออกข้อมูล'),
      'Executive aggregate export page did not render',
    );
    const exportCatalog = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(BACKEND_URL + '/api/data-exports/catalog')}, { credentials: 'include' });
        const body = await response.json();
        return { status: response.status, codes: (body.data || []).map((item) => item.code) };
      })()`,
    );
    assert(
      exportCatalog.status === 200,
      `Executive export catalog returned ${exportCatalog.status}`,
    );
    assert(
      JSON.stringify(exportCatalog.codes) === JSON.stringify(['executive_aggregate']),
      `Executive export catalog exposed ${JSON.stringify(exportCatalog.codes)}`,
    );
    console.log('smoke:executive-reporting-browser ok');
  } finally {
    await closeChrome(chrome).catch(() => null);
    await disableActor(dataSource).catch(() => null);
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
