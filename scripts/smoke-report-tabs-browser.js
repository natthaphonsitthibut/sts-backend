/**
 * Browser smoke for the student report tabs, the home grade chart and the
 * school form, driven as a council ผู้ดูแลระบบ:
 * - กลุ่มเสี่ยง / งานส่งต่อ share one student column (school name under the
 *   name, even with a school picked) and งานส่งต่อ has ชั้น/ห้อง columns;
 * - the referral table follows the header's school filter;
 * - the home chart carries its own ชั้น/ห้อง selectors and turns into rooms;
 * - the school form's จ./อ./ต. are comboboxes and the name field has its hint;
 * - no เช็กชื่อ in the sidebar for the default council group.
 *
 * Fixtures: one AUTOMATED_TEST account and, if the database has none, one
 * referral — both removed at the end.
 */
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { assert, openChrome, waitFor } = require('./smoke-case-assistance-browser');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run report tabs browser smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://localhost:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5175';
const USERNAME = 'report_tabs_browser_smoke';

async function navigate(client, path) {
  await client.call('Page.navigate', { url: `${FRONTEND_URL}${path}` });
  await waitFor(
    async () => (await client.evaluate('document.readyState')) === 'complete',
    `page did not finish loading: ${path}`,
  );
}

const bodyText = (client) => client.evaluate('document.body.innerText');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  let actorId = null;
  let referralId = null;
  let chrome = null;

  try {
    const [adminRole] = await dataSource.query(
      `SELECT default_permissions FROM roles WHERE name = 'ADMIN'`,
    );
    const [actor] = await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions, role,
         data_scope, must_change_password, data_origin_code)
       VALUES ($1, 'x', 'รายงาน', 'ทดสอบเบราว์เซอร์', 'ACTIVE', $2::jsonb, 'ADMIN',
         '{"global": true}'::jsonb, FALSE, 'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', permissions = $2::jsonb,
         role = 'ADMIN', data_scope = '{"global": true}'::jsonb, data_origin_code = 'AUTOMATED_TEST'
       RETURNING id`,
      [USERNAME, JSON.stringify(adminRole.default_permissions)],
    );
    actorId = Number(actor.id);

    const [{ count: referralCount }] = await dataSource.query(
      `SELECT count(*)::int AS count FROM case_referrals`,
    );
    if (referralCount === 0) {
      const [fixture] = await dataSource.query(`
        INSERT INTO case_referrals (case_review_id, case_id, referral_agency_id, status_code)
        SELECT review.id, review.case_id,
          (SELECT id FROM referral_agencies WHERE is_active ORDER BY id LIMIT 1), 'REFERRED'
        FROM case_reviews review
        JOIN cases c ON c.id = review.case_id AND c.deleted_at IS NULL
        JOIN student_term st ON st.student_uuid = c.student_uuid
        WHERE NOT EXISTS (SELECT 1 FROM case_referrals r WHERE r.case_review_id = review.id)
        ORDER BY review.reviewed_at DESC LIMIT 1
        RETURNING id`);
      referralId = fixture?.id ?? null;
    }
    const [referral] = await dataSource.query(`
      SELECT c.school_id, sc.name AS school_name, c.student_name
      FROM case_referrals r
      JOIN cases c ON c.id = r.case_id AND c.deleted_at IS NULL
      JOIN schools sc ON sc.id = c.school_id
      ORDER BY r.referred_at DESC LIMIT 1`);
    assert(referral, 'need a referral');
    const [otherSchool] = await dataSource.query(
      `SELECT id, name FROM schools WHERE id <> $1 AND school_status = 'ACTIVE' ORDER BY id LIMIT 1`,
      [referral.school_id],
    );

    let cookie = null;
    sessionCookieService.setSession(
      { cookie: (name, value) => (cookie = { name, value }) },
      actorId,
    );
    chrome = await openChrome();
    const client = chrome;
    await client.call('Page.enable', {});
    await client.call('Network.enable', {});
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.call('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    await navigate(client, '/login');
    const setSchoolFilter = (school) =>
      client.evaluate(
        `localStorage.setItem('sts_school_filter', ${JSON.stringify(
          JSON.stringify({
            province: '',
            district: '',
            subDistrict: '',
            schoolId: school ? String(school.id) : '',
            schoolName: school ? school.name : '',
            userId: actorId,
          }),
        )}); true`,
      );
    await client.evaluate(
      `localStorage.setItem('sts_user', ${JSON.stringify(
        JSON.stringify({
          id: actorId,
          username: USERNAME,
          roles: ['ADMIN'],
          permissions: adminRole.default_permissions,
          data_scope: { global: true },
        }),
      )}); localStorage.setItem('admin_access', 'true'); true`,
    );

    // ---- referral tab, school picked: row shows school + ชั้น/ห้อง headers
    await setSchoolFilter({ id: referral.school_id, name: referral.school_name });
    await navigate(client, '/student-risk-report/referrals');
    await waitFor(
      async () => (await bodyText(client)).includes(referral.student_name),
      'referral row did not render for the picked school',
    );
    const referralTable = await client.evaluate(`(() => {
      const table = [...document.querySelectorAll('table')].find((t) =>
        t.innerText.includes('หน่วยงานที่ส่งต่อ'));
      if (!table) return null;
      return {
        headers: [...table.querySelectorAll('th')].map((th) => th.innerText.trim()),
        firstRow: table.querySelector('tbody tr')?.innerText ?? '',
      };
    })()`);
    assert(referralTable, 'referral table missing');
    assert(
      ['ชั้น', 'ห้อง'].every((h) => referralTable.headers.some((x) => x.startsWith(h))),
      `referral headers lack ชั้น/ห้อง: ${referralTable.headers.join(' | ')}`,
    );
    assert(
      referralTable.firstRow.includes(referral.school_name),
      'referral row lost the school name under the student',
    );
    const searchPlaceholder = await client.evaluate(
      `document.querySelector('input[placeholder="ค้นหาชื่อนักเรียนหรือหน่วยงาน"]') !== null`,
    );
    assert(searchPlaceholder, 'referral search placeholder changed');

    // ---- another school: the referral table follows the header filter
    if (otherSchool) {
      await setSchoolFilter(otherSchool);
      await navigate(client, '/student-risk-report/referrals');
      await waitFor(async () => {
        const text = await bodyText(client);
        return text.includes('งานส่งต่อ') && !text.includes('กำลังโหลด');
      }, 'referral tab did not load for the other school');
      await waitFor(
        async () =>
          !(await client.evaluate(`(() => {
            const table = [...document.querySelectorAll('table')].find((t) =>
              t.innerText.includes('หน่วยงานที่ส่งต่อ'));
            return table ? table.innerText.includes(${JSON.stringify(referral.school_name)}) : false;
          })()`)),
        'referral table still lists another school after changing the header filter',
      );
    }

    // ---- risk tab, school picked: the school name still shows under the name
    await setSchoolFilter({ id: referral.school_id, name: referral.school_name });
    await navigate(client, '/student-risk-report/risk');
    await waitFor(
      async () =>
        await client.evaluate(`(() => {
          const row = document.querySelector('table tbody tr');
          return Boolean(row) && row.innerText.includes(${JSON.stringify(referral.school_name)});
        })()`),
      'risk rows did not show the school name under the student',
    );
    const statusOptions = await client.evaluate(`(() => {
      const select = document.querySelector('select[aria-label="สถานะการติดตาม"]');
      return select ? [...select.options].map((o) => o.textContent.trim()) : null;
    })()`);
    assert(statusOptions && statusOptions[0] === 'ทุกสถานะการติดตาม', 'risk status select label');
    assert(statusOptions.length > 1, 'risk status options did not load from the catalog');

    // ---- home: the grade chart has its own ชั้น/ห้อง selectors
    await navigate(client, '/');
    await waitFor(
      async () =>
        await client.evaluate(`Boolean(document.querySelector('[data-grade-risk="grade"]'))`),
      'grade chart did not render for the picked school',
    );
    const firstGrade = await client.evaluate(`(() => {
      const select = document.querySelector('[data-grade-risk] select[aria-label="ชั้น"]');
      return select && select.options.length > 1 ? select.options[1].value : null;
    })()`);
    assert(firstGrade, 'grade chart has no ชั้น selector');
    await client.evaluate(`(() => {
      const select = document.querySelector('[data-grade-risk] select[aria-label="ชั้น"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, ${JSON.stringify(firstGrade)});
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(
      async () =>
        await client.evaluate(`Boolean(document.querySelector('[data-grade-risk="room"]'))`),
      'picking a grade did not turn the chart into rooms',
    );
    assert(
      (await bodyText(client)).includes('ระดับความเสี่ยงแยกรายห้อง'),
      'room chart title missing',
    );

    // ---- sidebar: no เช็กชื่อ for the default council group
    const sidebarHasAttendance = await client.evaluate(
      `[...document.querySelectorAll('a[href]')].some((a) => new URL(a.href).pathname === '/attendance/check-in' || new URL(a.href).pathname === '/attendance')`,
    );
    assert(!sidebarHasAttendance, 'council admin sidebar still links เช็กชื่อ');

    // ---- school form: comboboxes + name hint
    await setSchoolFilter(null);
    await navigate(client, '/manage-schools');
    await waitFor(
      async () =>
        await client.evaluate(
          `[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'เพิ่มโรงเรียน')`,
        ),
      async () => `school page did not render: ${(await bodyText(client)).slice(0, 200)}`,
    );
    await client.clickText('เพิ่มโรงเรียน');
    await waitFor(
      async () => await client.evaluate(`Boolean(document.getElementById('school-name'))`),
      'school form did not open',
    );
    const form = await client.evaluate(`({
      hint: document.getElementById('school-name-hint')?.innerText ?? '',
      province: document.getElementById('school-province')?.tagName ?? null,
      district: document.getElementById('school-district')?.tagName ?? null,
      subDistrict: document.getElementById('school-sub-district')?.tagName ?? null,
      status: Boolean(document.getElementById('school-status')),
    })`);
    assert(form.hint.includes('โรงเรียน'), 'school name hint missing');
    assert(
      form.province === 'INPUT' && form.district === 'INPUT' && form.subDistrict === 'INPUT',
      `จ./อ./ต. are not comboboxes: ${JSON.stringify(form)}`,
    );
    assert(!form.status, 'create form must not show a status field');

    console.log('smoke:report-tabs-browser ok');
  } finally {
    chrome?.close();
    if (referralId) {
      await dataSource.query(`DELETE FROM case_referrals WHERE id = $1`, [referralId]);
    }
    if (actorId) {
      // Disable rather than delete: the audit log is append-only.
      await dataSource.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [actorId]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
