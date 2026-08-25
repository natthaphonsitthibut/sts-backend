const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { VALID_PERMISSION_IDS } = require('../dist/auth/permissions.constants');
const { assert, openChrome, waitFor } = require('./smoke-case-assistance-browser');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run permission/navigation smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3002';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const USERNAME = 'permission_navigation_browser_smoke';
const REASON = 'Automated permission navigation browser smoke';

function setSessionCookie(sessionCookieService, userId) {
  let cookie = null;
  sessionCookieService.setSession(
    { cookie: (name, value) => (cookie = { name, value }) },
    userId,
  );
  assert(cookie, 'session cookie was not created');
  return cookie;
}

async function upsertUser(dataSource, username, role, permissions, dataScope, firstName) {
  const [row] = await dataSource.query(
    `INSERT INTO users (
       username, password, "FirstName", "LastName", status, permissions, role,
       data_scope, must_change_password, data_origin_code
     ) VALUES ($1, 'x', $2, 'Permission Smoke', 'ACTIVE', $3::jsonb, $4,
       $5::jsonb, FALSE, 'AUTOMATED_TEST')
     ON CONFLICT (username) DO UPDATE SET
       status='ACTIVE', permissions=$3::jsonb, role=$4, data_scope=$5::jsonb,
       data_origin_code='AUTOMATED_TEST', "FirstName"=$2, "LastName"='Permission Smoke'
     RETURNING id`,
    [username, firstName, JSON.stringify(permissions), role, JSON.stringify(dataScope)],
  );
  return Number(row.id);
}

async function updateAuthority(dataSource, actorId, permissions, dataScope) {
  await dataSource.query(
    `UPDATE users SET permissions=$2::jsonb, data_scope=$3::jsonb WHERE id=$1`,
    [actorId, JSON.stringify(permissions), JSON.stringify(dataScope)],
  );
}

async function api(cookie, path, options = {}) {
  return await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
      cookie: `${cookie.name}=${cookie.value}`,
    },
  });
}

async function navigate(client, path) {
  await client.call('Page.navigate', { url: `${FRONTEND_URL}${path}` });
  await waitFor(
    async () => (await client.evaluate('document.readyState')) === 'complete',
    `page did not finish loading: ${path}`,
  );
}

