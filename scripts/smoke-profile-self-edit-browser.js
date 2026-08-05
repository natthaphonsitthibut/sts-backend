const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run profile browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5173';
const BROWSER_BACKEND_URL =
  process.env.SMOKE_BROWSER_BACKEND_URL || BACKEND_URL.replace('127.0.0.1', 'localhost');
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9232);
const USERNAME = 'profile_self_edit_browser_smoke';
const PROFILE_AUDIT_ACTION = 'USER_PROFILE_UPDATE';
const PROFILE_AUDIT_ACTION_LABEL = 'แก้ไขข้อมูลส่วนตัว';
const PROFILE_AUDIT_FIELD_COUNT_LABEL = 'จำนวนข้อมูลที่แก้';
const PROFILE_AUDIT_EXPECTED_FIELDS = [
  'FirstName',
  'LastName',
  'phone',
  'email',
  'affiliation',
  'line_id',
  'address_line',
  'address_village_no',
  'address_street',
  'address_soi',
  'address_trok',
  'address_sub_district',
  'address_district',
  'address_province',
  'address_postal_code',
  'address_latitude',
  'address_longitude',
];

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-profile-chrome-'));
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
  chrome?.client.close();
  if (chrome?.processRef) {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2_000);
      chrome.processRef.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      chrome.processRef.kill('SIGTERM');
    });
  }
  if (chrome?.userDataDir) {
    try {
      fs.rmSync(chrome.userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch {
      // Temp Chrome profile cleanup must not hide the smoke result.
    }
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

async function fillInput(client, selector, value) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) throw new Error('Input not found: ${selector}');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

async function click(client, expression, message) {
  await evaluate(
    client,
    `(() => {
      const target = ${expression};
      if (!target) throw new Error(${JSON.stringify(message)});
      target.click();
    })()`,
  );
}

async function pickComboboxOption(client, inputId, label) {
  const selector = `#${inputId}`;
  await fillInput(client, selector, label);
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `Boolean([...document.querySelectorAll('button')]
            .find((button) => button.textContent.trim() === ${JSON.stringify(label)}))`,
        ),
      ),
    `Combobox option was not available: ${label}`,
  );
  await evaluate(
    client,
    `(() => {
      const option = [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === ${JSON.stringify(label)});
      option.click();
    })()`,
  );
}

async function capture(client, outputPath) {
  const result = await client.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
}

async function getCoordinates(client) {
  return await evaluate(
    client,
    `(() => {
      const latitudeInput = document.querySelector('#address_latitude');
      const longitudeInput = document.querySelector('#address_longitude');
      if (latitudeInput && longitudeInput) {
        return {
          lat: latitudeInput.value || null,
          lng: longitudeInput.value || null,
        };
      }
      const labels = [...document.querySelectorAll('div')]
        .filter((node) => ['Latitude', 'Longitude'].includes(node.textContent.trim()));
      const read = (name) => {
        const label = labels.find((node) => node.textContent.trim() === name);
        return label?.nextElementSibling?.textContent?.trim() || null;
      };
      return { lat: read('Latitude'), lng: read('Longitude') };
    })()`,
  );
}

async function fetchBrowserJson(client, url) {
  return await evaluate(
    client,
    `fetch(${JSON.stringify(url)}, { credentials: 'include' })
      .then(async (response) => ({
        ok: response.ok,
        status: response.status,
        body: await response.json().catch(() => null),
      }))`,
  );
}

async function dragMapMarker(client) {
  const triggered = await evaluate(
    client,
    `(() => {
      const surface = document.querySelector('[data-sts-map-surface]');
      const google = window.google;
      const marker = surface?.__stsGoogleMarker;
      const position = marker?.getPosition?.();
      if (!surface || !google || !marker || !position) return false;
      const next = new google.maps.LatLng(position.lat() + 0.001, position.lng() + 0.001);
      marker.setPosition(next);
      google.maps.event.trigger(marker, 'dragend', { latLng: next });
      return true;
    })()`,
  );
  assert(triggered, 'Profile map marker was not available for drag smoke');
}

