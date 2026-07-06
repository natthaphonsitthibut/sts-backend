const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run settings browser smoke with NODE_ENV=production');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9235);
const USERNAME = 'settings_browser_smoke';
const SETTING_KEYS = ['CASE_RISK_LOW_ABSENCE_DAYS', 'ALERT_TRIGGER_TYPE', 'ALERT_SCHEDULE_TIME'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorMessage(error) {
  if (error instanceof AggregateError) {
    return error.errors.map((cause) => cause?.message || String(cause)).join(' | ');
  }
  return error?.message || String(error);
}

function returningRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-settings-chrome-'));
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
    fs.rmSync(chrome.userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
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

async function capture(client, outputPath) {
  const result = await client.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
}

async function upsertFixture(dataSource, passwordHash) {
  const permissions = ['home', 'settings'];
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [USERNAME]);
  if (existing) {
    const [updated] = returningRows(
      await dataSource.query(
        `UPDATE users
         SET password = $2, status = 'ACTIVE', permissions = $3::jsonb, role = 'ADMIN',
             data_scope = '{"global":true}'::jsonb, data_origin_code = 'AUTOMATED_TEST',
             must_change_password = FALSE, deactivated_at = NULL, deactivated_by = NULL,
             deactivation_reason_code = NULL, deactivation_note = NULL
         WHERE id = $1
         RETURNING id`,
        [existing.id, passwordHash, JSON.stringify(permissions)],
      ),
    );
    assert(updated?.id, 'Updating settings browser fixture did not return a user id');
    return updated.id;
  }
  const [created] = returningRows(
    await dataSource.query(
      `INSERT INTO users
         (username, password, "FirstName", "LastName", status, permissions, role,
          data_scope, must_change_password, data_origin_code)
       VALUES ($1, $2, 'Settings', 'Browser Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
               '{"global":true}'::jsonb, FALSE, 'AUTOMATED_TEST')
       RETURNING id`,
      [USERNAME, passwordHash, JSON.stringify(permissions)],
    ),
  );
  assert(created?.id, 'Creating settings browser fixture did not return a user id');
  return created.id;
}

async function getSettings(dataSource) {
  const rows = await dataSource.query(
    `SELECT setting_key, setting_value
     FROM system_settings
     WHERE setting_key = ANY($1::text[])
     ORDER BY setting_key`,
    [SETTING_KEYS],
  );
  const settings = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
  for (const key of SETTING_KEYS) {
    assert(settings[key], `Missing system setting ${key}`);
  }
  return settings;
}

async function restoreSettings(dataSource, originalSettings) {
  if (!originalSettings) return;
  for (const [key, value] of Object.entries(originalSettings)) {
    await dataSource.query(
      `UPDATE system_settings
       SET setting_value = $2, updated_at = CURRENT_TIMESTAMP
       WHERE setting_key = $1`,
      [key, value],
    );
  }
}

async function login(password) {
  const response = await fetch(`${BACKEND_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password }),
  });
  assert(response.status === 201, `Settings fixture login returned ${response.status}`);
  const user = await response.json();
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  assert(setCookie, 'Login did not return a session cookie');
  const [cookiePair] = setCookie.split(';');
  const separator = cookiePair.indexOf('=');
  return {
    user,
    cookieName: cookiePair.slice(0, separator),
    cookieValue: cookiePair.slice(separator + 1),
  };
}

async function waitForSettingsPage(client) {
  try {
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === '/settings' &&
        String(await evaluate(client, 'document.body.innerText')).includes(
          'CASE_RISK_LOW_ABSENCE_DAYS',
        ) &&
        String(await evaluate(client, 'document.body.innerText')).includes('ALERT_TRIGGER_TYPE') &&
        String(await evaluate(client, 'document.body.innerText')).includes('ALERT_SCHEDULE_TIME'),
      'Settings page did not render catalog rows',
    );
  } catch (error) {
    const pathname = await evaluate(client, 'location.pathname').catch(() => 'unknown');
    const snippet = String(await evaluate(client, 'document.body.innerText').catch(() => '')).slice(
      0,
      300,
    );
    throw new Error(`${errorMessage(error)} (pathname=${pathname}, body="${snippet}")`);
  }
}

async function assertSettingsTabs(client) {
  const labels = await evaluate(
    client,
    `JSON.stringify([...document.querySelectorAll('[role="tab"]')].map((tab) => ({
      text: tab.textContent.trim(),
      selected: tab.getAttribute('aria-selected'),
    })))`,
  );
  const tabs = JSON.parse(labels);
  assert(
    tabs.some((tab) => tab.text === 'ตั้งค่าระบบ' && tab.selected === 'true') &&
      tabs.some((tab) => tab.text === 'ข้อมูลพื้นฐาน') &&
      tabs.some((tab) => tab.text === 'สถานะนักเรียน'),
    `Settings tabs were not rendered correctly: ${labels}`,
  );
}

async function setIntegerSetting(client, key, value) {
  await evaluate(
    client,
    `(() => {
      const card = findSettingCard(${JSON.stringify(key)});
      const input = card.querySelector('input[type="number"]');
      if (!input) throw new Error('Number input not found for ${key}');
      if (input.min !== '1' || input.max !== '365') {
        throw new Error('Number input bounds are missing for ${key}');
      }
      input.focus();
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      valueSetter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

async function setEnumSetting(client, key, value) {
  await evaluate(
    client,
    `(() => {
      const card = findSettingCard(${JSON.stringify(key)});
      const select = card.querySelector('select');
      if (!select) throw new Error('Enum select not found for ${key}');
      const values = [...select.options].map((option) => option.value);
      if (!values.includes('SCHEDULED') || !values.includes('IMMEDIATE')) {
        throw new Error('Enum options are incomplete for ${key}: ' + values.join(','));
      }
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      valueSetter.call(select, ${JSON.stringify(value)});
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

async function setTimeSetting(client, key, value) {
  const [hour, minute] = value.split(':');
  await evaluate(
    client,
    `(() => {
      const card = findSettingCard(${JSON.stringify(key)});
      const trigger = card.querySelector('button[aria-haspopup="dialog"]');
      if (!trigger) throw new Error('Time picker trigger not found for ${key}');
      trigger.click();
    })()`,
  );
  await waitFor(
    async () =>
      await evaluate(
        client,
        `Boolean(findSettingCard(${JSON.stringify(key)}).querySelector('[role="dialog"]'))`,
      ),
    'Time picker dialog did not open',
  );
  await evaluate(
    client,
    `(() => {
      const card = findSettingCard(${JSON.stringify(key)});
      const dialog = card.querySelector('[role="dialog"]');
      const hourSelect = dialog?.querySelector('label:first-child select');
      const minuteSelect = dialog?.querySelector('label:last-child select');
      if (!dialog || !hourSelect || !minuteSelect) throw new Error('Time selects not found for ${key}');
      if (hourSelect.options.length !== 24 || minuteSelect.options.length !== 60) {
        throw new Error('Time picker does not constrain hour/minute choices');
      }
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      valueSetter.call(hourSelect, ${JSON.stringify(hour)});
      hourSelect.dispatchEvent(new Event('input', { bubbles: true }));
      hourSelect.dispatchEvent(new Event('change', { bubbles: true }));
      valueSetter.call(minuteSelect, ${JSON.stringify(minute)});
      minuteSelect.dispatchEvent(new Event('input', { bubbles: true }));
      minuteSelect.dispatchEvent(new Event('change', { bubbles: true }));
      [...card.querySelectorAll('button')]
        .find((button) => button.textContent.includes('เสร็จสิ้น'))?.click();
    })()`,
  );
}

async function saveSetting(client, key) {
  await evaluate(
    client,
    `(() => {
      const card = findSettingCard(${JSON.stringify(key)});
      const button = [...card.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.trim() === 'บันทึก');
      if (!button) throw new Error('Save button not found for ${key}');
      if (button.disabled) throw new Error('Save button is disabled for ${key}');
      button.click();
    })()`,
  );
}

async function waitForDbValue(dataSource, key, value) {
  await waitFor(async () => {
    const [row] = await dataSource.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = $1`,
      [key],
    );
    return row?.setting_value === value;
  }, `Setting ${key} did not persist value ${value}`);
}

async function waitForAudit(dataSource, actorUserId, key, previousValue, newValue) {
  await waitFor(async () => {
    const [row] = await dataSource.query(
      `SELECT COUNT(*)::int AS count
       FROM audit_log
       WHERE actor_user_id = $1
         AND action = 'SYSTEM_SETTING_EDIT'
         AND target_type = 'system_settings'
         AND target_id = $2
         AND metadata ->> 'previousValue' = $3
         AND metadata ->> 'newValue' = $4
         AND created_at > now() - interval '5 minutes'`,
      [actorUserId, key, previousValue, newValue],
    );
    return row?.count > 0;
  }, `Audit log was not written for ${key}`);
}

async function assertUiValue(client, key, value) {
  await waitFor(
    async () =>
      await evaluate(
        client,
        `(() => {
          const card = findSettingCard(${JSON.stringify(key)});
          const numberInput = card.querySelector('input[type="number"]');
          if (numberInput) return numberInput.value === ${JSON.stringify(value)};
          const enumSelect = [...card.querySelectorAll('select')]
            .find((select) => !['ชั่วโมง', 'นาที'].includes(select.getAttribute('aria-label') || ''));
          if (enumSelect) return enumSelect.value === ${JSON.stringify(value)};
          const timeButton = card.querySelector('button[aria-haspopup="dialog"]');
          return Boolean(timeButton?.textContent.includes(${JSON.stringify(value)}));
        })()`,
      ),
    `UI did not show ${key}=${value}`,
  );
}

async function installBrowserHelpers(client) {
  await evaluate(
    client,
    `window.findSettingCard = (key) => {
      const candidates = [...document.querySelectorAll('div')]
        .filter((node) => node.innerText?.includes(key))
        .filter((node) => [...node.querySelectorAll('button')].some((button) => button.textContent.trim() === 'บันทึก'));
      candidates.sort((left, right) => left.innerText.length - right.innerText.length);
      const card = candidates[0];
      if (!card) throw new Error('Setting card not found: ' + key);
      return card;
    }`,
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = `Settings-${suffix}-Password`;
  const nextValues = {};
  let chrome;
  let userId;
  let originalSettings;

  try {
    originalSettings = await getSettings(dataSource);
    nextValues.CASE_RISK_LOW_ABSENCE_DAYS =
      originalSettings.CASE_RISK_LOW_ABSENCE_DAYS === '4' ? '3' : '4';
    nextValues.ALERT_TRIGGER_TYPE =
      originalSettings.ALERT_TRIGGER_TYPE === 'IMMEDIATE' ? 'SCHEDULED' : 'IMMEDIATE';
    nextValues.ALERT_SCHEDULE_TIME =
      originalSettings.ALERT_SCHEDULE_TIME === '07:30' ? '08:45' : '07:30';

    userId = await upsertFixture(dataSource, await passwordService.hash(password));
    const session = await login(password);

    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await client.call('Network.setCookie', {
      name: session.cookieName,
      value: session.cookieValue,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });

    await navigate(client, `${FRONTEND_URL}/admin-access`);
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(session.user))});
       localStorage.setItem('admin_access', 'true');`,
    );
    await navigate(client, `${FRONTEND_URL}/settings`);
    await waitForSettingsPage(client);
    await installBrowserHelpers(client);
    await assertSettingsTabs(client);

    await setIntegerSetting(client, 'CASE_RISK_LOW_ABSENCE_DAYS', nextValues.CASE_RISK_LOW_ABSENCE_DAYS);
    await saveSetting(client, 'CASE_RISK_LOW_ABSENCE_DAYS');
    await waitForDbValue(dataSource, 'CASE_RISK_LOW_ABSENCE_DAYS', nextValues.CASE_RISK_LOW_ABSENCE_DAYS);
    await waitForAudit(
      dataSource,
      userId,
      'CASE_RISK_LOW_ABSENCE_DAYS',
      originalSettings.CASE_RISK_LOW_ABSENCE_DAYS,
      nextValues.CASE_RISK_LOW_ABSENCE_DAYS,
    );
    await assertUiValue(client, 'CASE_RISK_LOW_ABSENCE_DAYS', nextValues.CASE_RISK_LOW_ABSENCE_DAYS);

    await setEnumSetting(client, 'ALERT_TRIGGER_TYPE', nextValues.ALERT_TRIGGER_TYPE);
    await saveSetting(client, 'ALERT_TRIGGER_TYPE');
    await waitForDbValue(dataSource, 'ALERT_TRIGGER_TYPE', nextValues.ALERT_TRIGGER_TYPE);
    await waitForAudit(
      dataSource,
      userId,
      'ALERT_TRIGGER_TYPE',
      originalSettings.ALERT_TRIGGER_TYPE,
      nextValues.ALERT_TRIGGER_TYPE,
    );
    await assertUiValue(client, 'ALERT_TRIGGER_TYPE', nextValues.ALERT_TRIGGER_TYPE);

    await setTimeSetting(client, 'ALERT_SCHEDULE_TIME', nextValues.ALERT_SCHEDULE_TIME);
    await saveSetting(client, 'ALERT_SCHEDULE_TIME');
    await waitForDbValue(dataSource, 'ALERT_SCHEDULE_TIME', nextValues.ALERT_SCHEDULE_TIME);
    await waitForAudit(
      dataSource,
      userId,
      'ALERT_SCHEDULE_TIME',
      originalSettings.ALERT_SCHEDULE_TIME,
      nextValues.ALERT_SCHEDULE_TIME,
    );
    await assertUiValue(client, 'ALERT_SCHEDULE_TIME', nextValues.ALERT_SCHEDULE_TIME);

    await capture(client, '/tmp/sts-settings-desktop.png');
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/settings`);
    await waitForSettingsPage(client);
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('ตั้งค่าระบบ'),
      'Mobile settings page did not render',
    );
    await capture(client, '/tmp/sts-settings-mobile.png');

    console.log(
      'settings browser smoke passed (typed controls, save/audit, desktop/mobile render)',
    );
  } catch (error) {
    if (chrome) {
      try {
        const cardText = await evaluate(
          chrome.client,
          `(() => { try { return findSettingCard('ALERT_TRIGGER_TYPE').innerText; } catch (e) { return 'card lookup failed: ' + e.message; } })()`,
        );
        console.error('ALERT_TRIGGER_TYPE card state:', JSON.stringify(cardText).slice(0, 600));
        await capture(chrome.client, '/tmp/sts-settings-failure.png');
        console.error('failure screenshot: /tmp/sts-settings-failure.png');
      } catch {
        // best-effort diagnostics only
      }
    }
    throw error;
  } finally {
    await closeChrome(chrome);
    await restoreSettings(dataSource, originalSettings);
    if (userId) {
      await dataSource.query(
        `UPDATE users
         SET status = 'DISABLED', deactivated_at = now(),
             deactivation_reason_code = 'OTHER', deactivation_note = 'Browser smoke fixture'
         WHERE id = $1 AND username = $2`,
        [userId, USERNAME],
      );
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
