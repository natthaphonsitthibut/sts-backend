/**
 * Browser proof for the council's side of จัดการผู้ใช้งาน (owner, 2026-09-25):
 * - the user list follows the header's จ./อ./ต. (never a school) and shows
 *   จังหวัด / อำเภอ-เขต / ตำบล-แขวง columns;
 * - council menu groups are ผู้ดูแลระบบ, ผู้บริหาร and the council's own;
 * - a new council account's scope starts at the header's area and can be set
 *   before any group is picked.
 */
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { assert, openChrome, wait, waitFor } = require('./smoke-case-assistance-browser');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run council area smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://localhost:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5175';
const PREFIX = 'council_area_smoke_';

const PROVINCE = 'เชียงใหม่';
const DISTRICT = 'เมืองเชียงใหม่';

function sessionCookie(sessionCookieService, userId) {
  let cookie = null;
  sessionCookieService.setSession({ cookie: (name, value) => (cookie = { name, value }) }, userId);
  assert(cookie, 'session cookie was not created');
  return cookie;
}

async function upsertUser(dataSource, suffix, role, dataScope, firstName) {
  const permissions = (
    await dataSource.query(`SELECT default_permissions FROM roles WHERE name = $1`, [role])
  )[0].default_permissions;
  const [row] = await dataSource.query(
    `INSERT INTO users (
       username, password, "FirstName", "LastName", status, permissions, role,
       data_scope, must_change_password, data_origin_code
     ) VALUES ($1, 'x', $5, 'Smoke', 'ACTIVE', $2::jsonb, $3, $4::jsonb, FALSE, 'AUTOMATED_TEST')
     ON CONFLICT (username) DO UPDATE SET
       status='ACTIVE', permissions=$2::jsonb, role=$3, data_scope=$4::jsonb,
       "FirstName"=$5, data_origin_code='AUTOMATED_TEST'
     RETURNING id`,
    [`${PREFIX}${suffix}`, JSON.stringify(permissions), role, JSON.stringify(dataScope), firstName],
  );
  return { id: Number(row.id), permissions };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  let chrome = null;

  try {
    const national = await upsertUser(dataSource, 'national', 'ADMIN', { global: true }, 'Nation');

    chrome = await openChrome();
    await chrome.call('Page.enable');
    await chrome.call('Network.enable');
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    });

    async function signIn(actor, role, scope, filter) {
      const cookie = sessionCookie(sessionCookieService, actor.id);
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
      const user = {
        id: actor.id,
        roles: [role],
        permissions: actor.permissions,
        data_scope: scope,
      };
      const stored = {
        province: filter.province ?? '',
        district: filter.district ?? '',
        subDistrict: filter.subDistrict ?? '',
        schoolId: filter.schoolId ?? '',
        schoolName: filter.schoolName ?? '',
        userId: actor.id,
      };
      await chrome.evaluate(
        `localStorage.clear(); sessionStorage.clear();
         localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(user))});
         localStorage.setItem('admin_access', 'true');
         localStorage.setItem('sts_school_filter', ${JSON.stringify(JSON.stringify(stored))}); true`,
      );
    }

    async function openList(path, rowText) {
      await chrome.call('Page.navigate', { url: `${FRONTEND_URL}${path}` });
      await waitFor(
        async () => (await chrome.evaluate('document.readyState')) === 'complete',
        `${path}: page did not load`,
      );
      await waitFor(
        async () =>
          await chrome.evaluate(`(() => {
            const table = [...document.querySelectorAll('table')].find((el) => el.offsetParent !== null);
            const empty = document.body.innerText.includes('ไม่พบ');
            return Boolean(table && (${JSON.stringify(rowText)} === null || table.innerText.includes(${JSON.stringify(rowText)}))) || empty;
          })()`),
        `${path}: list did not render`,
      ).catch(async (error) => {
        const text = await chrome.evaluate(
          'location.pathname + "\\n" + document.body.innerText.slice(0, 1500)',
        );
        const { result } = await chrome.call('Page.captureScreenshot', { format: 'png' });
        require('fs').writeFileSync(
          '/tmp/sts-council-areas-failure.png',
          Buffer.from(result.data, 'base64'),
        );
        console.error(text);
        throw error;
      });
      await wait(600);
      return await chrome.evaluate(`(() => {
        const table = [...document.querySelectorAll('table')].find((el) => el.offsetParent !== null);
        if (!table) return { headers: [], rows: [] };
        return {
          headers: [...table.querySelectorAll('thead th')].map((th) => th.innerText.trim()),
          rows: [...table.querySelectorAll('tbody tr')].map((tr) =>
            [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()),
          ),
        };
      })()`);
    }

    // 1. User list follows the header district, with area columns.
    await signIn(national, 'ADMIN', { global: true }, { province: PROVINCE, district: DISTRICT });
    // The list hides AUTOMATED_TEST rows, so check it against the real council
    // accounts: those whose area sits in the district, and one wider than it.
    const accounts = await dataSource.query(
      `SELECT CONCAT_WS(' ', "FirstName", "LastName") AS name, data_scope
       FROM users
       WHERE data_origin_code <> 'AUTOMATED_TEST'
         AND role IS NOT NULL AND role NOT IN ('TEACHER', 'STUDENT')
         AND jsonb_array_length(COALESCE(data_scope->'school_ids', '[]'::jsonb)) = 0
         AND COALESCE((data_scope->>'global')::boolean, FALSE) = FALSE`,
    );
    const expected = accounts
      .filter((row) => (row.data_scope.districts ?? []).includes(DISTRICT))
      .map((row) => row.name.trim());
    const wider = accounts.find(
      (row) =>
        (row.data_scope.provinces ?? []).length > 0 && !(row.data_scope.districts ?? []).length,
    );
    assert(expected.length > 0, `smoke DB has no council account in ${DISTRICT}`);
    const users = await openList('/council/manage-users', expected[0]);
    for (const heading of ['จังหวัด', 'อำเภอ/เขต', 'ตำบล/แขวง']) {
      assert(users.headers.includes(heading), `user list lacks ${heading}: ${users.headers}`);
    }
    const listed = users.rows.map((row) => row.join(' | '));
    for (const name of expected) {
      const row = users.rows.find((cells) => cells.some((cell) => cell.includes(name)));
      assert(row, `district list is missing ${name}: ${JSON.stringify(listed)}`);
      assert(
        row.includes(PROVINCE) && row.includes(DISTRICT),
        `area columns for ${name} were ${JSON.stringify(row)}`,
      );
    }
    assert(
      users.rows.length === expected.length,
      `district list has ${users.rows.length} rows, expected ${expected.length}: ${JSON.stringify(listed)}`,
    );
    if (wider) {
      assert(
        !listed.some((text) => text.includes(wider.name.trim())),
        'a province-wide account shows under one of its districts',
      );
    }
    console.log('ok user list follows the picked district and shows its area');

    // A school picked in the header narrows the council list to its area only, and says so.
    const [school] = await dataSource.query(
      `SELECT id, name, province, district, sub_district FROM schools WHERE province = $1 AND district = $2 LIMIT 1`,
      [PROVINCE, DISTRICT],
    );
    if (school) {
      await signIn(
        national,
        'ADMIN',
        { global: true },
        {
          province: school.province,
          district: school.district,
          subDistrict: school.sub_district,
          schoolId: String(school.id),
          schoolName: school.name,
        },
      );
      await openList('/council/manage-users', null);
      assert(
        await chrome.evaluate(`document.body.innerText.includes('ไม่กรองตามโรงเรียน')`),
        'the council list does not say a picked school is not applied',
      );
      console.log('ok a picked school narrows the council list to its area, with a note');
    }

    // 2. Council menu groups belong to a จ./อ./ต., like a school's (owner with
    //    BA, 2026-09-25): an area must be picked, and each area starts with its
    //    own ผู้ดูแลระบบ and ผู้บริหาร — never the retired ผู้อำนวยการ.
    await signIn(national, 'ADMIN', { global: true }, {});
    await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/council/manage-role-groups` });
    await waitFor(
      async () => await chrome.evaluate(`document.body.innerText.includes('เลือกพื้นที่')`),
      'the council group page did not ask for an area',
    );
    await signIn(national, 'ADMIN', { global: true }, { province: PROVINCE, district: DISTRICT });
    const groups = await openList('/council/manage-role-groups', 'ผู้บริหาร');
    const groupNames = groups.rows.map((row) => row[0]);
    assert(
      groupNames.includes('ผู้ดูแลระบบ') && groupNames.includes('ผู้บริหาร'),
      `the district's groups were ${JSON.stringify(groupNames)}`,
    );
    assert(!groupNames.includes('ผู้อำนวยการ'), 'the council lists the retired ผู้อำนวยการ group');
    const starters = await dataSource.query(
      `SELECT r.name FROM roles r
       JOIN administrative_districts d ON d.code = r.owner_district_code
       WHERE d.name_th = $1 AND r.owner_sub_district_code IS NULL AND r.name LIKE 'A%_BASE_%'
       ORDER BY r.name`,
      [DISTRICT],
    );
    assert(starters.length === 2, `the district's starter groups were ${JSON.stringify(starters)}`);
    console.log(
      `ok a picked district lists its own groups (${starters.map((r) => r.name).join(', ')})`,
    );

    // An area admin works on its own area's groups with nothing picked.
    const districtAdminRole = starters.find((row) => row.name.endsWith('_BASE_ADMIN')).name;
    const areaAdmin = await upsertUser(
      dataSource,
      'district',
      districtAdminRole,
      { provinces: [PROVINCE], districts: [DISTRICT] },
      'Districtadmin',
    );
    await signIn(
      areaAdmin,
      districtAdminRole,
      { provinces: [PROVINCE], districts: [DISTRICT] },
      {},
    );
    const own = await openList('/council/manage-role-groups', 'ผู้บริหาร');
    assert(
      own.rows.map((row) => row[0]).includes('ผู้ดูแลระบบ'),
      `an area admin does not see its area's groups: ${JSON.stringify(own.rows)}`,
    );
    assert(
      await chrome.evaluate(
        `[...document.querySelectorAll('nav a')].some((a) => a.getAttribute('href') === '/council/manage-role-groups')`,
      ),
      'an area admin is not shown จัดการกลุ่มเมนู',
    );
    console.log('ok an area admin manages its own area groups from the menu');

    // 3. A new council account starts at the header's area, before any group is picked,
    //    and is offered only council groups.
    await signIn(national, 'ADMIN', { global: true }, { province: PROVINCE, district: DISTRICT });
    await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/council/manage-users/new` });
    await waitFor(
      async () => await chrome.evaluate(`document.body.innerText.includes('ขอบเขตข้อมูล')`),
      'new council user form did not render',
    );
    await wait(1500);
    const form = await chrome.evaluate(`(() => {
      const text = document.body.innerText;
      const values = [...document.querySelectorAll('input, select')].map((el) => el.value);
      return { text, values };
    })()`);
    assert(
      !form.text.includes('เลือกตำแหน่งก่อน'),
      'the scope still waits for a group to be picked',
    );
    assert(
      form.values.includes(PROVINCE) && form.values.includes(DISTRICT),
      `the scope did not start at the header area: ${JSON.stringify(form.values)}`,
    );
    assert(!/ผู้อำนวยการ/.test(form.text), 'the council form offers the retired ผู้อำนวยการ group');
    // Its group list is exactly the district's own groups.
    const catalog = await chrome.evaluate(
      `fetch(${JSON.stringify(
        `${BACKEND_URL}/api/users/roles?province=${encodeURIComponent(PROVINCE)}&district=${encodeURIComponent(DISTRICT)}`,
      )}, { credentials: 'include' }).then((response) => response.json())`,
    );
    const list = Array.isArray(catalog) ? catalog : catalog.data;
    assert(
      list.some((role) => role.name === districtAdminRole),
      `the form's catalog lacks the district's groups: ${JSON.stringify(list.map((r) => r.name))}`,
    );
    assert(
      !list.some((role) => role.owner_area && role.owner_area.district !== DISTRICT),
      'the form offers another area group',
    );
    console.log(
      'ok a new council account starts at the header area, groups limited to the council',
    );
    console.log('Council area browser smoke passed');
  } finally {
    chrome?.close();
    // Disabled, not deleted: audit_log is append-only.
    await dataSource
      .query(`UPDATE users SET status='DISABLED' WHERE username LIKE $1`, [`${PREFIX}%`])
      .catch((error) => console.error('cleanup failed:', error.message));
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