async function clickMap(client) {
  const triggered = await evaluate(
    client,
    `(() => {
      const surface = document.querySelector('[data-sts-map-surface]');
      const google = window.google;
      const map = surface?.__stsGoogleMap;
      const center = map?.getCenter?.();
      if (!surface || !google || !map || !center) return false;
      const next = new google.maps.LatLng(center.lat() + 0.002, center.lng() - 0.001);
      google.maps.event.trigger(map, 'click', { latLng: next });
      return true;
    })()`,
  );
  assert(triggered, 'Profile map was not available for click smoke');
}

function coordinatesChanged(before, after) {
  return before?.lat && before?.lng && after?.lat && after?.lng
    ? before.lat !== after.lat || before.lng !== after.lng
    : false;
}

function formatCoordinate(value) {
  return Number(value).toFixed(6);
}

function getProfileAuditLeakCandidates(values, profile) {
  return [
    values.phone,
    values.email,
    values.affiliation,
    values.lineId,
    values.houseNo,
    values.moo,
    values.trok,
    values.soi,
    values.street,
    values.subDistrict,
    values.district,
    values.province,
    values.postalCode,
    formatCoordinate(profile.address_latitude),
    formatCoordinate(profile.address_longitude),
  ].filter(
    (value) =>
      value !== null && value !== undefined && String(value).trim().length >= 4,
  );
}

function assertProfileAuditDoesNotLeak(text, values, profile, context) {
  for (const value of getProfileAuditLeakCandidates(values, profile)) {
    assert(!text.includes(String(value)), `${context} leaked profile value: ${value}`);
  }
}

async function getLatestProfileAuditId(dataSource, userId) {
  const [row] = await dataSource.query(
    `
      SELECT COALESCE(MAX(id), 0)::bigint AS id
      FROM audit_log
      WHERE action = $1
        AND target_id = $2
    `,
    [PROFILE_AUDIT_ACTION, String(userId)],
  );
  return Number(row?.id || 0);
}

async function getLatestProfileAudit(dataSource, userId, afterId) {
  let audit;
  await waitFor(async () => {
    [audit] = await dataSource.query(
      `
        SELECT id, metadata
        FROM audit_log
        WHERE action = $1
          AND target_id = $2
          AND id > $3::bigint
        ORDER BY id DESC
        LIMIT 1
      `,
      [PROFILE_AUDIT_ACTION, String(userId), afterId],
    );
    return Boolean(audit);
  }, 'USER_PROFILE_UPDATE audit row was not written for browser smoke');
  return audit;
}

async function assertProfileAuditDetailPage(client, auditId, values, profile, context) {
  await navigate(client, `${FRONTEND_URL}/audit-log/${auditId}`);
  await waitFor(async () => {
    const text = String(await evaluate(client, 'document.body.innerText'));
    return (
      text.includes('รายละเอียดรายการ') &&
      text.includes(PROFILE_AUDIT_ACTION_LABEL) &&
      text.includes(PROFILE_AUDIT_FIELD_COUNT_LABEL)
    );
  }, `${context} audit detail page did not render profile update details`);
  assertProfileAuditDoesNotLeak(
    String(await evaluate(client, 'document.body.innerText')),
    values,
    profile,
    context,
  );
}

