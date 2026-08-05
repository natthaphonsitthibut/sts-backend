// Fake LINE credentials, set before the app is required: the browser smoke must
// never reach LINE with the operator's real ones. Every provider call is stubbed.
process.env.LINE_ENABLED = 'true';
process.env.LINE_LOGIN_CHANNEL_ID = 'smoke-login-channel';
process.env.LINE_LOGIN_CHANNEL_SECRET = 'smoke-login-secret';
process.env.LINE_MESSAGING_CHANNEL_ID = 'smoke-channel';
process.env.LINE_MESSAGING_CHANNEL_SECRET = 'smoke-messaging-secret';
process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = 'smoke-token';
process.env.LINE_OA_BASIC_ID = '@sts-smoke';
// The callback redirects to this origin, so it has to be the frontend this
// smoke drives — not whatever the developer's .env points at.
process.env.FRONTEND_BASE_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { EmailService } = require('../dist/common/email/email.service');
const { MESSAGING_PROVIDER } = require('../dist/common/messaging/messaging.types');
const { RedisClientService } = require('../dist/redis/redis-client.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run LINE link browser smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_PORT = Number(process.env.SMOKE_BACKEND_PORT || 3001);
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9256);
const SCREENSHOT_DIR = process.env.SMOKE_SCREENSHOT_DIR || null;

const EMAIL = 'line.browser.smoke@sts-smoke.invalid';
const LINE_USER = 'U0000000000000000000000000browser1';

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-linelink-chrome-'));
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

