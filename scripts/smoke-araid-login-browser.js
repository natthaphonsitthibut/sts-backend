/**
 * Browser smoke for the staff AraID login page.
 *
 * Drives what a person actually does: open /login, press "เข้าสู่ระบบด้วย AraID",
 * wait at the QR panel while it polls, approve from the AraID side the way the
 * phone does, and end up inside the app with a working session.
 *
 * Runs its own backend on 127.0.0.1:3001 and expects the frontend to be served
 * from the SAME origin (vite proxying /api). A cross-origin dev setup drops the
 * session cookie and makes a working login look broken.
 */
require('dotenv/config');
const { spawn } = require('node:child_process');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { AraIdSessionCookieService } = require('../dist/araid/araid-session-cookie.service');

const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9257);
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(typeof message === 'function' ? await message() : message);
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

async function waitForToken(client) {
  let token = null;
  await waitFor(async () => {
    token = await evaluate(client, `(() => {
      const entry = performance.getEntriesByType('resource')
        .map((item) => item.name)
        .find((name) => name.includes('/api/auth/araid/challenge/status'));
      return entry ? (window.__stsAraIdChallenge || null) : null;
    })()`);
    return Boolean(token);
  }, 'The page never exposed its challenge token', 10_000).catch(() => undefined);
  return token;
}

async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
  }
  return result.result?.value;
}