async function upsertSmokeUser(dataSource, passwordHash) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    USERNAME,
  ]);
  if (existing) {
    const [updated] = returningRows(
      await dataSource.query(
        `
        UPDATE users
        SET password = $2,
            "FirstName" = 'ProfileBrowser',
            "LastName" = 'Smoke',
            "PersonID_Onec" = NULL,
            status = 'ACTIVE',
            permissions = '["home","audit-log","manage-users-list","attendance-dashboard"]'::jsonb,
            role = 'ADMIN',
            data_scope = '{"global":true}'::jsonb,
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            affiliation = 'Automated profile browser smoke',
            data_origin_code = 'OPERATIONAL',
            email = 'profile.browser.smoke@example.invalid',
            phone = '0891234567',
            line_id = NULL,
            address_line = NULL,
            address_village_no = NULL,
            address_street = NULL,
            address_soi = NULL,
            address_trok = NULL,
            address_sub_district = NULL,
            address_district = NULL,
            address_province = NULL,
            address_postal_code = NULL,
            address_latitude = NULL,
            address_longitude = NULL
        WHERE id = $1
        RETURNING id
      `,
        [existing.id, passwordHash],
      ),
    );
    return updated;
  }

  const [row] = returningRows(
    await dataSource.query(
      `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code, email, phone
      )
      VALUES (
        $1, $2, 'ProfileBrowser', 'Smoke', 'ACTIVE',
        '["home","audit-log","manage-users-list","attendance-dashboard"]'::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'Automated profile browser smoke',
        'OPERATIONAL', 'profile.browser.smoke@example.invalid', '0891234567'
      )
      RETURNING id
    `,
      [USERNAME, passwordHash],
    ),
  );
  return row;
}

