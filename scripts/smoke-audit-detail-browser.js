/** Open a real teacher-link log as an audit-log:all-only scoped fixture. */
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { assert, openChrome, waitFor } = require('./smoke-case-assistance-browser');
if (process.env.NODE_ENV === 'production' || !(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Audit detail browser smoke requires a non-production _smoke DB');
}
const API = process.env.SMOKE_BACKEND_URL || 'http://localhost:3001';
const WEB = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5175';
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const db = app.get(DataSource);
  let chrome, userId;
  try {
    const [log] = await db.query(`SELECT a.id,
        COALESCE(a.metadata ->> 'schoolId', a.metadata -> 'scope' -> 'school_ids' ->> 0)::int AS school_id
      FROM audit_log a WHERE a.action IN ('CLASSROOM_ATTENDANCE_LINK_BULK_CREATE', 'CLASSROOM_ATTENDANCE_ASSIGNMENT_CREATE')
      AND a.data_origin_code <> 'AUTOMATED_TEST'
      AND jsonb_typeof(a.metadata -> 'scope' -> 'school_ids') = 'array'
      AND jsonb_array_length(a.metadata -> 'scope' -> 'school_ids') >= 1
      ORDER BY a.id DESC LIMIT 1`);
    assert(log, 'need an operational teacher-link creation log with one scoped school in the smoke clone');
    const permissions = ['home', 'audit-log:all'];
    const scope = { school_ids: [Number(log.school_id)] };
    const username = 'audit_detail_browser_smoke';
    const [user] = await db.query(`INSERT INTO users (username, password, status, role,
      permissions, data_scope, must_change_password, data_origin_code)
      VALUES ($1, 'x', 'ACTIVE', 'DIRECTOR', $2::jsonb, $3::jsonb, FALSE, 'AUTOMATED_TEST')
      ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', permissions = $2::jsonb,
      data_scope = $3::jsonb, data_origin_code = 'AUTOMATED_TEST' RETURNING id`,
      [username, JSON.stringify(permissions), JSON.stringify(scope)]);
    userId = Number(user.id);
    chrome = await openChrome();
    await chrome.call('Page.enable');
    await chrome.call('Network.enable');
    let cookie;
    app.get(SessionCookieService).setSession({ cookie: (name, value) => cookie = { name, value } }, userId);
    await chrome.call('Network.setCookie', { ...cookie, url: API, httpOnly: true, sameSite: 'Lax' });
    await chrome.call('Page.navigate', { url: `${WEB}/login` });
    await waitFor(async () => await chrome.evaluate("document.readyState === 'complete'"), 'login did not load');
    await chrome.evaluate(`localStorage.clear(); localStorage.setItem('sts_user', ${JSON.stringify(
      JSON.stringify({ id: userId, username, roles: ['DIRECTOR'], permissions, data_scope: scope }))});
      localStorage.setItem('admin_access', 'true'); true`);
    await chrome.call('Page.navigate', { url: `${WEB}/audit-log/${log.id}` });
    await waitFor(async () => (await chrome.evaluate('document.body.innerText')).includes('รายละเอียดรายการ'),
      'audit-log:all could not open the teacher-link detail page');
    const status = await chrome.evaluate(`fetch(${JSON.stringify(`${API}/api/audit-log/${log.id}`)},
      { credentials: 'include' }).then(r => r.status)`);
    assert(status === 200, 'same-school teacher-link detail returned non-200');
    await db.query(`UPDATE users SET data_scope = $2::jsonb WHERE id = $1`,
      [userId, JSON.stringify({ school_ids: [-1] })]);
    const denied = await chrome.evaluate(`fetch(${JSON.stringify(`${API}/api/audit-log/${log.id}`)},
      { credentials: 'include' }).then(r => r.status)`);
    assert(denied === 404, 'out-of-scope teacher-link detail was visible');
    console.log('Audit detail browser smoke passed: audit-log:all-only opens teacher-link detail; other school returns 404');
  } finally {
    chrome?.close();
    if (userId) await db.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [userId]);
    await app.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
