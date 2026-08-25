/**
 * Browser smoke for entering AraID on its own, with no verification flow behind it.
 *
 * The three things this proves, because all three were broken in exactly this
 * order for a user opening /araid cold:
 *   1. the splash "เริ่มต้น" button works while the session probe is still in
 *      flight — it used to sit disabled on "กำลังตรวจสอบ…" for the whole probe,
 *      which on a sleeping backend is tens of seconds;
 *   2. a PIN submit that never reaches the server (timeout / dropped network)
 *      says so, keeps the 8 digits, and offers a retry — it used to wipe the PIN
 *      behind a tiny line of red text that reads like "wrong PIN";
 *   3. on a wide screen the sign-out button sits at the edge of the content area
 *      instead of stopping at an invisible 90rem boundary.
 *
 * Serves the built frontend itself and proxies /api to its own backend, so the
 * browser sees ONE origin — a cross-origin setup drops the AraID session cookie
 * and makes a working login look broken.
 */
require('dotenv/config');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { extname, join, normalize, resolve } = require('node:path');
const { request: httpRequest } = require('node:http');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const bcrypt = require('bcrypt');
const { AppModule } = require('../dist/app.module');

const FRONTEND_ROOT = resolve(__dirname, '..', '..', 'sts-frontend');
const FRONTEND_PORT = Number(process.env.SMOKE_FRONTEND_PORT || 5174);
const BACKEND_PORT = Number(process.env.SMOKE_BACKEND_PORT || 3001);
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9261);
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PIN = '13571357';

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const MIME = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Build into a throwaway directory with the API base pinned to this origin.
 * The checked-in build config bakes VITE_API_BASE_URL in at build time, so a
 * developer's dist can point anywhere — and a cross-origin base silently drops
 * the AraID session cookie, which would fail this smoke for the wrong reason.
 */
function buildFrontend(outDir) {
  return new Promise((done, fail) => {
    const build = spawn('npm', ['run', 'build', '--', '--outDir', outDir, '--emptyOutDir'], {
      cwd: FRONTEND_ROOT,
      env: { ...process.env, VITE_API_BASE_URL: '/' },
      stdio: 'ignore',
    });
    build.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`Building the frontend failed with code ${code}`)),
    );
    build.on('error', fail);
  });
}

async function waitFor(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(typeof message === 'function' ? await message() : message);
}

