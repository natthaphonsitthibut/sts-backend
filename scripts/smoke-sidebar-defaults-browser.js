/**
 * Browser proof for the four default menu groups and the folding rail.
 *
 * For each default group (ผู้ดูแลระบบโรงเรียน, ผู้อำนวยการโรงเรียน, ผู้บริหารสภา,
 * ผู้ดูแลระบบสภา) this signs in an account carrying that group's own
 * `default_permissions` from the database, then checks:
 * - the sidebar lists exactly the entries of the owner's mockup, in order;
 * - with every group opened, folding the rail and unfolding it again leaves
 *   every row at the same height — the menu must not jump on toggle.
 */
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { assert, openChrome, wait, waitFor } = require('./smoke-case-assistance-browser');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run sidebar smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://localhost:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5175';
const USERNAME = 'sidebar_defaults_browser_smoke';
// Optional: a directory to save each group's sidebar, open and folded, for a
// visual check of the icons.
const SCREENSHOT_DIR = process.env.SMOKE_SCREENSHOT_DIR || '';

async function screenshot(chrome, name) {
  if (!SCREENSHOT_DIR) return;
  const { result } = await chrome.call('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: 300, height: 1400, scale: 1 },
  });
  require('fs').writeFileSync(
    require('path').join(SCREENSHOT_DIR, `${name}.png`),
    Buffer.from(result.data, 'base64'),
  );
}

function sessionCookie(sessionCookieService, userId) {
  let cookie = null;
  sessionCookieService.setSession({ cookie: (name, value) => (cookie = { name, value }) }, userId);
  assert(cookie, 'session cookie was not created');
  return cookie;
}

async function upsertUser(dataSource, role, permissions, dataScope) {
  const [row] = await dataSource.query(
    `INSERT INTO users (
       username, password, "FirstName", "LastName", status, permissions, role,
       data_scope, must_change_password, data_origin_code
     ) VALUES ($1, 'x', 'Sidebar', 'Smoke', 'ACTIVE', $2::jsonb, $3, $4::jsonb, FALSE,
       'AUTOMATED_TEST')
     ON CONFLICT (username) DO UPDATE SET
       status='ACTIVE', permissions=$2::jsonb, role=$3, data_scope=$4::jsonb,
       data_origin_code='AUTOMATED_TEST'
     RETURNING id`,
    [USERNAME, JSON.stringify(permissions), role, JSON.stringify(dataScope)],
  );
  return Number(row.id);
}

