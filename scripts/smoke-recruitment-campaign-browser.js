const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { RedisClientService } = require('../dist/redis/redis-client.service');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run recruitment-campaign browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9250);
const USERNAME = 'recruitment_campaign_browser_smoke';
const CAMPAIGN_NAME = `เบราว์เซอร์สโมค รับสมัคร อสม. ${Date.now()}`;

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-recruitment-campaign-chrome-'));
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
  await navigate(client, `${FRONTEND_URL}/admin-access`);
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

async function upsertActor(dataSource, passwordHash) {
  const permissions = ['field-monitor'];
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    USERNAME,
  ]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'Recruitment Campaign',
            "LastName" = 'Browser Smoke',
            status = 'ACTIVE',
            permissions = $3::jsonb,
            role = 'ADMIN',
            data_scope = '{"global":true}'::jsonb,
            must_change_password = FALSE,
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
        $1, $2, 'Recruitment Campaign', 'Browser Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
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
          deactivation_note = COALESCE(deactivation_note, 'Retained automated recruitment-campaign browser smoke fixture')
      WHERE username = $1
        AND data_origin_code = 'AUTOMATED_TEST'
    `,
    [USERNAME],
  );
}

async function cleanupData(dataSource) {
  await dataSource.query(
    `
      DELETE FROM field_followers
      WHERE campaign_id IN (SELECT id FROM follower_recruitment_campaigns WHERE name = $1)
    `,
    [CAMPAIGN_NAME],
  );
  await dataSource.query(`DELETE FROM follower_recruitment_campaigns WHERE name = $1`, [
    CAMPAIGN_NAME,
  ]);
}

async function clearSmokeThrottle(app) {
  const redisClientService = app.get(RedisClientService, { strict: false });
  const client = redisClientService?.getClient?.();
  if (!client) return;

  for (const throttleName of ['followerApplication', 'campaignLookup']) {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        'MATCH',
        `sts:throttle:${throttleName}:*`,
        'COUNT',
        100,
      );
      if (keys.length > 0) {
        await client.del(...keys);
      }
      cursor = nextCursor;
    } while (cursor !== '0');
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
    `RecruitmentCampaignBrowser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  let chrome;

  try {
    await clearSmokeThrottle(app);
    await cleanupData(dataSource);
    await disableActor(dataSource);
    const actorId = await upsertActor(dataSource, passwordHash);
    const user = {
      id: actorId,
      username: USERNAME,
      FirstName: 'Recruitment Campaign',
      LastName: 'Browser Smoke',
      roles: ['ADMIN'],
      permissions: ['field-monitor'],
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

    // 1. Admin review page renders the campaigns section.
    await navigate(client, `${FRONTEND_URL}/field-followers`);
    await waitFor(
      async () => (await bodyText(client)).includes('ลิงก์รับสมัคร อสม./ผู้ติดตาม'),
      'Campaigns section did not render on the field-followers page',
    );
    await waitFor(
      async () => (await bodyText(client)).includes('ยังไม่มีลิงก์รับสมัคร'),
      'Empty state for campaigns did not render',
    );

    // 2. Create a campaign fixture through the authenticated API. The create UI
    // lives on /create; this smoke focuses on the recruitment-link review page.
    const campaign = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/follower-recruitment-campaigns`)}, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: ${JSON.stringify(CAMPAIGN_NAME)} })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(JSON.stringify(payload));
        }
        return payload.data;
      })()`,
    );
    assert(campaign?.public_code, 'Create did not return the campaign public_code');
    assert(campaign.view_count === 0, `Expected view_count=0 before any public view, got ${campaign.view_count}`);

    await navigate(client, `${FRONTEND_URL}/field-followers`);
    await waitFor(
      async () => (await bodyText(client)).includes(CAMPAIGN_NAME),
      'New campaign did not appear in the list after create',
    );
    await capture(client, '/tmp/sts-recruitment-campaign-created.png');

    // 4. Public apply page: open by code, gated open, submit an application.
    await navigate(client, `${FRONTEND_URL}/apply/field-follower/${campaign.public_code}`);
    await waitFor(
      async () => (await bodyText(client)).includes(CAMPAIGN_NAME),
      'Public apply page did not show the campaign name',
    );
    assert(
      !(await bodyText(client)).includes('ปิดรับสมัครแล้ว'),
      'Public apply page incorrectly showed a closed message for an open campaign',
    );

    async function setInputValue(id, value) {
      await evaluate(
        client,
        `(() => {
          const input = document.getElementById(${JSON.stringify(id)});
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(value)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`,
      );
    }
    await setInputValue('follower-first-name', 'เบราว์เซอร์');
    await setInputValue('follower-last-name', 'สโมคทดสอบ');
    await setInputValue('follower-phone', '0891234567');
    await setInputValue('follower-email', 'recruitment.browser@example.test');
    await setInputValue('follower-thaid-ref', `browser-thaid-${Date.now()}`);
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button[type=submit]')]
          .find((el) => el.textContent.trim() === 'ส่งใบสมัคร');
        button?.click();
      })()`,
    );
    await waitFor(
      async () => (await bodyText(client)).includes('ส่งใบสมัครสำเร็จ'),
      'Application submit success message did not render',
    );
    await capture(client, '/tmp/sts-recruitment-campaign-applied.png');

    // 5. Back in admin: view_count/submission_count reflect the visit+submit,
    // and the campaign drill-down shows the applicant with a link to detail.
    await navigate(client, `${FRONTEND_URL}/field-followers`);
    await waitFor(
      async () => (await bodyText(client)).includes(CAMPAIGN_NAME),
      'Campaign row did not render after returning to admin',
    );
    await evaluate(
      client,
      `(() => {
        const rows = [...document.querySelectorAll('tr, article')];
        const row = rows.find((el) => el.textContent.includes(${JSON.stringify(CAMPAIGN_NAME)}));
        const button = [...(row || document).querySelectorAll('button')]
          .find((el) => el.textContent.trim().includes('ดูผู้สมัคร'));
        button?.click();
      })()`,
    );
    await waitFor(
      async () => {
        const text = await bodyText(client);
        return (
          text.includes('เบราว์เซอร์ สโมคทดสอบ') &&
          text.includes('recruitment.browser@example.test') &&
          text.includes('ยังไม่มีเคสในแคมเปญนี้')
        );
      },
      'Campaign drill-down did not show the submitted applicant and target empty state',
    );
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((el) => el.textContent.trim().includes('ดู detail'));
        button?.click();
      })()`,
    );
    await waitFor(
      async () => {
        const text = await bodyText(client);
        return text.includes('รายละเอียดใบสมัคร') && text.includes('recruitment.browser@example.test');
      },
      'Applicant detail page did not show submitted applicant fields',
    );
    const afterApply = await evaluate(
      client,
      `(async () => {
        const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/follower-recruitment-campaigns`)}, {
          credentials: 'include'
        });
        const payload = await response.json();
        return payload.data.find((row) => row.name === ${JSON.stringify(CAMPAIGN_NAME)});
      })()`,
    );
    assert(afterApply.view_count >= 1, `Expected view_count>=1 after public view, got ${afterApply.view_count}`);
    assert(
      afterApply.submission_count === 1,
      `Expected submission_count=1 after apply, got ${afterApply.submission_count}`,
    );

    // 6. Toggle off -> public apply page reports closed.
    await navigate(client, `${FRONTEND_URL}/field-followers`);
    await waitFor(
      async () => (await bodyText(client)).includes(CAMPAIGN_NAME),
      'Campaign row did not render before toggling off',
    );
    await evaluate(
      client,
      `(() => {
        const rows = [...document.querySelectorAll('tr, article')];
        const row = rows.find((el) => el.textContent.includes(${JSON.stringify(CAMPAIGN_NAME)}));
        const button = [...(row || document).querySelectorAll('button')]
          .find((el) => el.textContent.trim() === 'ปิดใช้งาน');
        button?.click();
      })()`,
    );
    await waitFor(
      async () => (await bodyText(client)).includes('เปิดใช้งาน'),
      'Toggle did not flip the campaign to closed in the admin list',
    );
    await navigate(client, `${FRONTEND_URL}/apply/field-follower/${campaign.public_code}`);
    await waitFor(
      async () => (await bodyText(client)).includes('ขณะนี้ปิดรับสมัครแล้ว'),
      'Public apply page did not report closed after toggling the campaign off',
    );
    await capture(client, '/tmp/sts-recruitment-campaign-closed.png');

    console.log('recruitment-campaign browser smoke passed');
  } catch (error) {
    if (chrome) {
      await capture(chrome.client, '/tmp/sts-recruitment-campaign-failure.png').catch(() => null);
    }
    throw error;
  } finally {
    await closeChrome(chrome);
    await cleanupData(dataSource).catch(() => null);
    await disableActor(dataSource).catch(() => null);
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