/** Static dist + SPA fallback + /api proxy, so the browser only ever sees one origin. */
function startFrontendServer(distDir) {
  const server = createServer((incoming, outgoing) => {
    const url = new URL(incoming.url, FRONTEND_URL);
    if (url.pathname.startsWith('/api/')) {
      const proxied = httpRequest(
        {
          host: '127.0.0.1',
          port: BACKEND_PORT,
          path: url.pathname + url.search,
          method: incoming.method,
          headers: { ...incoming.headers, host: `127.0.0.1:${BACKEND_PORT}` },
        },
        (response) => {
          outgoing.writeHead(response.statusCode, response.headers);
          response.pipe(outgoing);
        },
      );
      proxied.on('error', () => outgoing.writeHead(502).end());
      incoming.pipe(proxied);
      return;
    }

    const candidate = join(distDir, normalize(url.pathname));
    const file =
      candidate.startsWith(distDir) && existsSync(candidate) && extname(candidate)
        ? candidate
        : join(distDir, 'index.html');
    outgoing.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    outgoing.end(readFileSync(file));
  });
  server.listen(FRONTEND_PORT, '127.0.0.1');
  return server;
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }
  async connect() {
    await new Promise((done, fail) => {
      this.socket.addEventListener('open', done, { once: true });
      this.socket.addEventListener('error', fail, { once: true });
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
    return new Promise((done, fail) => {
      this.pending.set(id, { resolve: done, reject: fail });
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
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
  }
  return result.result?.value;
}

/** React ignores a plain value assignment — go through the native setter. */
async function typeInto(client, selector, value) {
  return evaluate(
    client,
    `(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      if (!field) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
}

async function clickText(client, text) {
  return evaluate(
    client,
    `(() => {
      const target = [...document.querySelectorAll('button, a')]
        .find((element) => (element.textContent || '').includes(${JSON.stringify(text)}));
      if (!target) return false;
      target.click();
      return true;
    })()`,
  );
}

async function main() {
  assert(existsSync(CHROME_PATH), 'Google Chrome executable was not found');

  const distDir = mkdtempSync(join(tmpdir(), 'sts-araid-dist-'));
  await buildFrontend(distDir);
  assert(existsSync(join(distDir, 'index.html')), 'The frontend build produced no index.html');

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.listen(BACKEND_PORT, '127.0.0.1');
  const dataSource = app.get(DataSource);
  const frontend = startFrontendServer(distDir);
  const profileDir = mkdtempSync(join(tmpdir(), 'sts-araid-entry-'));
  const checked = [];
  const stamp = String(Date.now()).slice(-11);
  const citizenId = `96${stamp}`;
  let chrome;
  let client;
  let recordId = null;
  let profileId = null;

  try {
    const [actor] = await dataSource.query(`SELECT id FROM users ORDER BY id LIMIT 1`);
    const [record] = await dataSource.query(
      `INSERT INTO araid_identity_records (
         identity_number, given_name_th, family_name_th, date_of_birth,
         record_status, created_by_user_id, updated_by_user_id
       ) VALUES ($1, 'อารา', 'เข้าตรง', '1990-01-01', 'ACTIVE', $2, $2)
       RETURNING id`,
      [citizenId, actor.id],
    );
    recordId = record.id;
    const [profile] = await dataSource.query(
      `INSERT INTO araid_profiles (identity_record_id, created_by_user_id, pin_hash,
         registration_status, registration_method)
       VALUES ($1, $2, $3, 'ACTIVE', 'MANAGED') RETURNING id`,
      [recordId, actor.id, await bcrypt.hash(PIN, 12)],
    );
    profileId = profile.id;

    await waitFor(async () => {
      try {
        return (await fetch(FRONTEND_URL)).ok;
      } catch {
        return false;
      }
    }, 'The frontend server did not start');

    chrome = spawn(
      CHROME_PATH,
      ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
       '--remote-allow-origins=*', `--remote-debugging-port=${DEBUG_PORT}`,
       `--user-data-dir=${profileDir}`, 'about:blank'],
      { stdio: 'ignore' },
    );
    await waitFor(async () => {
      try { return (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).ok; } catch { return false; }
    }, 'Chrome DevTools endpoint did not start');
    const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json());
    client = new CdpClient(targets.find((item) => item.type === 'page').webSocketDebuggerUrl);
    await client.connect();
    await client.call('Page.enable');
    await client.call('Runtime.enable');

    // Stands in for the free-tier backend that has gone to sleep: the session
    // probe crawls, and the PIN submit dies without ever reaching the server.
    const network = { sessionProbeDelayMs: 0, pinSubmitStallMs: 0, failPinSubmit: false };
    client.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = message.params;
      void (async () => {
        try {
          if (request.url.includes('/araid/session/login') && network.failPinSubmit) {
            if (network.pinSubmitStallMs) {
              await new Promise((done) => setTimeout(done, network.pinSubmitStallMs));
            }
            await client.call('Fetch.failRequest', { requestId, errorReason: 'TimedOut' });
            return;
          }
          if (request.url.includes('/araid/session/me') && network.sessionProbeDelayMs) {
            await new Promise((done) => setTimeout(done, network.sessionProbeDelayMs));
          }
          await client.call('Fetch.continueRequest', { requestId });
        } catch {
          /* the target may already be gone */
        }
      })();
    });
    await client.call('Fetch.enable', {
      patterns: [{ urlPattern: '*/api/araid/session/*', requestStage: 'Request' }],
    });

    // 1. Splash, with the session probe stalled the way a sleeping backend stalls it.
    network.sessionProbeDelayMs = 6_000;
    await client.call('Page.navigate', { url: `${FRONTEND_URL}/araid` });
    // Anchor on "there is a button", not on its label — waiting for the label to
    // say "เริ่มต้น" would quietly wait out the stalled probe and test nothing.
    await waitFor(
      async () => Boolean(await evaluate(client, `document.querySelectorAll('main button').length > 0`)),
      'The splash never rendered its action button',
    );
    const splash = await evaluate(client, `(() => {
      const target = document.querySelector('main button');
      return {
        label: target.textContent.trim(),
        disabled: target.disabled,
        probeFinished: performance.getEntriesByType('resource')
          .some((entry) => entry.name.includes('/araid/session/me')),
      };
    })()`);
    assert(
      !splash.probeFinished,
      'The session probe already answered — this check proves nothing about a slow backend',
    );
    assert(
      !splash.disabled && !splash.label.includes('กำลังตรวจสอบ'),
      `The splash button is still gated on the session probe: ${JSON.stringify(splash)}`,
    );
    checked.push('the splash lets you in while the session probe is still hanging');

    assert(await clickText(client, 'เริ่มต้น'), 'Could not press the start button');
    await waitFor(
      async () => (await evaluate(client, 'window.location.pathname')) === '/araid/login',
      'Pressing start did not open the AraID login screen',
    );
    network.sessionProbeDelayMs = 0;

    // 2. Identity number, then the PIN — the ordinary path with nothing to verify.
    await waitFor(
      async () => Boolean(await evaluate(client,
        `Boolean(document.querySelector('#araid-identity-number'))`)),
      'The identity form never rendered',
    );
    assert(await typeInto(client, '#araid-identity-number', citizenId), 'No identity field');
    await waitFor(
      async () => Boolean(await evaluate(client, `(() => {
        const next = [...document.querySelectorAll('button')]
          .find((element) => (element.textContent || '').includes('ถัดไป'));
        return next && !next.disabled;
      })()`)),
      'The identity form never accepted the 13-digit number',
    );
    assert(await clickText(client, 'ถัดไป'), 'Could not press next');
    await waitFor(
      async () => (await evaluate(client, 'window.location.pathname')) === '/araid/pin',
      'The identity form did not lead to the PIN screen',
    );

    // 3. A PIN submit that never reaches the server.
    await waitFor(
      async () => Boolean(await evaluate(client,
        `Boolean([...document.querySelectorAll('button')].find((element) => element.getAttribute('aria-label') === 'เลข 1'))`)),
      'The PIN keypad never rendered',
    );
    network.failPinSubmit = true;
    network.pinSubmitStallMs = 1_500;
    for (const digit of PIN) {
      assert(
        await evaluate(client, `(() => {
          const key = [...document.querySelectorAll('button')]
            .find((element) => element.getAttribute('aria-label') === 'เลข ${digit}');
          if (!key) return false;
          key.click();
          return true;
        })()`),
        `The keypad has no ${digit} key`,
      );
    }
    await waitFor(
      async () => Boolean(await evaluate(client,
        `document.body.innerText.includes('กำลังตรวจสอบ')`)),
      'The PIN screen never showed that it was working — that silence is the bug',
      6_000,
    );
    checked.push('submitting a PIN shows a visible "กำลังตรวจสอบ…" state');

    await waitFor(
      async () => Boolean(await evaluate(client, `Boolean(document.querySelector('[role="alert"]'))`)),
      'The stalled PIN submit never reported anything',
      15_000,
    );
    const stalled = await evaluate(client, `(() => {
      const dots = document.querySelector('[aria-label^="กรอกแล้ว"]');
      const alert = document.querySelector('[role="alert"]');
      return {
        digitsKept: dots ? dots.getAttribute('aria-label') : null,
        message: alert ? alert.textContent.trim() : null,
        canRetry: [...document.querySelectorAll('button')]
          .some((element) => (element.textContent || '').includes('ลองอีกครั้ง')),
      };
    })()`);
    assert(
      stalled.digitsKept === 'กรอกแล้ว 8 หลัก',
      `A failed round trip wiped the PIN: ${JSON.stringify(stalled)}`,
    );
    assert(
      stalled.message && stalled.message.includes('ระบบตอบช้า'),
      `A timeout must not read like a wrong PIN: ${JSON.stringify(stalled)}`,
    );
    assert(stalled.canRetry, `No retry offered after a timeout: ${JSON.stringify(stalled)}`);
    checked.push('a timed-out submit keeps the 8 digits and offers "ลองอีกครั้ง"');

    // 4. Retry on a healthy connection lands in AraID itself.
    network.failPinSubmit = false;
    assert(await clickText(client, 'ลองอีกครั้ง'), 'Could not press retry');
    await waitFor(
      async () => (await evaluate(client, 'window.location.pathname')) === '/araid/home',
      async () =>
        `Retrying the PIN did not sign in: ${await evaluate(client, `JSON.stringify({
          path: window.location.pathname,
          alert: (document.querySelector('[role="alert"]') || {}).textContent || null,
          loginCalls: performance.getEntriesByType('resource')
            .filter((entry) => entry.name.includes('/araid/session/login')).length,
        })`)}`,
      20_000,
    );
    checked.push('retrying without retyping signs in and lands on /araid/home');

    // 5. The sign-out button on a wide screen.
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 2560, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    await waitFor(
      async () => Boolean(await evaluate(client, `Boolean([...document.querySelectorAll('button')]
        .find((element) => element.getAttribute('aria-label') === 'ออกจากระบบ'))`)),
      'The home screen never rendered its sign-out button',
    );
    const layout = await evaluate(client, `(() => {
      const target = [...document.querySelectorAll('button')]
        .find((element) => element.getAttribute('aria-label') === 'ออกจากระบบ');
      const bar = target.closest('header').parentElement;
      const barBox = bar.getBoundingClientRect();
      const buttonBox = target.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        gapToBar: Math.round(barBox.right - buttonBox.right),
        gapToViewport: Math.round(window.innerWidth - buttonBox.right),
      };
    })()`);
    assert(layout.viewportWidth >= 2000, `The wide-screen override did not apply: ${JSON.stringify(layout)}`);
    // lg:px-10 is the only thing that may sit to its right.
    assert(
      layout.gapToBar <= 48,
      `Sign-out is not at the edge of the app bar: ${JSON.stringify(layout)}`,
    );
    assert(
      layout.gapToViewport <= 48,
      `Sign-out stops short of the content area on a wide screen: ${JSON.stringify(layout)}`,
    );
    checked.push(`sign-out sits ${layout.gapToViewport}px from the edge at ${layout.viewportWidth}px wide`);

    console.log(JSON.stringify({ status: 'araid_entry_ok', checked }, null, 2));
  } finally {
    client?.close();
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    rmSync(profileDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
    rmSync(distDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
    await new Promise((done) => frontend.close(done));
    await dataSource.query(`ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable`);
    await dataSource.query(`DELETE FROM audit_log WHERE target_id = $1`, [profileId]);
    await dataSource.query(`ALTER TABLE audit_log ENABLE TRIGGER trg_audit_log_immutable`);
    if (profileId) await dataSource.query(`DELETE FROM araid_profiles WHERE id = $1`, [profileId]);
    if (recordId) await dataSource.query(`DELETE FROM araid_identity_records WHERE id = $1`, [recordId]);
    await app.close();
  }
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