async function main() {
  assert(existsSync(CHROME_PATH), 'Google Chrome executable was not found');
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  // main.ts wires CORS during bootstrap; a probe that builds the app directly
  // has to say the same thing or the browser refuses every call.
  app.enableCors({ origin: FRONTEND_URL, credentials: true });
  await app.listen(3001, '127.0.0.1');
  const dataSource = app.get(DataSource);
  const araIdSession = app.get(AraIdSessionCookieService);
  const profileDir = mkdtempSync(join(tmpdir(), 'sts-araid-login-'));
  const checked = [];
  const stamp = String(Date.now()).slice(-11);
  const citizenId = `95${stamp}`;
  const username = `araid_page_check_${stamp}`;
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
       ) VALUES ($1, 'อารา', 'หน้าล็อกอิน', '1990-01-01', 'ACTIVE', $2, $2)
       RETURNING id`,
      [citizenId, actor.id],
    );
    recordId = record.id;
    const [profile] = await dataSource.query(
      `INSERT INTO araid_profiles (identity_record_id, created_by_user_id, pin_hash, registration_status, registration_method)
       VALUES ($1, $2, 'x', 'ACTIVE', 'MANAGED') RETURNING id`,
      [recordId, actor.id],
    );
    profileId = profile.id;
    const [group] = await dataSource.query(
      `SELECT name FROM roles WHERE is_assignable IS TRUE AND school_id IS NOT NULL ORDER BY name LIMIT 1`,
    );
    await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", "PersonID_Onec",
         role, status, permissions, data_scope, data_origin_code)
       VALUES ($1, 'NOT_A_LOGIN_CREDENTIAL', 'อารา', 'หน้าล็อกอิน', $2, $3, 'ACTIVE',
         '["home","dashboard"]'::jsonb, '{"global": true}'::jsonb, 'AUTOMATED_TEST')`,
      [username, citizenId, group.name],
    );

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
    const target = targets.find((item) => item.type === 'page');
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.call('Page.enable');
    await client.call('Log.enable').catch(() => undefined);
    await client.call('Network.enable');
    const failures = [];
    client.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Network.loadingFailed') failures.push(message.params.errorText);
      if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/')) {
        failures.push(`${message.params.response.status} ${message.params.response.url}`);
      }
    });
    globalThis.__failures = failures;

    await client.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        // The app talks through axios/XHR, so watch XHR as well as fetch to see
        // which challenge the panel is really polling.
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
          this.__stsUrl = String(url);
          return originalOpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
          if (String(name).toLowerCase() === 'x-auth-araid-challenge') {
            window.__stsAraIdChallenge = value;
          }
          return originalSetHeader.call(this, name, value);
        };
        XMLHttpRequest.prototype.send = function (...args) {
          this.addEventListener('load', () => {
            if ((this.__stsUrl || '').includes('/challenge/status')) {
              window.__stsAraIdPolls = (window.__stsAraIdPolls || 0) + 1;
              window.__stsAraIdLastStatus = { status: this.status, body: String(this.responseText).slice(0, 160) };
            }
          });
          return originalSend.apply(this, args);
        };
      })()`,
    });
    await client.call('Page.navigate', { url: `${FRONTEND_URL}/login` });
    await waitFor(async () => (await evaluate(client, 'document.readyState')) === 'complete',
      'Login page did not load');
    await new Promise((resolve) => setTimeout(resolve, 700));

    const button = await evaluate(client, `(() => {
      const target = [...document.querySelectorAll('button')]
        .find((element) => (element.textContent || '').includes('AraID'));
      return target ? target.textContent.trim() : null;
    })()`);
    assert(button, 'The login page has no AraID button');
    assert(!/thaid/i.test(await evaluate(client, 'document.body.innerText')),
      'The login page still mentions ThaID');
    checked.push(`login page offers "${button}" and no ThaID`);

    await evaluate(client, `(() => {
      const target = [...document.querySelectorAll('button')]
        .find((element) => (element.textContent || '').includes('AraID'));
      target.click();
      return true;
    })()`);

    await waitFor(async () => Boolean(await evaluate(client,
      `Boolean(document.querySelector('img[src^="data:image/"]'))`)),
      `The QR panel never rendered: ${JSON.stringify(globalThis.__failures.slice(-6))}`);
    const panel = await evaluate(client, `(() => ({
      hasQr: Boolean(document.querySelector('img[src^="data:image/"]')),
      text: document.body.innerText.slice(0, 400),
    }))()`);
    assert(panel.hasQr, 'No QR image on the panel');
    checked.push('clicking it renders a QR panel with a reference code');

    // The panel polls while the phone is being used. This is where the flow used
    // to die: these endpoints shared the OTP bucket (10 per minute) against a
    // 2-second poll, so an honest login was rate-limited before anyone could
    // approve it. Wait for more polls than that bucket ever allowed.
    await waitFor(
      async () => (await evaluate(client, 'window.__stsAraIdPolls || 0')) >= 12,
      async () =>
        `The panel stopped polling: ${JSON.stringify(
          await evaluate(client, '({ polls: window.__stsAraIdPolls || 0, last: window.__stsAraIdLastStatus || null })'),
        )}`,
      40_000,
    );
    const polling = await evaluate(client, `({
      polls: window.__stsAraIdPolls || 0,
      last: window.__stsAraIdLastStatus || null,
    })`);
    assert(
      polling.last?.status === 201,
      `Polling the challenge was refused: ${JSON.stringify(polling.last)}`,
    );
    checked.push(`the panel polls ${polling.polls} times without being rate limited`);

    // The panel offers its link through a copy control rather than an anchor, so
    // the challenge comes from the status poll the page is already making.
    const token = await waitForToken(client);
    assert(token, `The page never polled a challenge: ${panel.text}`);

    const begun = await fetch('http://127.0.0.1:3001/api/auth/araid/challenge/begin', {
      method: 'POST',
      headers: { 'x-auth-araid-challenge': token },
    });
    assert(begun.status === 201, `begin failed: ${begun.status}`);
    const authorizationCookie = (begun.headers.getSetCookie?.() ?? [])
      .map((cookie) => cookie.split(';')[0]).join('; ');
    const identityCookie = await new Promise((resolve) => {
      araIdSession.setSession({ cookie: (name, value) => resolve(`${name}=${value}`) }, String(profileId));
    });
    const approved = await fetch('http://127.0.0.1:3001/api/auth/araid/challenge/approve', {
      method: 'POST',
      headers: { cookie: `${identityCookie}; ${authorizationCookie}` },
    });
    assert(approved.status === 201, `approve failed: ${approved.status} ${await approved.text()}`);
    checked.push('approving from the AraID side unblocks the waiting page');

    const loginAudit = async () =>
      (
        await dataSource.query(
          `SELECT COUNT(*)::int AS count FROM audit_log
           WHERE action = 'LOGIN' AND actor_user_id = (SELECT id FROM users WHERE username = $1)`,
          [username],
        )
      )[0].count;
    await waitFor(async () => (await loginAudit()) > 0,
      () => 'The server never completed the login for this account', 20_000)
      .catch(async (error) => {
        const seen = await evaluate(client, `({
          polls: window.__stsAraIdPolls || 0,
          last: window.__stsAraIdLastStatus || null,
          requests: performance.getEntriesByType('resource')
            .map((entry) => entry.name)
            .filter((name) => name.includes('/api/'))
            .slice(-8),
        })`);
        throw new Error(`${error.message} — page saw ${JSON.stringify(seen)}`);
      });
    checked.push('the server records the LOGIN for that account');

    await waitFor(async () => {
      const path = await evaluate(client, 'window.location.pathname');
      return path && path !== '/login';
    }, () => `The page never left /login after approval`, 25_000).catch(async () => {
      const diagnosis = await evaluate(client, `(async () => {
        const statusCalls = performance.getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name.includes('/api/auth/'));
        let me = null;
        try {
          const response = await fetch('/api/users/me', { credentials: 'include' });
          me = { status: response.status, body: (await response.text()).slice(0, 160) };
        } catch (error) { me = { error: String(error) }; }
        return { path: window.location.pathname, statusCalls: statusCalls.length, me,
                 polls: window.__stsAraIdPolls || 0, last: window.__stsAraIdLastStatus || null };
      })()`);
      throw new Error(`The page never left /login after approval: ${JSON.stringify(diagnosis)}`);
    });
    const landed = await evaluate(client, `({
      path: window.location.pathname,
      body: document.body.innerText.slice(0, 200),
    })`);
    checked.push(`the browser lands in the app at ${landed.path}`);

    console.log(JSON.stringify({ status: 'araid_login_page_ok', checked }));
  } finally {
    client?.close();
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    rmSync(profileDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
    await dataSource.query(`ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable`);
    await dataSource.query(`DELETE FROM audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE username = $1)`, [username]);
    await dataSource.query(`ALTER TABLE audit_log ENABLE TRIGGER trg_audit_log_immutable`);
    await dataSource.query(`DELETE FROM users WHERE username = $1`, [username]);
    if (profileId) await dataSource.query(`DELETE FROM araid_profiles WHERE id = $1`, [profileId]);
    if (recordId) await dataSource.query(`DELETE FROM araid_identity_records WHERE id = $1`, [recordId]);
    await app.close();
  }
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