/** Every row of the desktop rail: its text and where it sits. */
const READ_ROWS = `(() => {
  const nav = [...document.querySelectorAll('nav')].find((el) => el.offsetParent !== null);
  if (!nav) return null;
  return [...nav.querySelectorAll('a, button[aria-expanded], div.min-h-8')]
    .filter((el) => el.getBoundingClientRect().height > 0)
    .map((el) => ({
      text: (el.getAttribute('aria-label') || el.innerText || '').trim(),
      header: el.matches('div.min-h-8'),
      top: Math.round(el.getBoundingClientRect().top * 10) / 10,
    }));
})()`;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  let chrome = null;

  try {
    const [school] = await dataSource.query(
      `SELECT school_id FROM roles WHERE name ~ '^S[0-9]+_BASE_ADMIN$' ORDER BY school_id LIMIT 1`,
    );
    assert(school, 'no school has its default groups');
    const schoolId = Number(school.school_id);
    const schoolScope = { school_ids: [schoolId] };

    const cases = [
      {
        name: 'ผู้ดูแลระบบโรงเรียน',
        role: `S${schoolId}_BASE_ADMIN`,
        scope: schoolScope,
        expected: [
          'หน้าหลัก',
          'รายงานสถานะนักเรียน',
          'ห้องเรียนทั้งหมด',
          'จัดการสิทธิ์ผู้ใช้งาน',
          'จัดการผู้ใช้งาน',
          'จัดการกลุ่มเมนู',
          'จัดการข้อมูล',
          'จัดการภาคเรียนและห้องเรียน',
          'จัดการข้อมูลหลักสูตร',
          'จัดการข้อมูลคุณครู',
          'จัดการลิงก์คุณครู',
          'จัดการข้อมูลนักเรียน',
          'นำเข้าและส่งออกข้อมูล',
          'นำเข้าข้อมูล',
          'ส่งออกข้อมูล',
        ],
      },
      {
        name: 'ผู้อำนวยการโรงเรียน',
        role: `S${schoolId}_BASE_DIRECTOR`,
        scope: schoolScope,
        expected: [
          'หน้าหลัก',
          'รายงานสถานะนักเรียน',
          'ห้องเรียนทั้งหมด',
          'รายชื่อคุณครู',
          'รายชื่อนักเรียน',
          'ส่งออกข้อมูล',
        ],
      },
      {
        name: 'ผู้บริหารสภา',
        role: 'EXECUTIVE',
        scope: { global: true },
        expected: ['หน้าหลัก', 'รายงานสถานะนักเรียน', 'ส่งออกข้อมูล', 'แชตบอท'],
      },
      {
        name: 'ผู้ดูแลระบบสภา',
        role: 'ADMIN',
        scope: { global: true },
        headers: ['เมนูส่วนโรงเรียน', 'เมนูส่วนสภา'],
        councilEntries: [
          'จัดการข้อมูลโรงเรียน',
          'จัดการสิทธิ์ผู้ใช้งาน',
          'จัดการผู้ใช้งาน',
          'จัดการกลุ่มเมนู',
          'จัดการข้อมูลพื้นฐาน',
          'แชตบอท',
          'บันทึกการใช้งาน',
          'ตั้งค่าระบบ',
        ],
      },
    ];

    chrome = await openChrome();
    await chrome.call('Page.enable');
    await chrome.call('Network.enable');
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1400,
      deviceScaleFactor: 1,
      mobile: false,
    });

    for (const testCase of cases) {
      const [role] = await dataSource.query(
        `SELECT default_permissions FROM roles WHERE name = $1`,
        [testCase.role],
      );
      assert(role, `${testCase.name}: group ${testCase.role} is missing`);
      const permissions = role.default_permissions;
      const userId = await upsertUser(dataSource, testCase.role, permissions, testCase.scope);
      const cookie = sessionCookie(sessionCookieService, userId);
      await chrome.call('Network.setCookie', {
        name: cookie.name,
        value: cookie.value,
        url: BACKEND_URL,
        httpOnly: true,
        sameSite: 'Lax',
      });
      await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/login` });
      await waitFor(
        async () => (await chrome.evaluate('document.readyState')) === 'complete',
        'login page did not load',
      );
      await chrome.evaluate(
        `localStorage.clear(); sessionStorage.clear(); localStorage.setItem('sts_user', ${JSON.stringify(
          JSON.stringify({
            id: userId,
            username: USERNAME,
            roles: [testCase.role],
            permissions,
            data_scope: testCase.scope,
          }),
        )}); localStorage.setItem('admin_access', 'true'); true`,
      );
      await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/profile` });
      await waitFor(
        async () => ((await chrome.evaluate(READ_ROWS)) || []).length > 0,
        `${testCase.name}: sidebar did not render`,
      );

      const clickToggle = (label) =>
        chrome.evaluate(`(() => {
          const button = document.querySelector('button[aria-label=${JSON.stringify(label)}]');
          if (!button) return false;
          button.click();
          return true;
        })()`);
      // Start from the unfolded sidebar whatever the stored preference is.
      if (await clickToggle('ขยายเมนูด้านข้าง')) await wait(700);

      // Open every group so the fold has children to keep in place.
      await chrome.evaluate(`(() => {
        const nav = [...document.querySelectorAll('nav')].find((el) => el.offsetParent !== null);
        nav.querySelectorAll('button[aria-expanded="false"]').forEach((button) => button.click());
        return true;
      })()`);
      await wait(500);
      const expanded = await chrome.evaluate(READ_ROWS);
      await screenshot(chrome, `${testCase.role}-open`);
      const entries = expanded.filter((row) => !row.header).map((row) => row.text);
      const headers = expanded.filter((row) => row.header).map((row) => row.text);

      if (testCase.expected) {
        assert(
          JSON.stringify(entries) === JSON.stringify(testCase.expected),
          `${testCase.name}: sidebar was ${JSON.stringify(entries)}`,
        );
        assert(headers.length === 0, `${testCase.name}: unexpected headers ${headers}`);
      } else {
        assert(
          JSON.stringify(headers) === JSON.stringify(testCase.headers),
          `${testCase.name}: headers were ${JSON.stringify(headers)}`,
        );
        const councilHeader = expanded.findIndex((row) => row.text === testCase.headers[1]);
        const council = expanded.slice(councilHeader + 1).map((row) => row.text);
        assert(
          JSON.stringify(council) === JSON.stringify(testCase.councilEntries),
          `${testCase.name}: council section was ${JSON.stringify(council)}`,
        );
      }

      assert(await clickToggle('พับเมนูด้านข้าง'), 'fold button not found');
      await wait(700);
      const folded = await chrome.evaluate(READ_ROWS);
      await screenshot(chrome, `${testCase.role}-folded`);
      assert(await clickToggle('ขยายเมนูด้านข้าง'), 'unfold button not found');
      await wait(700);
      const unfolded = await chrome.evaluate(READ_ROWS);

      for (const [label, rows] of [
        ['folded', folded],
        ['unfolded again', unfolded],
      ]) {
        assert(
          rows.length === expanded.length,
          `${testCase.name}: ${label} rail has ${rows.length} rows, expanded has ${expanded.length}`,
        );
        rows.forEach((row, index) => {
          const drift = Math.abs(row.top - expanded[index].top);
          assert(
            drift <= 0.5,
            `${testCase.name}: row ${index} (${expanded[index].text}) moved ${drift}px when ${label}`,
          );
        });
      }
      console.log(`ok ${testCase.name}: ${expanded.length} rows, fold keeps every row in place`);
    }
    console.log('Sidebar defaults browser smoke passed');
  } finally {
    chrome?.close();
    // Disabled, not deleted: audit_log is append-only.
    await dataSource
      .query(`UPDATE users SET status='DISABLED' WHERE username=$1`, [USERNAME])
      .catch((error) => console.error('cleanup failed:', error.message));
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
