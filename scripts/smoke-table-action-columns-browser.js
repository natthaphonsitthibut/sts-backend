/**
 * Browser smoke for the เครื่องมือ column of the shared data table, driven as a
 * school's ผู้ดูแลระบบ:
 * - on งานส่งต่อ, กลุ่มเสี่ยง, จัดการครู and จัดการกลุ่มเมนู every row's buttons
 *   sit inside their cell at three desktop widths (a percentage-wide column
 *   used to go narrower than the buttons and cut the last one off);
 * - จัดการผู้ใช้งาน lists only accounts whose detail the same actor can open; a
 *   fellow ผู้ดูแลระบบ is listed and opens read-only — no edit, no deactivate, no
 *   reveal on screen, and the routes behind those buttons still answer 403.
 *
 * The fifth table, ลิงก์ที่มอบหมาย, needs a teacher's issued assignment and is
 * measured inside smoke-subject-check-in-browser.js with `assertActionColumnsFit`.
 *
 * Fixtures: two AUTOMATED_TEST accounts, disabled at the end.
 */
const { assert, openChrome, waitFor } = require('./smoke-case-assistance-browser');

const VIEWPORT_WIDTHS = [1024, 1280, 1440];

/**
 * Every visible action-column table on the page: how many rows carry buttons,
 * and which buttons reach outside their cell.
 */
const MEASURE_ACTION_COLUMNS = `(() => {
  const tables = [...document.querySelectorAll(
    '[data-slot="data-table"][data-action-column="true"]',
  )].filter((shell) => shell.getClientRects().length > 0);
  return tables.map((shell) => {
    const rows = [...shell.querySelectorAll('tbody tr')];
    let rowsWithButtons = 0;
    const offenders = [];
    for (const row of rows) {
      const cell = row.querySelector('td:last-child');
      if (!cell) continue;
      const buttons = [...cell.querySelectorAll('button, a')];
      if (buttons.length === 0) continue;
      rowsWithButtons += 1;
      const cellRect = cell.getBoundingClientRect();
      for (const button of buttons) {
        const rect = button.getBoundingClientRect();
        if (rect.left < cellRect.left - 0.5 || rect.right > cellRect.right + 0.5) {
          offenders.push({
            label: button.getAttribute('aria-label') || button.innerText.trim(),
            overflowPx: Math.round(
              Math.max(cellRect.left - rect.left, rect.right - cellRect.right),
            ),
            cellWidth: Math.round(cellRect.width),
          });
        }
      }
    }
    return {
      headers: [...shell.querySelectorAll('thead th')].map((th) => th.innerText.trim()),
      rowsWithButtons,
      offenders,
    };
  });
})()`;

/**
 * Asserts the table whose header row includes `heading` keeps its row buttons
 * inside the เครื่องมือ cell at each desktop width. `client` is on the page;
 * `evaluate` is for a smoke whose client has no `evaluate` of its own.
 */