async function refreshAuthority(client, expectedPermissions) {
  await client.evaluate(`window.dispatchEvent(new Event('focus')); true`);
  await waitFor(async () => {
    const stored = await client.evaluate(`(() => {
      const raw = sessionStorage.getItem('sts_user') || localStorage.getItem('sts_user');
      if (!raw) return [];
      return JSON.parse(raw).permissions || [];
    })()`);
    return JSON.stringify([...stored].sort()) === JSON.stringify([...expectedPermissions].sort());
  }, `session authority did not refresh to ${expectedPermissions.join(',')}`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  let actorId = null;
  let insideId = null;
  let outsideId = null;
  let insideTarget = null;
  let outsideTarget = null;
  let manageScope = null;
  let roleGroupOutsideSchoolId = null;
  let caseId = null;
  let notificationId = null;
  let chrome = null;

  try {
    const [enrollment] = await dataSource.query(
      `SELECT enrollment.student_uuid, enrollment.person_uuid,
              enrollment."SchoolID_Onec" AS school_id,
              CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec") AS student_name,
              school.name AS school_name
       FROM student_current_enrollment_resolution resolution
       JOIN student_term enrollment
         ON enrollment.student_uuid=resolution.selected_student_uuid
        AND enrollment.deleted_at IS NULL
       JOIN schools school ON school.id=enrollment."SchoolID_Onec"
       WHERE resolution.resolution_state='ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM cases current_case
           WHERE current_case.student_uuid=enrollment.student_uuid
             AND current_case.deleted_at IS NULL
             AND current_case.status IN ('OPEN','IN_PROGRESS','PENDING_REVIEW','STUDENT_NOT_FOUND')
         )
       ORDER BY enrollment.student_uuid LIMIT 1`,
    );
    assert(enrollment, 'no active canonical enrollment is available');
    const [outsideSchool] = await dataSource.query(
      `SELECT id FROM schools WHERE id <> $1 ORDER BY id LIMIT 1`,
      [enrollment.school_id],
    );
    assert(outsideSchool, 'no second school is available for out-of-scope proof');
    const insideScope = { school_ids: [Number(enrollment.school_id)] };
    const outsideScope = { school_ids: [Number(outsideSchool.id)] };
    const bothPermissions = ['students', 'dashboard'];

    actorId = await upsertUser(
      dataSource,
      USERNAME,
      'ADMIN',
      bothPermissions,
      insideScope,
      'Navigation Actor',
    );
    [insideTarget] = await dataSource.query(
      `SELECT u.id, u.username, u.role,
              TRIM(CONCAT_WS(' ', u."FirstName", u."LastName")) AS display_name,
              (u.data_scope->'school_ids'->>0)::int AS school_id
       FROM users u
       WHERE u.status='ACTIVE'
         AND u.data_origin_code <> 'AUTOMATED_TEST'
         AND jsonb_typeof(u.data_scope->'school_ids')='array'
       ORDER BY u.id LIMIT 1`,
    );
    [outsideTarget] = await dataSource.query(
      `SELECT u.id, u.username, u.role,
              TRIM(CONCAT_WS(' ', u."FirstName", u."LastName")) AS display_name
       FROM users u
       WHERE u.status='ACTIVE'
         AND u.data_origin_code <> 'AUTOMATED_TEST'
         AND u.data_scope->'global'='true'::jsonb
       ORDER BY u.id LIMIT 1`,
    );
    assert(insideTarget && outsideTarget, 'need existing in-scope and out-of-scope user targets');
    insideId = Number(insideTarget.id);
    outsideId = Number(outsideTarget.id);
    manageScope = { school_ids: [Number(insideTarget.school_id)] };
    const [roleGroupOutsideSchool] = await dataSource.query(
      `SELECT id FROM schools WHERE id <> $1 ORDER BY id LIMIT 1`,
      [insideTarget.school_id],
    );
    assert(roleGroupOutsideSchool, 'need an out-of-scope school for role-group proof');
    roleGroupOutsideSchoolId = Number(roleGroupOutsideSchool.id);
    const [createdCase] = await dataSource.query(
      `INSERT INTO cases (
         student_uuid, student_name, school_id, student_school, reason_flagged,
         status, workflow_phase_code, created_by
       ) VALUES ($1,$2,$3,$4,$5,'OPEN','FOLLOW_UP',$6) RETURNING id`,
      [
        enrollment.student_uuid,
        enrollment.student_name,
        enrollment.school_id,
        enrollment.school_name,
        REASON,
        actorId,
      ],
    );
    caseId = Number(createdCase.id);
    const [createdNotification] = await dataSource.query(
      `INSERT INTO notifications (
         recipient_user_id, type_code, title, body, ref_entity, ref_id,
         student_person_uuid, case_id, case_status_code, student_name_snapshot, reason_text
       ) VALUES ($1,'CASE_STATUS_CHANGED','Permission smoke','Permission smoke body',
         'case',$2,$3,$4,'OPEN',$5,$6) RETURNING id`,
      [
        actorId,
        String(caseId),
        enrollment.person_uuid,
        caseId,
        enrollment.student_name,
        REASON,
      ],
    );
    notificationId = createdNotification.id;

    const cookie = setSessionCookie(sessionCookieService, actorId);
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
          roles: ['ADMIN'],
          permissions: bothPermissions,
          data_scope: insideScope,
        }),
      )}); localStorage.setItem('admin_access', 'true'); true`,
    );

    // students + dashboard: both directions are visible and both APIs authorize.
    const initialStudentResponse = await api(cookie, `/api/students/${enrollment.student_uuid}`);
    assert(
      initialStudentResponse.status === 200,
      `authorized student API returned ${initialStudentResponse.status}: ${(await initialStudentResponse.text()).slice(0, 300)}`,
    );
    for (const path of [
      `/api/students/${enrollment.student_uuid}/profile-summary`,
      `/api/students/${enrollment.student_uuid}/cases`,
    ]) {
      const response = await api(cookie, path);
      assert(
        response.status === 200,
        `authorized student dependency ${path} returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    await navigate(client, `/students/${enrollment.student_uuid}`);
    await waitFor(
      async () => (await client.evaluate('document.body.innerText')).includes(enrollment.student_name),
      async () =>
        `student detail did not render for the in-scope actor: ${await client.evaluate(
          `location.pathname + ' | ' + document.body.innerText.slice(0, 500) + ' | resources=' +
            performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/')).slice(-12).join(',')`,
        )}`,
    );
    await client.clickText('ประวัติการติดตาม');
    await waitFor(
      async () => await client.evaluate(`Boolean(document.querySelector('a[href="/cases/${caseId}"]'))`),
      'student activity did not expose the authorized case link',
    );
    assert((await api(cookie, `/api/cases/${caseId}`)).status === 200, 'authorized case API failed');

    await navigate(client, `/cases/${caseId}`);
    await waitFor(
      async () => await client.evaluate(
        `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'ข้อมูลนักเรียน')`,
      ),
      async () =>
        `case detail did not expose the authorized student link: ${await client.evaluate(
          `document.body.innerText.slice(0, 700) + ' | links=' + [...document.querySelectorAll('a')].map((link) => link.textContent.trim() + '=' + link.getAttribute('href')).join('|')`,
        )}`,
    );

    // students-only: summary remains, case CTA disappears, direct route/API fail closed.
    await updateAuthority(dataSource, actorId, ['students'], insideScope);
    await refreshAuthority(client, ['students']);
    await navigate(client, `/students/${enrollment.student_uuid}`);
    await waitFor(
      async () => await client.evaluate(
        `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'ประวัติการติดตาม')`,
      ),
      'student activity tabs did not render after permission refresh',
    );
    await client.clickText('ประวัติการติดตาม');
    await waitFor(
      async () => !(await client.evaluate(`Boolean(document.querySelector('a[href="/cases/${caseId}"]'))`)),
      'case link remained visible after dashboard permission was revoked',
    );
    assert(
      (await client.evaluate(`document.body.innerText.includes(${JSON.stringify(REASON)})`)),
      'student-scoped case summary disappeared with the destination link',
    );
    assert((await api(cookie, `/api/cases/${caseId}`)).status === 403, 'direct case API did not deny');
    await navigate(client, `/cases/${caseId}`);
    await waitFor(
      async () => (await client.evaluate('location.pathname')) === '/forbidden',
      'direct case route did not fail closed',
    );

    // dashboard-only: case identity remains, student CTA disappears, direct student fails closed.
    await updateAuthority(dataSource, actorId, ['dashboard'], insideScope);
    await navigate(client, `/students/${enrollment.student_uuid}`);
    await refreshAuthority(client, ['dashboard']);
    await navigate(client, `/cases/${caseId}`);
    await waitFor(
      async () => (await client.evaluate('document.body.innerText')).includes(enrollment.student_name),
      'case identity summary disappeared for dashboard-only actor',
    );
    assert(
      !(await client.evaluate(
        `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'ข้อมูลนักเรียน')`,
      )),
      'student link remained visible without students permission',
    );
    assert(
      (await api(cookie, `/api/students/${enrollment.student_uuid}`)).status === 403,
      'direct student API did not deny',
    );
    await navigate(client, `/students/${enrollment.student_uuid}`);
    await waitFor(
      async () => (await client.evaluate('location.pathname')) === '/forbidden',
      'direct student route did not fail closed',
    );

    // Current notification permission/scope is rechecked, not trusted from fan-out time.
    let notificationResponse = await api(cookie, '/api/notifications?status=all&page=1&limit=20');
    let notificationBody = await notificationResponse.json();
    assert(
      notificationResponse.status === 200 &&
        notificationBody.rows.some((row) => row.id === notificationId),
      'dashboard actor did not receive its authorized notification',
    );
    await updateAuthority(dataSource, actorId, [], insideScope);
    notificationResponse = await api(cookie, '/api/notifications?status=all&page=1&limit=20');
    notificationBody = await notificationResponse.json();
    assert(
      notificationResponse.status === 200 &&
        !notificationBody.rows.some((row) => row.id === notificationId) &&
        notificationBody.unreadCount === 0,
      'revoked notification permission still exposed case PII or counts',
    );

    await updateAuthority(dataSource, actorId, ['dashboard'], outsideScope);
    assert(
      [403, 404].includes((await api(cookie, `/api/cases/${caseId}`)).status),
      'out-of-scope case API was not denied',
    );
    notificationResponse = await api(cookie, '/api/notifications?status=all&page=1&limit=20');
    notificationBody = await notificationResponse.json();
    assert(
      !notificationBody.rows.some((row) => row.id === notificationId),
      'out-of-scope notification still exposed the case',
    );

    // One manage-users page: scoped actor sees only subset targets and cannot widen scope.
    const managePermissions = [...VALID_PERMISSION_IDS];
    await updateAuthority(dataSource, actorId, managePermissions, manageScope);
    await navigate(client, `/cases/${caseId}`);
    await refreshAuthority(client, managePermissions);
    const usersResponse = await api(
      cookie,
      `/api/users?page=1&limit=50&searchTerm=${encodeURIComponent(insideTarget.username)}`,
    );
    const usersBody = await usersResponse.text();
    assert(
      usersResponse.status === 200 &&
        usersBody.includes(insideTarget.username),
      `manage-users list did not enforce target subset scope (${usersResponse.status}): ${usersBody.slice(0, 900)}`,
    );
    const outsideUsersResponse = await api(
      cookie,
      `/api/users?page=1&limit=50&searchTerm=${encodeURIComponent(outsideTarget.username)}`,
    );
    const outsideUsersBody = await outsideUsersResponse.text();
    assert(
      outsideUsersResponse.status === 200 && !outsideUsersBody.includes(outsideTarget.username),
      'manage-users search leaked an out-of-scope target',
    );
    assert(
      [403, 404].includes((await api(cookie, `/api/users/${outsideId}`)).status),
      'out-of-scope user direct API was not denied',
    );
    const widenResponse = await api(cookie, `/api/users/${insideId}`, {
      method: 'PUT',
      body: JSON.stringify({
        role: insideTarget.role,
        permissions: ['home'],
        data_scope: { global: true },
      }),
    });
    assert(widenResponse.status === 403, `scope widening returned ${widenResponse.status}`);
    assert(
      [403, 404].includes(
        (await api(cookie, `/api/users/role-groups?schoolId=${roleGroupOutsideSchoolId}`)).status,
      ),
      'role-group school selector accepted an out-of-scope school',
    );
    await navigate(client, '/manage-users');
    await waitFor(
      async () => await client.evaluate(`Boolean(document.querySelector('input[placeholder="ค้นหา"]'))`),
      'manage-users search did not render',
    );
    await client.evaluate(`(() => {
      const input = document.querySelector('input[placeholder="ค้นหา"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(insideTarget.username)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(
      async () => {
        const text = await client.evaluate('document.body.innerText');
        return text.includes(insideTarget.display_name || insideTarget.username);
      },
      'scoped manage-users browser list leaked the outside target',
    );

    // Mobile refresh/deep-link remains bounded and does not overflow.
    await updateAuthority(dataSource, actorId, bothPermissions, insideScope);
    await refreshAuthority(client, bothPermissions);
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(client, `/cases/${caseId}`);
    await waitFor(
      async () => await client.evaluate(
        `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'ข้อมูลนักเรียน')`,
      ),
      'authorized student CTA did not survive mobile refresh',
    );
    assert(
      !(await client.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1')),
      'permission-gated case page overflowed at 390px',
    );

    console.log(
      'permission navigation browser smoke passed (profile↔case gates, direct API/routes, permission refresh/revocation, notification current scope, user/group subset, mobile)',
    );
  } finally {
    if (chrome) chrome.close();
    if (actorId) {
      await dataSource.query(`DELETE FROM notifications WHERE recipient_user_id=$1`, [actorId]);
      await dataSource.query(`DELETE FROM cases WHERE created_by=$1`, [actorId]);
    }
    for (const id of [actorId].filter(Boolean)) {
      await dataSource.query(`UPDATE users SET status='DISABLED' WHERE id=$1`, [id]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
