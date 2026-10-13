/**
 * Browser smoke: a page an account holds must work, and a button it shows must
 * lead somewhere that works.
 *
 * For every page permission, in a school, a province and the national scope,
 * an account holding only [home, that permission] opens each route of the page,
 * follows the links the page offers, and clicks its non-destructive buttons on
 * three rows of each table. The run fails when:
 * - any API call answers 400 or above (a page reaching an endpoint its own
 *   permission does not open, or a list offering a row its detail refuses);
 * - a link or button lands on the no-access page, the login page, or a page
 *   that says it could not load.
 *
 * Fixtures: one AUTOMATED_TEST account per scope, disabled at the end.
 * SMOKE_SCOPE=school|province|global runs one scope; SMOKE_PERMISSIONS=a,b
 * narrows the permissions. SMOKE_SCOPE=grade is an extra, opt-in scope: the
 * school narrowed to one grade level, for the pages a teacher's own group holds
 * (run it with SMOKE_PERMISSIONS=attendance).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assert, openChrome, wait } = require('./smoke-case-assistance-browser');
const { APP_PAGES } = require('../dist/auth/page-registry.constants');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run permission page smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://localhost:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5175';
const ONLY_SCOPE = process.env.SMOKE_SCOPE || '';
const OUT = path.join(os.tmpdir(), `sts-permission-pages-${ONLY_SCOPE || 'all'}.json`);
const MAX_PAGES = Number(process.env.SMOKE_MAX_PAGES || 22);
const ONLY = (process.env.SMOKE_PERMISSIONS || '').split(',').filter(Boolean);
// Council pages: the route itself refuses any scope but the national one.
const GLOBAL_ONLY = new Set(
  APP_PAGES.filter((page) => page.scopePolicy === 'global-only').map((page) => page.id),
);
// The smoke database has no geocoding key.
const EXPECTED_ERRORS = [/^503 GET \/api\/geo\/profile-geocode/];

const START = {
  home: ['/'],
  dashboard: [
    '/student-risk-report/risk',
    '/student-risk-report/watchlist',
    '/student-risk-report/referrals',
    '/student-risk-report/teacher-comments',
    '/student-risk-report/teacher-reports',
    '/student-risk-report/home-visit-requests',
  ],
  classrooms: ['/classrooms'],
  teachers: ['/teachers'],
  students: ['/students', '/student-risk-report/teacher-comments'],
  attendance: ['/attendance', '/attendance/check-in', '/attendance/history'],
  'manage-users-list': ['/manage-users', '/manage-users/new', '/council/manage-users'],
  'manage-role-groups': [
    '/manage-role-groups',
    '/manage-role-groups/new',
    '/council/manage-role-groups',
  ],
  'manage-school-structure': ['/school-structure'],
  'manage-subjects': ['/curriculum'],
  'manage-teachers': ['/manage-teachers', '/manage-teachers/new'],
  'manage-classroom-links': ['/attendance/classroom-links'],
  'manage-students': [
    '/manage-students',
    '/manage-students/history',
    '/manage-students/export',
    '/manage-students/new',
  ],
  'master-data': ['/master-data', '/master-data/student-statuses'],
  'import-data': ['/import-data', '/import-data/quarantine', '/import-data/history'],
  'export-data': ['/data-exports', '/data-exports/history'],
  'manage-schools': ['/manage-schools'],
  'nl_query:use': ['/nl-query'],
  settings: ['/settings'],
  'audit-log:all': ['/council/audit-log'],
  'audit-log': [],
  'case:assign': [],
  'case:review': [],
};
// Permissions that only add controls to another page: crawl them with that page.
const COMPANION = {
  'audit-log': ['students', 'import-data'],
  'case:assign': ['dashboard'],
  'case:review': ['dashboard'],
};

const INJECT = `(() => {
  if (window.__crawlHooked) return; window.__crawlHooked = true;
  window.__inflight = 0; window.__lastNet = Date.now();
  const record = (status, method, url, body) => {
    window.__lastNet = Date.now();
    if (status < 400 || !/\\/api\\//.test(url)) return;
    try {
      const list = JSON.parse(sessionStorage.getItem('__crawlErrors') || '[]');
      list.push({ status, method, url: url.replace(location.origin, '').replace(${JSON.stringify(
        BACKEND_URL,
      )}, ''), page: location.pathname + location.search, action: sessionStorage.getItem('__crawlAction') || '', body: String(body || '').slice(0, 200) });
      sessionStorage.setItem('__crawlErrors', JSON.stringify(list));
    } catch (e) {}
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__m = method; this.__u = String(url);
    return open.apply(this, arguments);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    window.__inflight += 1; window.__lastNet = Date.now();
    this.addEventListener('loadend', () => {
      window.__inflight -= 1; let b = ''; try { b = this.responseType === '' || this.responseType === 'text' ? this.responseText : JSON.stringify(this.response); } catch (e) {} record(this.status, this.__m, this.responseURL || this.__u, b);
    });
    return send.apply(this, arguments);
  };
  const f = window.fetch;
  window.fetch = async function (input, init) {
    window.__inflight += 1; window.__lastNet = Date.now();
    try {
      const response = await f.apply(this, arguments);
      record(response.status, (init && init.method) || 'GET', response.url);
      return response;
    } finally { window.__inflight -= 1; }
  };
})()`;

const pattern = (p) =>
  p
    .split('?')[0]
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}(?=\/|$)/g, '/:uuid')
    .replace(/(manage-role-groups\/)[^/]+(\/edit)/, '$1:name$2');

const SKIP_LINK =
  /^\/(login|admin-access|forbidden|about|privacy|task|classroom|check-in|araid|line-link|referral-report)(\/|$)/;

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { DataSource } = require('typeorm');
  const { AppModule } = require('../dist/app.module');
  const { SessionCookieService } = require('../dist/auth/session-cookie.service');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const ds = app.get(DataSource);
  const cookies = app.get(SessionCookieService);
  const fixtureIds = [];
  let chrome = null;
  const results = [];

  try {
    const [school] = await ds.query(`
      SELECT c.school_id, r.name AS role
      FROM case_referrals referral
      JOIN cases c ON c.id = referral.case_id AND c.deleted_at IS NULL
      JOIN roles r ON r.school_id = c.school_id AND r.name LIKE '%\\_BASE\\_ADMIN'
      GROUP BY c.school_id, r.name ORDER BY count(*) DESC, c.school_id LIMIT 1`);
    assert(school, 'no school with referrals');
    const [province] = await ds.query(
      `SELECT role, data_scope FROM users WHERE role ~ '^A[0-9]{2}_BASE_ADMIN$' AND status='ACTIVE' ORDER BY id LIMIT 1`,
    );
    const scopes = [
      { key: 'school', role: school.role, scope: { school_ids: [Number(school.school_id)] } },
      { key: 'global', role: 'ADMIN', scope: { global: true } },
    ];
    if (province) {
      const scope =
        typeof province.data_scope === 'string'
          ? JSON.parse(province.data_scope)
          : province.data_scope;
      scopes.splice(1, 0, { key: 'province', role: province.role, scope });
    }
    if (ONLY_SCOPE === 'grade') {
      const [grade] = await ds.query(
        `SELECT classroom.grade_level_id
         FROM school_classrooms classroom
         JOIN school_terms term ON term.id = classroom.school_term_id AND term.status = 'ACTIVE'
         WHERE classroom.school_id = $1 AND classroom.classroom_status = 'ACTIVE'
           AND classroom.deleted_at IS NULL
         GROUP BY classroom.grade_level_id ORDER BY count(*) DESC, classroom.grade_level_id LIMIT 1`,
        [school.school_id],
      );
      assert(grade, 'the school has no active classroom to narrow the scope to');
      scopes.push({
        key: 'grade',
        role: school.role,
        scope: {
          school_ids: [Number(school.school_id)],
          grade_levels: [Number(grade.grade_level_id)],
        },
      });
    }
    if (ONLY_SCOPE) scopes.splice(0, scopes.length, ...scopes.filter((x) => x.key === ONLY_SCOPE));
    console.log('scopes', JSON.stringify(scopes));

    chrome = await openChrome();
    const client = chrome;
    await client.call('Page.enable', {});
    await client.call('Network.enable', {});
    await client.call('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const idle = async () => {
      const started = Date.now();
      while (Date.now() - started < 12_000) {
        const state = await client
          .evaluate(
            `({ ready: document.readyState, inflight: window.__inflight || 0, quiet: Date.now() - (window.__lastNet || 0) })`,
          )
          .catch(() => null);
        if (state && state.ready === 'complete' && state.inflight === 0 && state.quiet > 700) {
          if (Date.now() - started > 500) return;
        }
        await wait(150);
      }
    };
    const go = async (route) => {
      await client.call('Page.navigate', { url: `${FRONTEND_URL}${route}` });
      await wait(250);
      await idle();
    };

    const permissions = Object.keys(START).filter((p) => ONLY.length === 0 || ONLY.includes(p));
    for (const scopeDef of scopes) {
      for (const permission of permissions) {
        const held = ['home', permission, ...(COMPANION[permission] || [])].filter(
          (v, i, a) => a.indexOf(v) === i,
        );
        if (GLOBAL_ONLY.has(permission) && scopeDef.key !== 'global') continue;
        const username = `permission_pages_smoke_${scopeDef.key}`;
        const [row] = await ds.query(
          `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions, role,
             data_scope, must_change_password, data_origin_code)
           VALUES ($1, 'x', 'ตรวจสิทธิ์รายหน้า', $2, 'ACTIVE', $3::jsonb, $4, $5::jsonb, FALSE, 'AUTOMATED_TEST')
           ON CONFLICT (username) DO UPDATE SET status='ACTIVE', permissions=$3::jsonb, role=$4,
             data_scope=$5::jsonb, data_origin_code='AUTOMATED_TEST'
           RETURNING id`,
          [
            username,
            scopeDef.key,
            JSON.stringify(held),
            scopeDef.role,
            JSON.stringify(scopeDef.scope),
          ],
        );
        const actorId = Number(row.id);
        if (!fixtureIds.includes(actorId)) fixtureIds.push(actorId);

        let cookie = null;
        cookies.setSession({ cookie: (name, value) => (cookie = { name, value }) }, actorId);
        await client.call('Network.setCookie', {
          name: cookie.name,
          value: cookie.value,
          url: BACKEND_URL,
          httpOnly: true,
          sameSite: 'Lax',
        });
        await go('/login');
        await client.evaluate(
          `sessionStorage.clear(); localStorage.clear(); localStorage.setItem('sts_user', ${JSON.stringify(
            JSON.stringify({
              id: actorId,
              username,
              roles: [scopeDef.role],
              permissions: held,
              data_scope: scopeDef.scope,
            }),
          )}); localStorage.setItem('admin_access', 'true'); true`,
        );

        const starts = [
          ...START[permission],
          ...(COMPANION[permission] || []).flatMap((p) => START[p]),
        ];
        const queue = starts.map((route) => ({ route, from: 'start' }));
        const seen = new Set();
        const perPattern = new Map();
        const visited = [];
        while (queue.length > 0 && visited.length < MAX_PAGES) {
          const { route, from } = queue.shift();
          const exact = route.split('?')[0];
          const key = pattern(route);
          if (seen.has(exact) || (perPattern.get(key) || 0) >= 3) continue;
          seen.add(exact);
          perPattern.set(key, (perPattern.get(key) || 0) + 1);
          await client
            .evaluate(`sessionStorage.setItem('__crawlAction', ''); true`)
            .catch(() => null);
          await go(route);
          const info = await client.evaluate(`(() => ({
            path: location.pathname,
            text: (document.querySelector('main') || document.body).innerText.slice(0, 4000),
            links: [...document.querySelectorAll('main a[href], [role=tablist] a[href], nav a[href], aside a[href]')]
              .map((a) => a.getAttribute('href')).filter((h) => h && h.startsWith('/')),
          }))()`);
          const flags = [];
          if (info.path.startsWith('/forbidden')) flags.push('FORBIDDEN_PAGE');
          if (info.path.startsWith('/login')) flags.push('LOGIN_REDIRECT');
          if (/ไม่สามารถโหลดข้อมูลได้/.test(info.text)) {
            flags.push(
              'ERROR_TEXT:' +
                (info.text.match(/[^\n]*ไม่สามารถโหลดข้อมูลได้[^\n]*/) || [''])[0].slice(0, 90),
            );
          }
          visited.push({ route, from, landed: info.path, flags });
          for (const link of info.links) {
            if (!SKIP_LINK.test(link) && link !== '/' && !seen.has(link.split('?')[0])) {
              queue.push({ route: link, from: route });
            }
          }

          // Every button the page offers: row tools on three rows, then the
          // page's own buttons. A button that is shown must work.
          if (!flags.includes('FORBIDDEN_PAGE') && !flags.includes('LOGIN_REDIRECT')) {
            const collect = () =>
              client
                .evaluate(
                  `(() => {
              document.querySelectorAll('[data-crawl]').forEach((el) => el.removeAttribute('data-crawl'));
              const DANGER = /ลบ|ปิดใช้|ปิดการ|ยกเลิก|รีเซ็ต|เปิดใช้|ระงับ|ส่งออก|ดาวน์โหลด|บันทึก|ยืนยัน|ออกจากระบบ|คัดลอก|อนุมัติ|ปฏิเสธ|นำเข้า|อัปโหลด|ส่ง|สร้างลิงก์|ออกลิงก์|พิมพ์|ล้าง/;
              const main = document.querySelector('main') || document.body;
              const out = [];
              const tag = (el, kind) => {
                if (el.disabled || el.getClientRects().length === 0) return;
                if (el.getAttribute('type') === 'submit') return;
                const label = (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 60);
                if (!label || DANGER.test(label)) return;
                const id = 'c' + out.length;
                el.setAttribute('data-crawl', id);
                out.push({ id, label, kind });
              };
              for (const shell of main.querySelectorAll('[data-slot="data-table"][data-action-column="true"]')) {
                const rows = [...shell.querySelectorAll('tbody tr')];
                const picks = [...new Set([0, Math.floor(rows.length / 2), rows.length - 1])].filter((i) => i >= 0);
                for (const i of picks) {
                  const cell = rows[i] && rows[i].querySelector('td:last-child');
                  if (cell) for (const b of cell.querySelectorAll('button')) tag(b, 'row' + i);
                }
              }
              let pageButtons = 0;
              for (const b of main.querySelectorAll('button')) {
                if (pageButtons >= 8) break;
                if (b.closest('table') || b.hasAttribute('data-crawl')) continue;
                if (b.closest('[role=listbox], nav')) continue;
                const before = out.length;
                tag(b, 'page');
                if (out.length > before) pageButtons += 1;
              }
              return out;
            })()`,
                )
                .catch(() => []);
            const labelsDone = new Set();
            let again = true;
            let rounds = 0;
            while (again && rounds++ < 14) {
              again = false;
              const targets = await collect();
              for (const target of targets) {
                // One page-level click per distinct label; row buttons per row.
                const dedupe =
                  target.kind === 'page'
                    ? 'page:' + target.label
                    : target.kind +
                      ':' +
                      target.label.replace(/ของ.*$/, '').replace(/\s+\S+\s+\S+$/, '');
                if (labelsDone.has(dedupe)) continue;
                labelsDone.add(dedupe);
                const clicked = await client
                  .evaluate(
                    `(() => {
                const el = document.querySelector('[data-crawl="${target.id}"]');
                if (!el) return false;
                sessionStorage.setItem('__crawlAction', ${JSON.stringify(target.kind + ' › ' + target.label)});
                el.click();
                return true;
              })()`,
                  )
                  .catch(() => false);
                if (!clicked) continue;
                await wait(250);
                await idle();
                const after = await client
                  .evaluate('location.pathname + location.search')
                  .catch(() => route);
                if (after.split('?')[0] !== info.path) {
                  const landedText = await client
                    .evaluate(
                      `(document.querySelector('main') || document.body).innerText.slice(0, 3000)`,
                    )
                    .catch(() => '');
                  const bad =
                    after.startsWith('/forbidden') ||
                    after.startsWith('/login') ||
                    /ไม่สามารถโหลดข้อมูลได้/.test(landedText);
                  visited.push({
                    route: after,
                    from: `${route} [${target.kind} › ${target.label}]`,
                    landed: after.split('?')[0],
                    flags: bad ? ['BUTTON_LED_TO_ERROR'] : [],
                  });
                  seen.add(after.split('?')[0]);
                  await go(route);
                  again = true;
                  break;
                }
                await client
                  .evaluate(
                    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`,
                  )
                  .catch(() => null);
              }
            }
          }
        }

        const errors = JSON.parse(
          (await client.evaluate(`sessionStorage.getItem('__crawlErrors') || '[]'`)) || '[]',
        );
        const result = { scope: scopeDef.key, permission, held, visited, errors };
        results.push(result);
        fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
        const flagged = visited.filter((v) => v.flags.length > 0).length;
        console.log(
          `${scopeDef.key} / ${permission}: ${visited.length} pages, ${errors.length} api>=400, ${flagged} flagged`,
        );
      }
    }
    const failures = [];
    for (const result of results) {
      const who = `${result.scope} / ${result.permission}`;
      for (const error of result.errors) {
        const line = `${error.status} ${error.method} ${error.url}`;
        if (EXPECTED_ERRORS.some((expected) => expected.test(line))) continue;
        failures.push(
          `${who}: ${line} on ${error.page}${error.action ? ` after [${error.action}]` : ''} — ${error.body}`,
        );
      }
      for (const page of result.visited) {
        if (page.flags.length > 0) {
          failures.push(`${who}: ${page.route} (from ${page.from}) ${page.flags.join(', ')}`);
        }
      }
    }
    assert(
      failures.length === 0,
      `${failures.length} page(s) failed for an account that holds them:\n  ${[...new Set(failures)].join('\n  ')}\nfull log: ${OUT}`,
    );
    console.log(
      `permission pages browser smoke passed (${results.length} accounts, ${results.reduce((sum, result) => sum + result.visited.length, 0)} pages)`,
    );
  } finally {
    chrome?.close();
    if (fixtureIds.length > 0) {
      await ds.query(`UPDATE users SET status = 'DISABLED' WHERE id = ANY($1::int[])`, [
        fixtureIds,
      ]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
