const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { VALID_PERMISSION_IDS } = require('../dist/auth/permissions.constants');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run role/scope browser smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3000';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9236);

const ADMIN_USERNAME = 'role_scope_browser_admin';
const TEACHER_USERNAME = 'role_scope_browser_teacher';
const NATIONAL_USERNAME = 'role_scope_browser_national';

// A school in sts_smoke with a full province/district/sub_district chain so the
// scope editor can resolve the real school NAME (not "โรงเรียน 1 แห่ง").
const SCHOOL = {
  id: 10010001,
  name: 'โรงเรียนอนุบาลวัดกลาง',
  province: 'กรุงเทพมหานคร',
  district: 'พระนคร',
  sub_district: 'สำราญราษฎร์',
};
const TEACHER_SCOPE = {
  provinces: [SCHOOL.province],
  districts: [SCHOOL.district],
  sub_districts: [SCHOOL.sub_district],
  school_ids: [SCHOOL.id],
};
// TEACHER default permissions -> Thai catalog labels shown in the review dialog.
const TEACHER_PERMISSION_LABELS = ['หน้าหลัก', 'รายชื่อนักเรียน', 'เช็คชื่อ'];
const ALL_PERMISSIONS = [...VALID_PERMISSION_IDS];

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-rolescope-chrome-'));
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

async function capture(client, outputPath) {
  const result = await client.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
}

async function bodyText(client) {
  return String(await evaluate(client, 'document.body.innerText'));
}

async function upsertUser(dataSource, { username, role, dataScope, permissions, passwordHash, personId }) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing) {
    const [updated] = returningRows(
      await dataSource.query(
        `UPDATE users
         SET password = $2, status = 'ACTIVE', role = $3, permissions = $4::jsonb,
             data_scope = $5::jsonb, "PersonID_Onec" = $6, "FirstName" = 'Role', "LastName" = 'Scope Smoke',
             data_origin_code = 'AUTOMATED_TEST', must_change_password = FALSE,
             deactivated_at = NULL, deactivated_by = NULL,
             deactivation_reason_code = NULL, deactivation_note = NULL
         WHERE id = $1
         RETURNING id`,
        [existing.id, passwordHash, role, JSON.stringify(permissions), JSON.stringify(dataScope), personId],
      ),
    );
    assert(updated?.id, `Updating fixture ${username} did not return an id`);
    return updated.id;
  }
  const [created] = returningRows(
    await dataSource.query(
      `INSERT INTO users
         (username, password, "FirstName", "LastName", "PersonID_Onec", status, permissions, role,
          data_scope, must_change_password, data_origin_code)
       VALUES ($1, $2, 'Role', 'Scope Smoke', $3, 'ACTIVE', $4::jsonb, $5,
               $6::jsonb, FALSE, 'AUTOMATED_TEST')
       RETURNING id`,
      [username, passwordHash, personId, JSON.stringify(permissions), role, JSON.stringify(dataScope)],
    ),
  );
  assert(created?.id, `Creating fixture ${username} did not return an id`);
  return created.id;
}

async function disableUser(dataSource, id, username) {
  if (!id) return;
  await dataSource.query(
    `UPDATE users
     SET status = 'DISABLED', deactivated_at = now(),
         deactivation_reason_code = 'OTHER', deactivation_note = 'Browser smoke fixture'
     WHERE id = $1 AND username = $2`,
    [id, username],
  );
}