async function disableSmokeUser(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          data_origin_code = 'AUTOMATED_TEST',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated profile browser smoke fixture')
      WHERE username = $1
    `,
    [USERNAME],
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
  const password = `ProfileBrowser-${suffix}-Password`;
  let chrome;
  let user;

  try {
    user = await upsertSmokeUser(dataSource, await passwordService.hash(password));
    const [persistedFixture] = await dataSource.query(
      `SELECT current_database() AS database_name, password FROM users WHERE id = $1`,
      [user.id],
    );
    assert(
      String(persistedFixture?.database_name || '').endsWith('_smoke'),
      'Profile browser fixture was not created in a smoke database',
    );
    assert(
      await passwordService.compare(password, persistedFixture?.password),
      'Profile browser fixture password did not persist correctly',
    );
    const loginResponse = await fetch(`${BACKEND_URL}/api/users/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password }),
    });
    assert(loginResponse.ok, `Profile browser login failed with HTTP ${loginResponse.status}`);
    const rawSessionCookie = loginResponse.headers.get('set-cookie') || '';
    const cookiePair = rawSessionCookie.split(';', 1)[0] || '';
    const cookieSeparator = cookiePair.indexOf('=');
    assert(cookieSeparator > 0, 'Profile browser login did not return a session cookie');
    const sessionCookie = {
      name: cookiePair.slice(0, cookieSeparator),
      value: cookiePair.slice(cookieSeparator + 1),
    };
    const [location] = await dataSource.query(
      `
        SELECT province, district, sub_district
        FROM schools
        WHERE NULLIF(TRIM(province), '') IS NOT NULL
          AND NULLIF(TRIM(district), '') IS NOT NULL
          AND NULLIF(TRIM(sub_district), '') IS NOT NULL
        ORDER BY province ASC, district ASC, sub_district ASC
        LIMIT 1
      `,
    );
    assert(location, 'No school location fixture was available for profile address smoke');

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

    await navigate(client, `${FRONTEND_URL}/login`);
    await client.call('Network.setCookie', {
      name: sessionCookie.name,
      value: sessionCookie.value,
      url: BROWSER_BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    const browserSessionStatus = await evaluate(
      client,
      `fetch(${JSON.stringify(`${BROWSER_BACKEND_URL}/api/users/me`)}, { credentials: 'include' }).then((response) => response.status)`,
    );
    assert(
      browserSessionStatus === 200,
      `Profile browser session preflight failed with HTTP ${browserSessionStatus}`,
    );
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(
        JSON.stringify({
          id: user.id,
          username: USERNAME,
          FirstName: 'ProfileBrowser',
          LastName: 'Smoke',
          roles: ['ADMIN'],
          permissions: ['home', 'audit-log', 'manage-users-list', 'attendance-dashboard'],
          data_scope: { global: true },
          must_change_password: false,
        }),
      )}); localStorage.setItem('admin_access', 'true');`,
    );
    await navigate(client, `${FRONTEND_URL}/profile`);
    try {
      await waitFor(
        async () =>
          (await evaluate(client, 'location.pathname')) === '/profile' &&
          String(await evaluate(client, 'document.body.innerText')).includes('โปรไฟล์ของฉัน') &&
          String(await evaluate(client, 'document.body.innerText')).includes('แก้ไขข้อมูลส่วนตัว') &&
          !Boolean(await evaluate(client, `document.querySelector('#FirstName')`)),
        'Profile page did not render',
      );
    } catch (error) {
      const pathname = await evaluate(client, 'location.pathname');
      const pageText = String(await evaluate(client, 'document.body.innerText')).slice(0, 500);
      throw new Error(`${error.message}; path=${pathname}; page=${pageText}`);
    }
    assert(
      Boolean(
        await evaluate(
          client,
          `[...document.querySelectorAll('div')].some((element) => {
            const label = element.firstElementChild?.textContent?.trim();
            return label === 'เลขบัตรประชาชน' && element.textContent.includes('-');
          })`,
        ),
      ),
      'Missing national id did not render as an empty profile detail',
    );
    assert(
      Boolean(
        await evaluate(
          client,
          `Boolean(document.querySelector('a[href="/manage-users/${user.id}/edit"]'))`,
        ),
      ),
      'Manage-users national-id edit link did not render for an authorized user',
    );
    assert(
      !Boolean(await evaluate(client, `document.querySelector('#FirstName')`)),
      'Profile view mode rendered editable form controls',
    );
    assert(
      !Boolean(await evaluate(client, `document.querySelector('button[type="submit"]')`)),
      'Profile exposed a save action before edit mode was selected',
    );
    assert(
      Boolean(
        await evaluate(
          client,
          `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'แก้ไขข้อมูลส่วนตัว')`,
        ),
      ),
      'Profile edit-mode button did not render',
    );

    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('เปลี่ยนรหัสผ่าน'))`,
      'Change-password entry point was not found on profile',
    );
    await waitFor(
      async () => (await evaluate(client, 'location.pathname')) === '/change-password',
      'Voluntary change-password page did not open',
    );
    await waitFor(
      async () => String(await evaluate(client, 'document.body.innerText')).includes('กลับโปรไฟล์'),
      'Voluntary change-password page did not finish rendering',
    );
    const voluntaryPasswordText = String(await evaluate(client, 'document.body.innerText'));
    assert(
      !voluntaryPasswordText.includes('ต้องเปลี่ยนรหัสผ่านก่อนใช้งานส่วนอื่นของระบบ'),
      'Voluntary change-password page incorrectly showed the forced warning',
    );
    assert(
      voluntaryPasswordText.includes('กลับโปรไฟล์'),
      'Voluntary change-password page did not show the back button',
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('กลับโปรไฟล์'))`,
      'Back-to-profile button was not found',
    );
    await waitFor(
      async () =>
        (await evaluate(client, 'location.pathname')) === '/profile' &&
        !Boolean(await evaluate(client, `document.querySelector('#FirstName')`)),
      'Back-to-profile navigation did not complete',
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'แก้ไขข้อมูลส่วนตัว')`,
      'Profile edit-mode button was not found',
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `(() => {
              const firstName = document.querySelector('#FirstName');
              const addressLine = document.querySelector('#address_line');
              const submit = document.querySelector('button[type="submit"]');
              return Boolean(firstName && !firstName.readOnly && addressLine && !addressLine.disabled && submit);
            })()`,
          ),
        ),
      'Profile did not enter edit mode',
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('ย้อนกลับ'))`,
      'Profile edit-mode back button was not found',
    );
    await waitFor(
      async () =>
        !Boolean(await evaluate(client, `document.querySelector('#FirstName')`)) &&
        !Boolean(await evaluate(client, `document.querySelector('button[type="submit"]')`)),
      'Profile back button did not return to detail mode',
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'แก้ไขข้อมูลส่วนตัว')`,
      'Profile edit-mode button was not found after returning to view mode',
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `(() => {
              const firstName = document.querySelector('#FirstName');
              const submit = document.querySelector('button[type="submit"]');
              return Boolean(firstName && !firstName.readOnly && submit);
            })()`,
          ),
        ),
      'Profile did not re-enter edit mode',
    );

    const values = {
      firstName: 'ProfileBrowserSmoke',
      lastName: 'Verified',
      phone: '0897654321',
      email: 'profile.browser.smoke@example.invalid',
      affiliation: 'Automated profile browser smoke updated',
      lineId: 'profile-browser-smoke-line',
      houseNo: '99/7',
      moo: '5',
      trok: 'ทดสอบ',
      soi: 'ทดสอบ',
      street: 'ทดสอบ',
      province: location.province,
      district: location.district,
      subDistrict: location.sub_district,
      postalCode: '10220',
    };

    await fillInput(client, '#FirstName', values.firstName);
    await fillInput(client, '#LastName', values.lastName);
    await fillInput(client, '#phone', values.phone);
    await fillInput(client, '#email', values.email);
    await fillInput(client, '#affiliation', values.affiliation);
    await fillInput(client, '#line_id', values.lineId);
    await fillInput(client, '#address_line', values.houseNo);
    await fillInput(client, '#address_village_no', values.moo);
    await fillInput(client, '#address_trok', values.trok);
    await fillInput(client, '#address_soi', values.soi);
    await fillInput(client, '#address_street', values.street);
    await pickComboboxOption(client, 'address_province', values.province);
    await pickComboboxOption(client, 'address_district', values.district);
    await pickComboboxOption(client, 'address_sub_district', values.subDistrict);
    await fillInput(client, '#address_postal_code', values.postalCode);

    const mapUxText = String(await evaluate(client, 'document.body.innerText'));
    assert(
      mapUxText.includes('ผลค้นหาเป็นตำแหน่งโดยประมาณ — ลากหมุดปรับให้ตรงจุดจริง'),
      'Approximate geocode hint was not rendered',
    );
    assert(
      mapUxText.includes('ใช้ที่อยู่ที่กรอกไว้'),
      'Filled-address map shortcut was not rendered',
    );
    assert(
      !mapUxText.includes('ค้นหาพิกัดจากที่อยู่'),
      'Legacy address geocode button was still rendered',
    );

    await fillInput(client, 'input[placeholder="ค้นหาที่อยู่หรือสถานที่"]', 'เชียงใหม่ ประเทศไทย');
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `(() => {
              const button = document.querySelector('button[aria-label="ค้นหาตำแหน่งบนแผนที่"]');
              return Boolean(button && !button.disabled);
            })()`,
          ),
        ),
      'Map place-search button did not become ready',
      30_000,
    );
    await click(
      client,
      `document.querySelector('button[aria-label="ค้นหาตำแหน่งบนแผนที่"]')`,
      'Map place-search button was not found',
    );
    await waitFor(async () => {
      const text = String(await evaluate(client, 'document.body.innerText'));
      if (text.includes('ค้นหาพิกัดไม่สำเร็จ')) {
        throw new Error('Profile place-search request failed');
      }
      const coords = await getCoordinates(client);
      return Boolean(coords.lat && coords.lng);
    }, 'Map place search did not populate coordinates', 30_000);
    const placeSearchCoordinates = await getCoordinates(client);

    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('ใช้ที่อยู่ที่กรอกไว้'))`,
      'Filled-address map shortcut was not found',
    );
    await waitFor(async () => {
      const text = String(await evaluate(client, 'document.body.innerText'));
      if (text.includes('ยังไม่ได้ตั้งค่า Google Maps')) {
        throw new Error('VITE_GOOGLE_MAPS_BROWSER_KEY is not configured for the running frontend');
      }
      if (text.includes('โหลดแผนที่ไม่สำเร็จ')) {
        throw new Error('Google Maps browser surface did not load');
      }
      if (text.includes('ค้นหาพิกัดไม่สำเร็จ')) {
        throw new Error('Profile geocode request failed');
      }
      const coords = await getCoordinates(client);
      return coordinatesChanged(placeSearchCoordinates, coords);
    }, 'Filled-address shortcut did not update profile coordinates', 30_000);

    await fillInput(client, '#address_latitude', '91');
    await fillInput(client, '#address_longitude', '181');
    await waitFor(async () => {
      const text = String(await evaluate(client, 'document.body.innerText'));
      return (
        text.includes('ละติจูดต้องอยู่ระหว่าง -90 ถึง 90') &&
        text.includes('ลองจิจูดต้องอยู่ระหว่าง -180 ถึง 180')
      );
    }, 'Coordinate range errors were not rendered in Thai');
    const invalidCoordinates = await getCoordinates(client);
    assert(
      invalidCoordinates.lat === '91' && invalidCoordinates.lng === '181',
      'Invalid coordinate input was cleared before the user could correct it',
    );

    await fillInput(client, '#address_latitude', '13.7563');
    await fillInput(client, '#address_longitude', '100.5018');
    await waitFor(async () => {
      const coords = await getCoordinates(client);
      return Number(coords.lat) === 13.7563 && Number(coords.lng) === 100.5018;
    }, 'Direct coordinate input did not retain valid values');

    const geocodedCoordinates = await getCoordinates(client);
    await dragMapMarker(client);
    await waitFor(async () => {
      const next = await getCoordinates(client);
      return coordinatesChanged(geocodedCoordinates, next);
    }, 'Dragging the profile marker did not update coordinates');

    const draggedCoordinates = await getCoordinates(client);
    await clickMap(client);
    await waitFor(async () => {
      const next = await getCoordinates(client);
      return coordinatesChanged(draggedCoordinates, next);
    }, 'Clicking the profile map did not update coordinates');

    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `(() => {
              const button = document.querySelector('button[type="submit"]');
              return button && !button.disabled;
            })()`,
          ),
        ),
      'Profile save button did not become enabled',
    );
    const latestAuditIdBeforeSave = await getLatestProfileAuditId(dataSource, user.id);
    await click(
      client,
      `document.querySelector('button[type="submit"]')`,
      'Profile save button was not found',
    );
    await waitFor(async () => {
      const text = String(await evaluate(client, 'document.body.innerText'));
      if (text.includes('บันทึกโปรไฟล์ไม่สำเร็จ')) {
        throw new Error('Profile save rendered an error alert');
      }
      return text.includes('บันทึกโปรไฟล์เรียบร้อยแล้ว');
    }, 'Profile success message did not render after save');
    assert(
      !Boolean(await evaluate(client, `document.querySelector('#FirstName')`)),
      'Profile did not return to detail mode after save',
    );
    assert(
      !Boolean(await evaluate(client, `document.querySelector('button[type="submit"]')`)),
      'Profile save action remained visible after save',
    );
    let savedProfile = null;
    await waitFor(async () => {
      const result = await fetchBrowserJson(client, `${BROWSER_BACKEND_URL}/api/users/me`);
      if (!result.ok) return false;
      const lat = Number(result.body?.address_latitude);
      const lng = Number(result.body?.address_longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        savedProfile = { ...result.body, address_latitude: lat, address_longitude: lng };
        return true;
      }
      return false;
    }, 'Saved profile coordinates were not persisted in DB', 60_000);
    const expectedCoordinates = {
      lat: formatCoordinate(savedProfile.address_latitude),
      lng: formatCoordinate(savedProfile.address_longitude),
    };
    const profileAudit = await getLatestProfileAudit(dataSource, user.id, latestAuditIdBeforeSave);
    assert(
      Array.isArray(profileAudit.metadata?.fields),
      'Profile browser audit metadata did not include fields',
    );
    const auditFields = profileAudit.metadata.fields;
    assert(
      PROFILE_AUDIT_EXPECTED_FIELDS.every((field) => auditFields.includes(field)),
      `Profile browser audit metadata omitted fields: ${PROFILE_AUDIT_EXPECTED_FIELDS.filter(
        (field) => !auditFields.includes(field),
      ).join(', ')}`,
    );
    assert(
      profileAudit.metadata.fieldCount === auditFields.length,
      'Profile browser audit metadata field count does not match fields length',
    );
    await capture(client, '/tmp/sts-profile-self-edit-desktop.png');

    await client.call('Page.reload');
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes(values.firstName) &&
        !Boolean(await evaluate(client, `document.querySelector('#FirstName')`)),
      'Saved profile did not persist after refresh',
    );
    await waitFor(
      async () =>
        Boolean(
          await evaluate(
            client,
            `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'แก้ไขข้อมูลส่วนตัว')`,
          ),
        ),
      'Profile detail actions did not finish loading after refresh',
    );
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'แก้ไขข้อมูลส่วนตัว')`,
      'Profile edit-mode button was not found after refresh',
    );
    await waitFor(
      async () =>
        (await evaluate(client, `document.querySelector('#FirstName')?.value`)) === values.firstName,
      'Saved profile did not populate edit mode after refresh',
    );
    await waitFor(async () => {
      const coords = await getCoordinates(client);
      return coords.lat === expectedCoordinates.lat && coords.lng === expectedCoordinates.lng;
    }, 'Saved profile coordinates did not persist after refresh');
    await click(
      client,
      `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('ย้อนกลับ'))`,
      'Profile back button was not found after refresh verification',
    );

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/profile`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('โปรไฟล์ของฉัน') &&
        String(await evaluate(client, 'document.body.innerText')).includes(values.firstName) &&
        !Boolean(await evaluate(client, `document.querySelector('#FirstName')`)),
      'Mobile profile page did not render saved data',
    );
    await capture(client, '/tmp/sts-profile-self-edit-mobile.png');

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await assertProfileAuditDetailPage(client, profileAudit.id, values, savedProfile, 'Desktop');
    await capture(client, '/tmp/sts-profile-self-edit-audit-detail-desktop.png');

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await assertProfileAuditDetailPage(client, profileAudit.id, values, savedProfile, 'Mobile');
    await capture(client, '/tmp/sts-profile-self-edit-audit-detail-mobile.png');

    assert(savedProfile.FirstName === values.firstName, 'FirstName did not persist through API refresh');
    assert(savedProfile.LastName === values.lastName, 'LastName did not persist through API refresh');
    assert(savedProfile.phone === values.phone, 'Phone did not persist through API refresh');
    assert(savedProfile.email === values.email, 'Email did not persist through API refresh');
    assert(savedProfile.affiliation === values.affiliation, 'Affiliation did not persist through API refresh');
    assert(savedProfile.line_id === values.lineId, 'LINE ID did not persist through API refresh');
    assert(savedProfile.address_line === values.houseNo, 'Address line did not persist through API refresh');
    assert(savedProfile.address_village_no === values.moo, 'Village no did not persist through API refresh');
    assert(savedProfile.address_trok === values.trok, 'Trok did not persist through API refresh');
    assert(savedProfile.address_soi === values.soi, 'Soi did not persist through API refresh');
    assert(savedProfile.address_street === values.street, 'Street did not persist through API refresh');
    assert(savedProfile.address_sub_district === values.subDistrict, 'Sub-district did not persist through API refresh');
    assert(savedProfile.address_district === values.district, 'District did not persist through API refresh');
    assert(savedProfile.address_province === values.province, 'Province did not persist through API refresh');
    assert(
      /^\d{5}$/.test(String(savedProfile.address_postal_code || '')),
      'Postal code did not persist through API refresh',
    );

    console.log(
      'profile browser smoke passed (profile/password, map search/shortcut/coordinates, save/mobile/audit)',
    );
  } finally {
    await closeChrome(chrome);
    await disableSmokeUser(dataSource);
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