async function capture(client, name) {
  if (!SCREENSHOT_DIR) return;
  const result = await client.call('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, `${name}.png`), Buffer.from(result.data, 'base64'));
}

/**
 * React ignores a directly assigned `value`, so the native setter is called and
 * an input event dispatched — otherwise the controlled component never updates.
 */
async function fillInput(client, selector, value) {
  await evaluate(
    client,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('missing input ' + ${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
}

/** Lazy routes render after `readyState` is already complete, so wait for the node. */
async function waitForSelector(client, selector) {
  await waitFor(
    async () =>
      Boolean(await evaluate(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)),
    `Element never appeared: ${selector}`,
  );
}

/** Types a code into the segmented OTP boxes, digit by digit, as a person would. */
async function fillOtp(client, code) {
  await evaluate(
    client,
    `(() => {
      const boxes = [...document.querySelectorAll('input[inputmode="numeric"], input[autocomplete="one-time-code"]')];
      if (boxes.length === 0) throw new Error('no OTP boxes on the page');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      ${JSON.stringify(code)}.split('').forEach((digit, index) => {
        const field = boxes[index];
        if (!field) return;
        setter.call(field, digit);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      return true;
    })()`,
  );
}

async function clickText(client, text) {
  const clicked = await evaluate(
    client,
    `(() => {
      const target = [...document.querySelectorAll('button')].find((node) =>
        node.innerText.includes(${JSON.stringify(text)}),
      );
      if (!target) return false;
      target.click();
      return true;
    })()`,
  );
  assert(clicked, `Button not found: ${text}`);
}

function stubMessagingProvider(app) {
  const provider = app.get(MESSAGING_PROVIDER);
  const state = {
    friendState: 'FRIEND',
    identity: { providerUserId: LINE_USER, displayName: 'Browser Smoke' },
  };
  provider.isEnabled = () => true;
  // Stands in for the LINE consent screen: the browser is bounced straight back
  // to our callback, which is the only part of the redirect we own.
  //
  // `friendship_status_changed` is appended by LINE itself whenever the sign-in
  // asked for `bot_prompt`, which ours does. Leaving it out of the stub is what
  // let a 400 on the real callback reach a teacher: the whole request was
  // rejected before the handler for carrying a property we had not declared.
  provider.buildAuthorizationUrl = ({ state: value }) =>
    `http://127.0.0.1:${BACKEND_PORT}/api/line/link/callback` +
    `?code=smoke-code&state=${value}&friendship_status_changed=false`;
  provider.buildAddContactUrl = () => 'https://line.me/R/ti/p/@sts-smoke';
  provider.completeAuthorization = () =>
    Promise.resolve({ identity: state.identity, friendState: state.friendState });
  return state;
}

function captureOtpCodes(app) {
  const emailService = app.get(EmailService);
  const codes = new Map();
  emailService.sendOTP = (email, code) => {
    codes.set(email.toLowerCase(), code);
    return Promise.resolve({ success: true, provider: 'SMOKE_CAPTURE' });
  };
  return codes;
}

async function resetThrottleCounters(app) {
  const client = app.get(RedisClientService).getClient();
  if (!client) return;
  const keys = await client.keys('sts:throttle:otp*');
  if (keys.length > 0) await client.del(...keys);
}

async function cleanup(dataSource) {
  await dataSource.query(
    `DELETE FROM teacher_messaging_accounts
     WHERE teacher_id IN (SELECT id FROM teachers WHERE email = $1)`,
    [EMAIL],
  );
  await dataSource.query(`DELETE FROM teachers WHERE email = $1`, [EMAIL]);
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error'], rawBody: true });
  app.enableCors({ origin: [FRONTEND_URL], credentials: true });
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
  await app.listen(BACKEND_PORT, '127.0.0.1');

  const dataSource = app.get(DataSource);
  const provider = stubMessagingProvider(app);
  const codes = captureOtpCodes(app);
  await resetThrottleCounters(app);

  let chrome;
  try {
    await waitFor(async () => {
      const response = await fetch(FRONTEND_URL).catch(() => null);
      return Boolean(response?.ok);
    }, `Frontend is not serving at ${FRONTEND_URL} — start it before this smoke`);

    await cleanup(dataSource);
    await dataSource.query(
      `INSERT INTO teachers (first_name, last_name, email, teacher_status)
       VALUES ('Line', 'Browser Smoke', $1, 'ACTIVE')`,
      [EMAIL],
    );

    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');

    // 1. The public page loads and asks for an email — no token in the URL.
    await navigate(client, `${FRONTEND_URL}/line-link`);
    await waitFor(
      async () => (await bodyText(client)).includes('เชื่อมบัญชี LINE'),
      'The LINE linking page did not render',
    );
    await waitForSelector(client, '#line-link-email');
    await capture(client, 'line-link-email');

    // 2. Requesting a code moves the page to the OTP step.
    await fillInput(client, '#line-link-email', EMAIL);
    await clickText(client, 'ถัดไป');
    await waitFor(
      async () => (await bodyText(client)).includes('กรอกรหัสยืนยัน'),
      'The page did not advance to the OTP step',
    );
    // 3. A wrong code is rejected in the UI without moving on.
    await clickText(client, 'รับรหัส OTP');
    await waitFor(
      async () => (await evaluate(client, "document.querySelectorAll('input').length")) > 1,
      'The OTP boxes did not appear after requesting a code',
    );
    const code = codes.get(EMAIL);
    assert(code, 'No OTP was emailed for the smoke teacher');
    await fillOtp(client, '000000');
    await clickText(client, 'ตรวจสอบรหัส');
    await waitFor(
      async () => {
        const text = await bodyText(client);
        return text.includes('ไม่ถูกต้อง') || text.includes('หมดอายุ');
      },
      'A wrong OTP did not surface an error in the UI',
    );

    // 4. The real code reaches the "connect LINE" step.
    await fillOtp(client, code);
    await clickText(client, 'ตรวจสอบรหัส');
    await waitFor(
      async () => (await bodyText(client)).includes('เข้าสู่ระบบด้วย LINE'),
      'Verifying the OTP did not reach the connect step',
    );
    await capture(client, 'line-link-connect');

    // 5. A teacher who has not added the official account sees the add-friend screen.
    provider.friendState = 'NOT_FRIEND';
    await clickText(client, 'เข้าสู่ระบบด้วย LINE');
    await waitFor(
      async () => (await bodyText(client)).includes('เพิ่มเพื่อน'),
      'The add-friend result screen did not appear',
    );
    await capture(client, 'line-link-not-friend');
    const storedAfterRefusal = await dataSource.query(
      `SELECT count(*)::int AS count FROM teacher_messaging_accounts
       WHERE provider_user_id = $1`,
      [LINE_USER],
    );
    assert(
      Number(storedAfterRefusal[0].count) === 0,
      'A binding was stored for a teacher who had not added the account',
    );

    // 6. After adding, the same run completes and the success screen shows.
    provider.friendState = 'FRIEND';
    await navigate(client, `${FRONTEND_URL}/line-link`);
    await waitForSelector(client, '#line-link-email');
    await fillInput(client, '#line-link-email', EMAIL);
    await clickText(client, 'ถัดไป');
    await waitFor(
      async () => (await bodyText(client)).includes('กรอกรหัสยืนยัน'),
      'The second round did not reach the OTP step',
    );
    await clickText(client, 'รับรหัส OTP');
    await waitFor(
      async () => (await evaluate(client, "document.querySelectorAll('input').length")) > 1,
      'The second round did not show the OTP boxes',
    );
    await fillOtp(client, codes.get(EMAIL));
    await clickText(client, 'ตรวจสอบรหัส');
    await waitFor(
      async () => (await bodyText(client)).includes('เข้าสู่ระบบด้วย LINE'),
      'The second round did not reach the connect step',
    );
    await clickText(client, 'เข้าสู่ระบบด้วย LINE');
    await waitFor(
      async () => (await bodyText(client)).includes('สำเร็จ'),
      'The success screen did not appear after linking',
    );
    await capture(client, 'line-link-success');

    const stored = await dataSource.query(
      `SELECT friend_state FROM teacher_messaging_accounts WHERE provider_user_id = $1`,
      [LINE_USER],
    );
    assert(stored.length === 1, 'The binding was not stored exactly once');
    assert(stored[0].friend_state === 'FRIEND', 'The stored friendship state is wrong');

    console.log(
      JSON.stringify({
        status: 'line_link_browser_smoke_ok',
        checked: [
          'the public linking page renders and asks only for an email',
          'requesting a code advances the page to the OTP step',
          'a wrong code is refused in the UI',
          'a correct code reaches the connect step',
          'a teacher without the OA added lands on the add-friend screen and nothing is stored',
          'completing the flow stores exactly one reachable binding and shows the success screen',
        ],
      }),
    );
  } finally {
    await closeChrome(chrome);
    await cleanup(dataSource).catch(() => undefined);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