async function assertActionColumnsFit(
  client,
  heading,
  label,
  { widths = VIEWPORT_WIDTHS, evaluate = (expression) => client.evaluate(expression) } = {},
) {
  for (const width of widths) {
    await client.call('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    let table = null;
    await waitFor(async () => {
      const tables = await evaluate(MEASURE_ACTION_COLUMNS);
      table = tables.find((entry) => entry.headers.includes(heading)) ?? null;
      return Boolean(table && table.rowsWithButtons > 0);
    }, `${label}: no row with tool buttons rendered at ${width}px`);
    assert(
      table.offenders.length === 0,
      `${label}: tool buttons overflow their cell at ${width}px — ${JSON.stringify(
        table.offenders.slice(0, 3),
      )}`,
    );
    console.log(`  ${label} @ ${width}px: ${table.rowsWithButtons} rows, buttons inside cell`);
  }
}

module.exports = { assertActionColumnsFit };

if (require.main === module) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run table action column smoke with NODE_ENV=production');
  }
  if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
    throw new Error('Refusing to run: DB_NAME must end with _smoke');
  }
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { DataSource } = require('typeorm');
  const { AppModule } = require('../dist/app.module');
  const { SessionCookieService } = require('../dist/auth/session-cookie.service');

  const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://localhost:3001';
  const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5175';
  const USERNAME = 'action_columns_browser_smoke';
  const PEER_USERNAME = 'action_columns_browser_peer';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  const fixtureIds = [];
  let chrome = null;

  const navigate = async (client, path) => {
    await client.call('Page.navigate', { url: `${FRONTEND_URL}${path}` });
    await waitFor(
      async () => (await client.evaluate('document.readyState')) === 'complete',
      `page did not finish loading: ${path}`,
    );
  };

  try {
    // The school with the most referrals that also has a ผู้ดูแลระบบ group.
    const [school] = await dataSource.query(`
      SELECT c.school_id, sc.name AS school_name, r.name AS role, r.default_permissions,
             u.data_scope
      FROM case_referrals referral
      JOIN cases c ON c.id = referral.case_id AND c.deleted_at IS NULL
      JOIN schools sc ON sc.id = c.school_id
      JOIN roles r ON r.school_id = c.school_id AND r.name LIKE '%\\_BASE\\_ADMIN'
      LEFT JOIN LATERAL (
        SELECT data_scope FROM users
        WHERE data_scope::jsonb -> 'school_ids' = jsonb_build_array(c.school_id)
        ORDER BY id LIMIT 1
      ) u ON TRUE
      GROUP BY c.school_id, sc.name, r.name, r.default_permissions, u.data_scope
      ORDER BY count(*) DESC, c.school_id LIMIT 1`);
    assert(school, 'need a school with referrals and a ผู้ดูแลระบบ group');
    const scope = school.data_scope ?? { school_ids: [Number(school.school_id)] };

    const upsert = async (username, firstName) => {
      const [row] = await dataSource.query(
        `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions, role,
           data_scope, must_change_password, data_origin_code)
         VALUES ($1, 'x', $2, 'ทดสอบเบราว์เซอร์', 'ACTIVE', $3::jsonb, $4, $5::jsonb, FALSE,
           'AUTOMATED_TEST')
         ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', permissions = $3::jsonb,
           role = $4, data_scope = $5::jsonb, data_origin_code = 'AUTOMATED_TEST'
         RETURNING id`,
        [
          username,
          firstName,
          JSON.stringify(school.default_permissions),
          school.role,
          JSON.stringify(scope),
        ],
      );
      fixtureIds.push(Number(row.id));
      return Number(row.id);
    };
    const actorId = await upsert(USERNAME, 'คอลัมน์เครื่องมือ');
    const peerId = await upsert(PEER_USERNAME, 'ผู้ดูแลร่วมโรงเรียน');
    // The list leaves AUTOMATED_TEST accounts out, and this database holds no
    // two real admins of one group, so the peer wears a listed origin for the
    // run. The cleanup below tags it back and disables it.
    await dataSource.query(`UPDATE users SET data_origin_code = 'DEMO' WHERE id = $1`, [peerId]);

    let cookie = null;
    sessionCookieService.setSession(
      { cookie: (name, value) => (cookie = { name, value }) },
      actorId,
    );
    chrome = await openChrome();
    const client = chrome;
    await client.call('Page.enable', {});
    await client.call('Network.enable', {});
    await client.call('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    await navigate(client, '/login');
    await client.evaluate(
      `localStorage.setItem('sts_user', ${JSON.stringify(
        JSON.stringify({
          id: actorId,
          username: USERNAME,
          roles: [school.role],
          permissions: school.default_permissions,
          data_scope: scope,
        }),
      )}); localStorage.setItem('admin_access', 'true'); true`,
    );

    const api = (path) =>
      client.evaluate(`(async () => {
        const response = await fetch(${JSON.stringify(BACKEND_URL)} + ${JSON.stringify(path)}, {
          credentials: 'include',
        });
        let body = null;
        try { body = await response.json(); } catch (error) { body = null; }
        return { status: response.status, body };
      })()`);

    // ---- the list shows only accounts the actor can open
    console.log('จัดการผู้ใช้งาน: list agrees with detail');
    const list = await api(
      '/api/users?page=1&limit=50&searchTerm=' + encodeURIComponent(PEER_USERNAME),
    );
    const everyone = await api('/api/users?page=1&limit=50');
    assert(
      everyone.status === 200,
      `user list answered ${everyone.status}: ${JSON.stringify(everyone.body)}`,
    );
    const listedIds = everyone.body.data.map((user) => Number(user.id));
    assert(listedIds.includes(actorId), 'the actor is missing from its own list');
    assert(listedIds.length > 1, 'the list holds nobody but the actor');
    for (const id of listedIds) {
      const detail = await api(`/api/users/${id}/detail`);
      assert(detail.status === 200, `listed user ${id} opened onto ${detail.status}`);
    }
    // A fellow admin is the actor's to read, not to manage (owner, 2026-10-13).
    const peerRow = (list.body?.data ?? []).find((user) => Number(user.id) === peerId);
    assert(
      peerRow,
      `a fellow ผู้ดูแลระบบ is not listed: ${list.status} ${JSON.stringify(list.body).slice(0, 300)}`,
    );
    assert(peerRow.can_manage === false, 'the list calls a fellow ผู้ดูแลระบบ manageable');
    const peerDetail = await api(`/api/users/${peerId}/detail`);
    assert(peerDetail.status === 200, `peer detail answered ${peerDetail.status}, expected 200`);
    assert(peerDetail.body.can_manage === false, 'peer detail calls itself manageable');
    const peerEdit = await api(`/api/users/${peerId}`);
    assert(peerEdit.status === 403, `peer edit read answered ${peerEdit.status}, expected 403`);
    const managed = everyone.body.data.find(
      (user) => Number(user.id) !== actorId && user.can_manage === true,
    );
    assert(managed, 'the list holds nobody the actor manages');

    // On screen: the peer's row and record offer nothing the server refuses.
    const searchFor = async (text) => {
      await client.evaluate(`(() => {
        const input = document.querySelector('input[placeholder^="ค้นหาชื่อผู้ใช้งาน"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
    };
    // The row shows the person's name, so it is recognised by its record link.
    const rowButtons = (id) =>
      client.evaluate(`(() => {
        const rows = [...document.querySelectorAll('[data-slot="data-table"] tbody tr')];
        if (rows.length !== 1 || !rows[0].querySelector('a[href$="/manage-users/${id}"]')) return null;
        return {
          buttons: [...rows[0].querySelectorAll('td:last-child button')].map((b) => b.getAttribute('aria-label')),
        };
      })()`);
    await navigate(client, '/manage-users');
    await waitFor(
      async () =>
        Boolean(
          await client.evaluate(
            `Boolean(document.querySelector('input[placeholder^="ค้นหาชื่อผู้ใช้งาน"]'))`,
          ),
        ),
      'จัดการผู้ใช้งาน did not render its search',
    );
    await searchFor(managed.username);
    let row = null;
    await waitFor(
      async () => Boolean((row = await rowButtons(managed.id))),
      'the managed account did not come up in the search',
    );
    assert(row.buttons.length >= 2, `a managed row lost its tools: ${JSON.stringify(row.buttons)}`);
    await searchFor(PEER_USERNAME);
    await waitFor(
      async () => Boolean((row = await rowButtons(peerId))),
      'the fellow ผู้ดูแลระบบ did not come up in the search',
    );
    assert(row.buttons.length === 0, `a read-only row still offers ${JSON.stringify(row.buttons)}`);

    const recordControls = () =>
      client.evaluate(`(() => {
        const main = document.querySelector('main') || document.body;
        if (!main.innerText.includes('ชื่อผู้ใช้งาน')) return null;
        return {
          path: location.pathname,
          text: main.innerText,
          edit: [...main.querySelectorAll('a, button')].some((el) => el.innerText.trim() === 'แก้ไขผู้ใช้งาน'),
          username: main.querySelector('#user-detail-username')?.value ?? '',
          reveal: Boolean(main.querySelector('#user-detail-national-id')?.parentElement?.querySelector('button')),
        };
      })()`);
    let record = null;
    await navigate(client, '/login');
    await navigate(client, `/manage-users/${managed.id}`);
    await waitFor(
      async () => Boolean((record = await recordControls()) && record.edit),
      'a managed record never offered แก้ไขผู้ใช้งาน',
    );
    assert(record.reveal, 'a managed record lost its national-id reveal');
    await navigate(client, '/login');
    await navigate(client, `/manage-users/${peerId}`);
    await waitFor(
      async () => Boolean((record = await recordControls()) && record.username === PEER_USERNAME),
      'the fellow ผู้ดูแลระบบ record did not open',
    );
    assert(!record.text.includes('ไม่สามารถโหลดข้อมูลได้'), 'the read-only record failed to load');
    assert(!record.edit, 'the read-only record still offers แก้ไขผู้ใช้งาน');
    assert(!record.reveal, 'the read-only record still offers the national-id reveal');
    assert(
      !record.text.includes('ดูที่อยู่และแผนที่'),
      'the read-only record still offers the address reveal',
    );
    console.log(
      `  ${listedIds.length} listed, each opens; fellow admin listed read-only, no tools on its row or record, edit read 403`,
    );

    // ---- the four tables this actor reaches
    console.log('เครื่องมือ column');
    await navigate(client, '/student-risk-report/referrals');
    await assertActionColumnsFit(client, 'หน่วยงานที่ส่งต่อ', 'งานส่งต่อ');
    await navigate(client, '/student-risk-report/risk');
    await assertActionColumnsFit(client, 'หมายเหตุ', 'กลุ่มเสี่ยง');
    await navigate(client, '/manage-teachers');
    await assertActionColumnsFit(client, 'อีเมล', 'จัดการครู');
    await navigate(client, '/manage-role-groups');
    await assertActionColumnsFit(client, 'กลุ่มเมนู', 'จัดการกลุ่มเมนู');

    console.log('table action columns browser smoke passed');
  } finally {
    chrome?.close();
    if (fixtureIds.length > 0) {
      // Disable rather than delete: the audit log is append-only.
      await dataSource.query(
        `UPDATE users SET status = 'DISABLED', data_origin_code = 'AUTOMATED_TEST' WHERE id = ANY($1::int[])`,
        [fixtureIds],
      );
    }
    await app.close();
  }
}