async function login(username, password) {
  const response = await fetch(`${BACKEND_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert(response.status === 201, `Fixture login for ${username} returned ${response.status}`);
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

async function comboboxValue(client, id) {
  return await evaluate(client, `document.getElementById(${JSON.stringify(id)})?.value ?? ''`);
}

async function waitForEditForm(client, roleLabel) {
  // The role/scope pickers are `<input>`-backed Comboboxes, so the selected
  // label lives in the input's `value`, not in the page text.
  await waitFor(async () => {
    const text = await bodyText(client);
    return (
      String(await evaluate(client, 'location.pathname')).includes('/edit') &&
      text.includes('สิทธิ์การใช้งาน') &&
      text.includes('ขอบเขตข้อมูล') &&
      (await comboboxValue(client, 'role')) === roleLabel
    );
  }, `Edit form did not render for role ${roleLabel}`);
}

async function clickSaveButton(client) {
  const clicked = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button[type="submit"]')]
        .find((candidate) => candidate.textContent.trim().startsWith('บันทึก'));
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert(clicked, 'Save button was not found');
}

async function clickButton(client, label) {
  const result = await evaluate(
    client,
    `(() => {
      const buttons = [...document.querySelectorAll('button')];
      const button = buttons
        .find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)});
      if (!button) {
        return {
          clicked: false,
          labels: buttons.map((candidate) => candidate.textContent.trim()).filter(Boolean),
        };
      }
      button.click();
      return { clicked: true, labels: [] };
    })()`,
  );
  assert(
    result?.clicked,
    `Button "${label}" was not found (available: ${JSON.stringify(result?.labels ?? [])})`,
  );
}

async function selectComboboxOption(client, ariaLabel, optionLabel) {
  await waitFor(
    async () =>
      Boolean(
        await evaluate(
          client,
          `Boolean(document.querySelector('input[aria-label=${JSON.stringify(ariaLabel)}]'))`,
        ),
      ),
    `Combobox "${ariaLabel}" did not render`,
  );
  const opened = await evaluate(
    client,
    `(() => {
      const input = document.querySelector('input[aria-label=${JSON.stringify(ariaLabel)}]');
      if (!input) return false;
      input.click();
      return true;
    })()`,
  );
  assert(opened, `Combobox "${ariaLabel}" was not found`);
  await waitFor(
    async () =>
      await evaluate(
        client,
        `Boolean([...document.querySelectorAll('li button')]
          .find((button) => button.textContent.trim() === ${JSON.stringify(optionLabel)}))`,
      ),
    `Combobox option "${optionLabel}" did not open`,
  );
  const selected = await evaluate(
    client,
    `(() => {
      const option = [...document.querySelectorAll('li button')]
        .find((button) => button.textContent.trim() === ${JSON.stringify(optionLabel)});
      if (!option) return false;
      option.click();
      return true;
    })()`,
  );
  assert(selected, `Combobox option "${optionLabel}" was not found`);
}

// The base Dialog renders as an overlay `<div class="fixed inset-0 z-50 …">`
// with no role="dialog"; locate it from its <h2> title instead.
const DIALOG_ROOT = `(() => {
  const title = [...document.querySelectorAll('h2')]
    .find((node) => node.textContent.includes('ตรวจสอบก่อน'));
  if (!title) return null;
  let node = title;
  while (node) {
    const cls = String(node.className || '');
    if (cls.includes('fixed') && cls.includes('inset-0')) return node;
    node = node.parentElement;
  }
  return title.closest('div');
})()`;

async function waitForReviewDialog(client, isEdit) {
  const title = isEdit ? 'ตรวจสอบก่อนบันทึกการแก้ไข' : 'ตรวจสอบก่อนสร้างบัญชี';
  await waitFor(
    async () =>
      await evaluate(
        client,
        `Boolean([...document.querySelectorAll('h2')]
          .find((node) => node.textContent.includes(${JSON.stringify(title)})))`,
      ),
    `Review dialog "${title}" did not open`,
  );
}

async function reviewDialogText(client) {
  return String(await evaluate(client, `(() => { const d = ${DIALOG_ROOT}; return d ? d.innerText : ''; })()`));
}

async function clickDialogButton(client, label) {
  const result = await evaluate(
    client,
    `(() => {
      const dialog = ${DIALOG_ROOT};
      if (!dialog) return { clicked: false, labels: [] };
      const buttons = [...dialog.querySelectorAll('button')];
      const button = buttons
        .find((candidate) => candidate.textContent.trim().startsWith(${JSON.stringify(label)}));
      if (!button) {
        return {
          clicked: false,
          labels: buttons.map((candidate) => candidate.textContent.trim()).filter(Boolean),
        };
      }
      button.click();
      return { clicked: true, labels: [] };
    })()`,
  );
  assert(
    result?.clicked,
    `Dialog button "${label}" was not found (available: ${JSON.stringify(result?.labels ?? [])})`,
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminPassword = `Role-${suffix}-Admin`;
  const menuGroupLabel = `กลุ่มเมนูทดสอบ ${suffix}`;
  let chrome;
  let adminId;
  let teacherId;
  let nationalId;

  try {
    const adminHash = await passwordService.hash(adminPassword);
    const teacherHash = await passwordService.hash(`Role-${suffix}-Teacher`);
    const nationalHash = await passwordService.hash(`Role-${suffix}-National`);

    adminId = await upsertUser(dataSource, {
      username: ADMIN_USERNAME, role: 'ADMIN', dataScope: { global: true },
      permissions: ALL_PERMISSIONS, passwordHash: adminHash, personId: '1000000000001',
    });
    teacherId = await upsertUser(dataSource, {
      username: TEACHER_USERNAME, role: 'TEACHER', dataScope: TEACHER_SCOPE,
      permissions: [], passwordHash: teacherHash, personId: '1000000000002',
    });
    nationalId = await upsertUser(dataSource, {
      username: NATIONAL_USERNAME, role: 'DIRECTOR', dataScope: { global: true },
      permissions: [], passwordHash: nationalHash, personId: '1000000000003',
    });

    const session = await login(ADMIN_USERNAME, adminPassword);
    const scopedSchoolsResponse = await fetch(`${BACKEND_URL}/api/school-structure/schools`, {
      headers: { cookie: `${session.cookieName}=${session.cookieValue}` },
    });
    const scopedSchoolsBody = await scopedSchoolsResponse.text();
    assert(
      scopedSchoolsResponse.status === 200,
      `Scoped schools returned ${scopedSchoolsResponse.status}: ${scopedSchoolsBody.slice(0, 300)}`,
    );

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

    await navigate(client, `${FRONTEND_URL}/login`);
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(session.user))});
       localStorage.setItem('admin_access', 'true');`,
    );
    const browserSchoolsProbe = await evaluate(
      client,
      `fetch(${JSON.stringify(`${BACKEND_URL}/api/school-structure/schools`)}, {
        credentials: 'include'
      }).then(async (response) => ({ status: response.status, body: await response.text() }))
        .catch((error) => ({ status: 0, body: error.message }))`,
    );
    assert(
      browserSchoolsProbe?.status === 200,
      `Browser scoped-schools probe failed: ${JSON.stringify(browserSchoolsProbe)}`,
    );

    // --- Test 0: school-scoped menu groups, server sort/pagination and dialog UI ---
    await navigate(client, `${FRONTEND_URL}/manage-role-groups`);
    await waitFor(
      async () => (await bodyText(client)).includes('จัดการกลุ่มเมนู'),
      'Menu-group page did not render',
    );
    await waitFor(
      async () => {
        const text = await bodyText(client);
        if (text.includes('เลือกโรงเรียน')) return true;
        throw new Error(text.slice(0, 500));
      },
      'Nationwide admin was not required to select a school',
    );
    await selectComboboxOption(client, 'กรองตามโรงเรียน', SCHOOL.name);
    await clickButton(client, 'เพิ่มกลุ่มเมนู');
    await waitFor(
      async () => (await bodyText(client)).includes('กำหนดชื่อและเมนูสำหรับ'),
      'Create menu-group dialog did not open',
    );
    await evaluate(
      client,
      `(() => {
        const input = document.getElementById('menu-group-label');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(menuGroupLabel)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const checkbox = [...document.querySelectorAll('label')]
          .find((label) => label.textContent.trim() === 'หน้าหลัก')?.querySelector('input');
        checkbox?.click();
      })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    const menuGroupFieldGeometry = await evaluate(
      client,
      `(() => {
        const labelInput = document.getElementById('menu-group-label');
        const rankCombobox = document.getElementById('menu-group-rank');
        const rankHeader = document.querySelector('label[for="menu-group-rank"]')?.parentElement;
        const labelRect = labelInput?.getBoundingClientRect();
        const rankRect = rankCombobox?.getBoundingClientRect();
        return {
          labelTop: labelRect?.top ?? 0,
          labelHeight: labelRect?.height ?? 0,
          rankTop: rankRect?.top ?? 0,
          rankHeight: rankRect?.height ?? 0,
          rankHeaderAlignment: rankHeader ? getComputedStyle(rankHeader).alignItems : '',
        };
      })()`,
    );
    assert(
      Math.abs(menuGroupFieldGeometry.labelTop - menuGroupFieldGeometry.rankTop) <= 1 &&
        Math.abs(menuGroupFieldGeometry.labelHeight - menuGroupFieldGeometry.rankHeight) <= 1 &&
        menuGroupFieldGeometry.rankHeaderAlignment === 'baseline',
      `Menu-group fields were not position-aligned: ${JSON.stringify(menuGroupFieldGeometry)}`,
    );
    await capture(client, '/tmp/sts-role-groups-dialog-desktop.png');
    await clickSaveButton(client);
    await waitFor(
      async () => {
        const text = await bodyText(client);
        return text.includes(menuGroupLabel) && !text.includes('กำหนดชื่อและเมนูสำหรับ');
      },
      'Created school menu group did not appear in the table',
    );
    const menuGroupPageText = await bodyText(client);
    assert(
      ['กลุ่มเมนู', 'เมนู', 'เครื่องมือ'].every((heading) => menuGroupPageText.includes(heading)),
      'Menu-group table headings do not match the approved reference',
    );
    assert(
      await evaluate(
        client,
        `document.querySelectorAll('thead button').length >= 2`,
      ),
      'Menu-group table did not expose sortable headers',
    );
    await capture(client, '/tmp/sts-role-groups-desktop.png');

    // --- Test A: edit a school-scoped TEACHER -> real names, Thai perms, preserve scope ---
    await navigate(client, `${FRONTEND_URL}/manage-users/${teacherId}/edit/permissions`);
    await waitForEditForm(client, 'คุณครู');

    // Scope editor must resolve the real school NAME (not an id/count) into the
    // school Combobox, and mirror the school's province.
    await waitFor(
      async () => (await comboboxValue(client, 'scope-school')) === SCHOOL.name,
      'Scope editor did not resolve the real school name',
    );
    assert(
      (await comboboxValue(client, 'scope-province')) === SCHOOL.province,
      'Scope editor did not preserve the school province',
    );
    // Permission checkboxes must use Thai catalog labels, never raw ids.
    const editorText = await bodyText(client);
    assert(
      editorText.includes('จัดการรายชื่อผู้ใช้งาน') && editorText.includes('บันทึกการใช้งาน'),
      'Permission editor did not render Thai catalog labels',
    );
    assert(
      !editorText.includes('manage-users-list') && !editorText.includes('audit-log'),
      'Permission editor leaked raw permission ids',
    );
    await capture(client, '/tmp/sts-role-scope-edit-desktop.png');

    await clickSaveButton(client);
    await waitForReviewDialog(client, true);
    const reviewA = await reviewDialogText(client);
    assert(
      reviewA.includes(SCHOOL.name) && reviewA.includes(SCHOOL.province),
      `Review dialog did not show the resolved scope name: ${reviewA.slice(0, 300)}`,
    );
    assert(
      !reviewA.includes('ทั้งประเทศ'),
      'Editing a school-scoped teacher must NOT show a nationwide scope',
    );
    for (const label of TEACHER_PERMISSION_LABELS) {
      assert(reviewA.includes(label), `Review dialog missing Thai permission label "${label}"`);
    }
    await capture(client, '/tmp/sts-role-scope-review-desktop.png');

    await clickDialogButton(client, 'ยืนยันบันทึก');
    await waitFor(
      async () => !String(await evaluate(client, 'location.pathname')).includes('/edit'),
      'Save did not navigate away from the edit form',
    );

    // Preserve-scope proof: the persisted scope is unchanged (no widening).
    const [teacherRow] = await dataSource.query(`SELECT data_scope FROM users WHERE id = $1`, [teacherId]);
    const persisted = teacherRow?.data_scope || {};
    assert(
      Array.isArray(persisted.school_ids) && persisted.school_ids.map(Number).includes(SCHOOL.id),
      `Teacher school scope was not preserved after save: ${JSON.stringify(persisted)}`,
    );
    assert(
      persisted.global !== true && persisted.own_only !== true,
      `Teacher scope was widened after save: ${JSON.stringify(persisted)}`,
    );

    // --- Test A2: hidden invalid profile data must never swallow permission save ---
    // Recreate the production condition that triggered the owner report: an
    // older account has an empty national id and retired permission ids.
    await dataSource.query(
      `UPDATE users
       SET "PersonID_Onec" = '',
           permissions = $2::jsonb
       WHERE id = $1`,
      [teacherId, JSON.stringify(['home', 'forward-case', 'attendance-operations'])],
    );
    await navigate(client, `${FRONTEND_URL}/manage-users/${teacherId}/edit/permissions`);
    await waitForEditForm(client, 'คุณครู');
    await clickSaveButton(client);
    await waitFor(async () => {
      const text = await bodyText(client);
      return text.includes('ยังบันทึกไม่ได้') && text.includes('อยู่ในแท็บข้อมูล');
    }, 'Hidden validation error was not surfaced after save');
    assert(
      !(await reviewDialogText(client)),
      'Review dialog opened even though hidden profile data was invalid',
    );

    await clickButton(client, 'ไปแก้ในแท็บข้อมูล');
    await waitFor(
      async () => String(await evaluate(client, 'location.pathname')).endsWith('/edit'),
      'Invalid-field action did not navigate to the information tab',
    );
    await waitFor(
      async () =>
        (await evaluate(client, 'document.activeElement?.getAttribute("name")')) ===
        'PersonID_Onec',
      'Invalid national-id field was not focused',
    );
    await evaluate(
      client,
      `(() => {
        const input = document.querySelector('[name="PersonID_Onec"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '1000000000002');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
    );
    await clickButton(client, 'สิทธิ์');
    await waitFor(
      async () => String(await evaluate(client, 'location.pathname')).endsWith('/edit/permissions'),
      'Permission tab did not reopen after fixing hidden data',
    );
    await clickSaveButton(client);
    await waitForReviewDialog(client, true);
    const cleanupReview = await reviewDialogText(client);
    assert(
      cleanupReview.includes('forward-case') && cleanupReview.includes('attendance-operations'),
      'Review dialog did not disclose retired permissions that will be removed',
    );
    await clickDialogButton(client, 'ยืนยันบันทึก');
    await waitFor(
      async () => {
        const [saved] = await dataSource.query(
          `SELECT "PersonID_Onec", permissions FROM users WHERE id = $1`,
          [teacherId],
        );
        return (
          saved?.PersonID_Onec === '1000000000002' &&
          !saved?.permissions?.includes('forward-case') &&
          !saved?.permissions?.includes('attendance-operations')
        );
      },
      'Corrected permission save was not persisted',
    );
    const [cleanedTeacher] = await dataSource.query(
      `SELECT "PersonID_Onec", permissions FROM users WHERE id = $1`,
      [teacherId],
    );
    assert(
      cleanedTeacher?.PersonID_Onec === '1000000000002',
      'Corrected hidden profile field was not persisted',
    );
    assert(
      !cleanedTeacher?.permissions?.includes('forward-case') &&
        !cleanedTeacher?.permissions?.includes('attendance-operations'),
      `Retired permissions were not removed: ${JSON.stringify(cleanedTeacher?.permissions)}`,
    );

    // --- Test B: edit a nationwide DIRECTOR -> amber nationwide highlight ---
    await navigate(client, `${FRONTEND_URL}/manage-users/${nationalId}/edit/permissions`);
    await waitForEditForm(client, 'ผู้อำนวยการ');
    await clickSaveButton(client);
    await waitForReviewDialog(client, true);
    const reviewB = await reviewDialogText(client);
    assert(
      reviewB.includes('ทั้งประเทศ (ทุกจังหวัด)') && reviewB.includes('โปรดตรวจสอบให้แน่ใจ'),
      `Nationwide scope was not highlighted in the review dialog: ${reviewB.slice(0, 300)}`,
    );
    // Do not persist; nationwide highlight is the assertion.
    await clickDialogButton(client, 'ยกเลิก');

    // --- Mobile render ---
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/manage-users/${teacherId}/edit/permissions`);
    await waitForEditForm(client, 'คุณครู');
    await waitFor(
      async () => (await comboboxValue(client, 'scope-school')) === SCHOOL.name,
      'Mobile scope editor did not resolve the real school name',
    );
    await capture(client, '/tmp/sts-role-scope-edit-mobile.png');

    await navigate(client, `${FRONTEND_URL}/manage-role-groups`);
    await selectComboboxOption(client, 'กรองตามโรงเรียน', SCHOOL.name);
    await waitFor(
      async () => (await bodyText(client)).includes(menuGroupLabel),
      'Mobile menu-group table did not render the school-owned group',
    );
    const editOpened = await evaluate(
      client,
      `(() => {
        const button = document.querySelector(
          'button[aria-label=${JSON.stringify(`แก้ไขกลุ่มเมนู ${menuGroupLabel}`)}]',
        );
        if (!button) return false;
        button.click();
        return true;
      })()`,
    );
    assert(editOpened, 'Mobile edit menu-group action was not found');
    await waitFor(
      async () => (await bodyText(client)).includes('แก้ไขกลุ่มเมนู'),
      'Mobile edit menu-group dialog did not open',
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    await capture(client, '/tmp/sts-role-groups-dialog-mobile.png');
    await clickButton(client, 'ยกเลิก');

    console.log(
      'role/scope browser smoke passed (Thai permission catalog, hidden validation feedback, retired permission cleanup, real scope names, preserve-scope save, nationwide highlight, desktop/mobile)',
    );
  } finally {
    await closeChrome(chrome);
    await dataSource.query(`DELETE FROM roles WHERE school_id = $1 AND label = $2`, [
      SCHOOL.id,
      menuGroupLabel,
    ]);
    await disableUser(dataSource, teacherId, TEACHER_USERNAME);
    await disableUser(dataSource, nationalId, NATIONAL_USERNAME);
    await disableUser(dataSource, adminId, ADMIN_USERNAME);
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
