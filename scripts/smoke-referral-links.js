/**
 * The agency's referral link over real HTTP and the real schema
 * (tasks/task-agency-referral-report-link.md): the school issues a link and a
 * code, the agency enters the code, verifies with AraID and files its report,
 * and the case goes back to รอพิจารณา with the reporter on record. Every
 * refusal is exercised — no staff permission, a bad window, wrong codes up to
 * the lock, a locked / revoked / expired / not-yet-open / spent link, data or a
 * report without the AraID session, a future action date, and cancellation racing with a report.
 */
const { ValidationPipe } = require('@nestjs/common');
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { AraIdService } = require('../dist/araid/araid.service');
const { AraIdSessionCookieService } = require('../dist/araid/araid-session-cookie.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');
const { authConfig } = require('../dist/config/auth.config');
const { RiskProfileService } = require('../dist/risk-profile/risk-profile.service');
const { CaseService } = require('../dist/task/case.service');
const { MagicSessionStoreService } = require('../dist/auth/magic-session-store.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run referral link smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const USERNAME = 'referral_link_smoke_director';
const READER_USERNAME = 'referral_link_smoke_reader';
const REASON = 'Automated referral link smoke';
const REPORTER = { title: 'นาง', given: 'สมใจ', family: 'หน่วยงานทดสอบ' };
const REPORTER_NAME = `${REPORTER.title} ${REPORTER.given} ${REPORTER.family}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AraIdService)
    .useValue({
      getVerifiedIdentityClaim: async () => ({
        providerSubject: 'smoke-referral-araid-subject',
        identityNumber: '0000000000000',
      }),
      getSessionProfile: async () => ({
        titleTh: REPORTER.title,
        givenNameTh: REPORTER.given,
        familyNameTh: REPORTER.family,
      }),
    })
    .overrideProvider(RiskProfileService)
    .useValue({ requestStudentRecalculation: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: false,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: createValidationException,
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());
  await app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const dataSource = app.get(DataSource);
  const jwt = app.get(JwtService);
  const runtimeAuth = app.get(authConfig.KEY);
  const araIdCookies = app.get(AraIdSessionCookieService);
  const caseService = app.get(CaseService);

  let caseId = null;
  const userIds = [];

  const cookieFor = (userId) =>
    `${runtimeAuth.cookieName}=${encodeURIComponent(jwt.sign({ sub: userId }))}`;
  const request = async (method, path, expectedStatus, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
    });
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = raw;
    }
    assert(
      response.status === expectedStatus,
      `${method} ${path}: expected ${expectedStatus}, received ${response.status} ${raw.slice(0, 200)}`,
    );
    return { response, payload };
  };
  const responseCookie = (response, name) => {
    const header = response.headers.get('set-cookie') || '';
    const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
    assert(match, `Response did not set ${name}`);
    return `${name}=${match[1]}`;
  };

  try {
    const [enrollment] = await dataSource.query(
      `SELECT enrollment.student_uuid,
              enrollment."SchoolID_Onec" AS school_id,
              school.name AS school_name,
              CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec") AS student_name
       FROM student_term enrollment
       INNER JOIN schools school ON school.id = enrollment."SchoolID_Onec"
       WHERE enrollment.student_uuid IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM cases existing
           WHERE existing.student_uuid = enrollment.student_uuid
             AND existing.deleted_at IS NULL
             AND existing.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW',
               'STUDENT_NOT_FOUND', 'AWAITING_REFERRAL', 'AWAITING_REFERRAL_OUTCOME')
         )
       ORDER BY enrollment.student_uuid
       LIMIT 1`,
    );
    assert(enrollment, 'need one student without an active case');
    const schoolId = Number(enrollment.school_id);
    const [agency] = await dataSource.query(
      `SELECT id, agency_name FROM referral_agencies WHERE is_active ORDER BY id LIMIT 1`,
    );
    assert(agency, 'need one active referral agency');

    const fixtureUser = async (username, permissions, scopedSchoolId = schoolId) => {
      const [row] = await dataSource.query(
        `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions,
           role, data_scope, must_change_password, data_origin_code)
         VALUES ($1, 'x', 'ผอ.', 'ทดสอบลิงก์ส่งต่อ', 'ACTIVE', $2::jsonb, 'DIRECTOR', $3::jsonb,
           FALSE, 'AUTOMATED_TEST')
         ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', permissions = $2::jsonb,
           data_scope = $3::jsonb, data_origin_code = 'AUTOMATED_TEST'
         RETURNING id`,
        [username, JSON.stringify(permissions), JSON.stringify({ school_ids: [scopedSchoolId] })],
      );
      userIds.push(Number(row.id));
      return Number(row.id);
    };
    const directorPermissions = ['dashboard', 'case:assign', 'case:review'];
    const directorId = await fixtureUser(USERNAME, directorPermissions);
    const readerId = await fixtureUser(READER_USERNAME, ['dashboard']);
    const foreignId = await fixtureUser(
      'referral_link_smoke_foreign',
      directorPermissions,
      schoolId + 999999,
    );
    const director = {
      id: directorId,
      username: USERNAME,
      FirstName: 'ผอ.',
      LastName: 'ทดสอบลิงก์ส่งต่อ',
      roles: ['DIRECTOR'],
      permissions: directorPermissions,
      data_scope: { school_ids: [schoolId] },
    };
    const directorCookie = cookieFor(directorId);

    const [createdCase] = await dataSource.query(
      `INSERT INTO cases (student_uuid, student_name, school_id, student_school, reason_flagged,
         status, workflow_phase_code)
       VALUES ($1, $2, $3, $4, $5, 'PENDING_REVIEW', 'FOLLOW_UP')
       RETURNING id`,
      [enrollment.student_uuid, enrollment.student_name, schoolId, enrollment.school_name, REASON],
    );
    caseId = Number(createdCase.id);
    const caseStatus = async () =>
      (await dataSource.query(`SELECT status FROM cases WHERE id = $1`, [caseId]))[0].status;
    // ส่งต่อหน่วยงาน on the review only decides; the case waits in รอส่งต่อ.
    const decide = async (note) => {
      await caseService.reviewCase(
        caseId,
        { review_action: 'REFER_AGENCY', review_note: note },
        director,
      );
      assert(
        (await caseStatus()) === 'AWAITING_REFERRAL',
        'review did not park the case in รอส่งต่อ',
      );
    };
    const window = (startOffsetMinutes = -5, endOffsetMinutes = 60 * 24) => ({
      starts_at: new Date(Date.now() + startOffsetMinutes * 60_000).toISOString(),
      expires_at: new Date(Date.now() + endOffsetMinutes * 60_000).toISOString(),
    });
    const sendBody = (note, timing = window()) => ({
      referral_agency_id: Number(agency.id),
      referral_note: note,
      ...timing,
    });
    const sendPath = `/api/cases/${caseId}/referrals`;
    // ส่งต่อ from the case page: the referral's มอบหมาย, which issues the link.
    const send = async (note, timing) => {
      const { payload } = await request('POST', sendPath, 201, {
        headers: { cookie: directorCookie },
        body: sendBody(note, timing),
      });
      const { url, access_code: code, referral_id: referralId } = payload.data;
      assert(/^\d{6}$/.test(code), `access code is not six digits: ${code}`);
      const token = url.split('/referral-report/')[1];
      assert(token && token.length >= 32, `link url carries no token: ${url}`);
      assert(
        (await caseStatus()) === 'AWAITING_REFERRAL_OUTCOME',
        'sending did not move the case to รอผลการส่งต่อ',
      );
      const codePath = `/api/cases/${caseId}/referrals/${referralId}/access-code`;
      await request('GET', codePath, 401);
      await request('GET', codePath, 403, { headers: { cookie: cookieFor(readerId) } });
      await request('GET', codePath, 404, { headers: { cookie: cookieFor(foreignId) } });
      const first = await request('GET', codePath, 200, { headers: { cookie: directorCookie } });
      const second = await request('GET', codePath, 200, { headers: { cookie: directorCookie } });
      assert(
        first.payload.data.access_code === code && second.payload.data.access_code === code,
        'viewing a code changed it',
      );
      assert(
        first.response.headers.get('cache-control') === 'private, no-store',
        'code response can be cached',
      );
      await request(
        'GET',
        `/api/cases/${caseId + 999999}/referrals/${referralId}/access-code`,
        404,
        { headers: { cookie: directorCookie } },
      );
      const [stored] = await dataSource.query(
        'SELECT access_code_encrypted FROM case_referral_links WHERE case_referral_id = $1',
        [referralId],
      );
      assert(
        stored.access_code_encrypted !== code && stored.access_code_encrypted.startsWith('v1:'),
        'code was not encrypted',
      );
      await dataSource.query(
        'UPDATE case_referral_links SET access_code_encrypted = NULL WHERE case_referral_id = $1',
        [referralId],
      );
      await request('GET', codePath, 409, { headers: { cookie: directorCookie } });
      await dataSource.query(
        'UPDATE case_referral_links SET access_code_encrypted = $2 WHERE case_referral_id = $1',
        [referralId, stored.access_code_encrypted],
      );
      const detail = await request('GET', `/api/cases/${caseId}`, 200, {
        headers: { cookie: directorCookie },
      });
      assert(
        !JSON.stringify(detail.payload).includes('access_code'),
        'case read leaked code fields',
      );
      return { token, code, referralId };
    };
    const cancelPath = (referralId) => `/api/cases/${caseId}/referrals/${referralId}/cancel`;
    const referralRow = async (referralId) =>
      (
        await dataSource.query(
          `SELECT referral.status_code, link.status_code AS link_status, link.cancel_reason
           FROM case_referrals referral
           LEFT JOIN LATERAL (
             SELECT status_code, cancel_reason FROM case_referral_links
             WHERE case_referral_id = referral.id ORDER BY created_at DESC LIMIT 1
           ) link ON true
           WHERE referral.id = $1`,
          [referralId],
        )
      )[0];
    const linkPath = (token) => `/api/referral-links/${encodeURIComponent(token)}`;

    // 1. Deciding to refer parks the case; sending is the school's, with a sane window.
    await decide('ส่งต่อพบนักจิตวิทยา');
    await request('POST', sendPath, 401, { body: sendBody('ส่งต่อ') });
    await request('POST', sendPath, 403, {
      headers: { cookie: cookieFor(readerId) },
      body: sendBody('ส่งต่อ'),
    });
    await request('POST', sendPath, 400, {
      headers: { cookie: directorCookie },
      body: sendBody('ส่งต่อ', window(60, 30)),
    });
    await request('POST', sendPath, 400, {
      headers: { cookie: directorCookie },
      body: { ...sendBody('ส่งต่อ'), referral_agency_id: 999999999 },
    });
    console.log(
      'ok ส่งต่อหน่วยงาน parks the case in รอส่งต่อ; sending needs case:review, an agency and a window',
    );

    // 2. Wrong codes count down and the fifth locks the link; a locked round
    //    can be sent again, which closes it as ยกเลิก.
    // A pending referral created before report links existed has no link/code.
    const [legacyReferral] = await dataSource.query(
      `INSERT INTO case_referrals (
      case_review_id, case_id, referral_agency_id, referred_by_user_id, referral_note, referred_at)
      SELECT review.id, $1, $2, $3, 'การส่งต่อเดิมก่อนมีลิงก์', now() - interval '1 hour'
      FROM case_reviews review WHERE review.case_id = $1 AND review.review_action = 'REFER_AGENCY'
      ORDER BY review.reviewed_at DESC LIMIT 1 RETURNING id`,
      [caseId, Number(agency.id), directorId],
    );
    await dataSource.query(`UPDATE cases SET status = 'AWAITING_REFERRAL_OUTCOME' WHERE id = $1`, [
      caseId,
    ]);
    await request('POST', sendPath, 403, {
      headers: { cookie: cookieFor(readerId) },
      body: sendBody('ออกลิงก์รายการเดิม'),
    });
    const locked = await send('ส่งต่อพบนักจิตวิทยา');
    assert(
      (await referralRow(legacyReferral.id)).status_code === 'CANCELLED',
      'pending legacy referral without a link could not be replaced',
    );
    console.log(
      'ok pending legacy referral without a link can issue a new round with URL/code; permission gate remains',
    );

    await request('POST', sendPath, 409, {
      headers: { cookie: directorCookie },
      body: sendBody('ส่งซ้ำระหว่างรอผล'),
    });
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const wrong = String((Number(locked.code) + attempt) % 1_000_000).padStart(6, '0');
      const { payload } = await request('POST', `${linkPath(locked.token)}/araid/challenge`, 400, {
        body: { access_code: wrong },
      });
      assert(
        JSON.stringify(payload).includes(`เหลืออีก ${5 - attempt} ครั้ง`),
        `wrong code ${attempt} did not count down: ${JSON.stringify(payload)}`,
      );
    }
    await request('POST', `${linkPath(locked.token)}/araid/challenge`, 403, {
      body: { access_code: String((Number(locked.code) + 5) % 1_000_000).padStart(6, '0') },
    });
    await request('POST', `${linkPath(locked.token)}/araid/challenge`, 403, {
      body: { access_code: locked.code },
    });
    await request('GET', linkPath(locked.token), 403);
    const resent = await send('ส่งต่อใหม่หลังลิงก์ถูกล็อก');
    const lockedRow = await referralRow(locked.referralId);
    assert(
      lockedRow.status_code === 'CANCELLED' && lockedRow.cancel_reason?.includes('ล็อก'),
      `locked round did not close as ยกเลิก: ${JSON.stringify(lockedRow)}`,
    );
    console.log('ok five wrong codes lock the link; sending again closes that round as ยกเลิก');

    // 3. ยกเลิกการส่งต่อ, like ยกเลิกการมอบหมาย: a reason, the link dies, back to รอส่งต่อ.
    await request('POST', cancelPath(resent.referralId), 400, {
      headers: { cookie: directorCookie },
      body: { cancel_reason: '   ' },
    });
    await request('POST', cancelPath(resent.referralId), 200, {
      headers: { cookie: directorCookie },
      body: { cancel_reason: 'ส่งผิดหน่วยงาน' },
    });
    assert((await caseStatus()) === 'AWAITING_REFERRAL', 'cancelling did not return to รอส่งต่อ');
    const cancelledRow = await referralRow(resent.referralId);
    assert(
      cancelledRow.status_code === 'CANCELLED' &&
        cancelledRow.link_status === 'REVOKED' &&
        cancelledRow.cancel_reason === 'ส่งผิดหน่วยงาน',
      `cancelled round is ${JSON.stringify(cancelledRow)}`,
    );
    await request('GET', linkPath(resent.token), 410);
    await request('POST', cancelPath(resent.referralId), 409, {
      headers: { cookie: directorCookie },
      body: { cancel_reason: 'ยกเลิกซ้ำ' },
    });
    const link = await send('ส่งต่อพบนักจิตวิทยา');
    const referralId = link.referralId;
    await request('GET', `/api/referral-links/${'x'.repeat(64)}`, 404);
    console.log(
      'ok ยกเลิกการส่งต่อ needs a reason, kills the link and returns the case to รอส่งต่อ',
    );

    // 4. Before AraID the page only recognises itself; nothing can be filed.
    const masked = await request('GET', linkPath(link.token), 200);
    assert(masked.payload.data.auth_required === true, 'unverified link did not ask for identity');
    for (const field of [
      'student_address',
      'contact_channels',
      'follow_up_history',
      'student_phone',
    ]) {
      assert(!(field in masked.payload.data), `unverified link exposed ${field}`);
    }
    assert(
      masked.payload.data.student_name !== enrollment.student_name,
      'unverified link showed the full student name',
    );
    const report = {
      result_code: 'SUCCEEDED',
      action_date: new Date().toISOString().slice(0, 10),
      result_note: 'หน่วยงานช่วยเหลือเรียบร้อย นักเรียนกลับมาเรียนแล้ว',
    };
    await request('POST', `${linkPath(link.token)}/report`, 401, { body: report });
    await request('POST', `${linkPath(link.token)}/report`, 401, {
      headers: { 'x-referral-session': 'ms_not-a-real-session' },
      body: report,
    });
    console.log('ok an unverified link shows a masked name only and refuses a report');

    // 5. Code → AraID → session carrying who verified.
    const challenge = await request('POST', `${linkPath(link.token)}/araid/challenge`, 201, {
      body: { access_code: link.code },
    });
    const challengeToken = challenge.payload.data.challengeToken;
    const verificationHash = new URLSearchParams(
      new URL(challenge.payload.data.verificationUrl).hash.slice(1),
    );
    assert(
      verificationHash.get('scope') === 'referral-link',
      `AraID url scope is ${verificationHash.get('scope')}`,
    );
    const begun = await request('POST', '/api/referral-links/araid/challenge/begin', 201, {
      headers: { 'x-referral-araid-challenge': challengeToken },
      body: {},
    });
    const authorizationCookie = responseCookie(begun.response, 'araid_referral_link_authorization');
    let identityCookie = null;
    araIdCookies.setSession(
      { cookie: (name, value) => (identityCookie = `${name}=${encodeURIComponent(value)}`) },
      'referral-link-smoke-profile',
    );
    await request('POST', '/api/referral-links/araid/challenge/approve', 201, {
      headers: { cookie: `${identityCookie}; ${authorizationCookie}` },
      body: {},
    });
    const polled = await request('POST', '/api/referral-links/araid/challenge/status', 201, {
      headers: { 'x-referral-araid-challenge': challengeToken },
      body: {},
    });
    assert(polled.payload.data.status === 'APPROVED', 'AraID challenge was not approved');
    const session = { 'x-referral-session': polled.payload.data.sessionToken };
    // The session is for this link only; it is no staff login.
    await request('GET', `/api/cases/${caseId}`, 401, { headers: session });

    const full = await request('GET', linkPath(link.token), 200, { headers: session });
    const data = full.payload.data;
    assert(data.auth_required === false, 'verified link still asked for identity');
    assert(data.student_name === enrollment.student_name, 'verified link hid the student name');
    assert(data.reporter_name === REPORTER_NAME, `reporter is ${data.reporter_name}`);
    assert(Array.isArray(data.contact_channels), 'verified link has no contact channels');
    assert(Array.isArray(data.follow_up_history), 'verified link has no visit history');
    assert(data.referral.referral_note === 'ส่งต่อพบนักจิตวิทยา', 'referral reason is missing');
    assert(!('student_uuid' in data) && !('identity_number' in data), 'link leaked an identifier');
    console.log('ok code + AraID open the same student view as the home-visit link');

    // 6. One report, never from the future, then the link is spent.
    const tomorrow = new Date(Date.now() + 36 * 3600_000).toISOString().slice(0, 10);
    await request('POST', `${linkPath(link.token)}/report`, 400, {
      headers: session,
      body: { ...report, action_date: tomorrow },
    });
    await request('POST', `${linkPath(link.token)}/report`, 400, {
      headers: session,
      body: { ...report, action_date: '2026-02-31' },
    });
    await request('POST', `${linkPath(link.token)}/report`, 200, {
      headers: session,
      body: report,
    });
    assert(
      (await caseStatus()) === 'PENDING_REVIEW',
      'agency report did not return the case to review',
    );
    const [stored] = await dataSource.query(
      `SELECT result.recorded_by_user_id, result.case_referral_link_id, result.action_date::text,
              result.reporter_identity_provider_code, result.reporter_provider_subject,
              result.reporter_name, referral.status_code, link.status_code AS link_status
       FROM case_referral_results result
       JOIN case_referrals referral ON referral.id = result.case_referral_id
       JOIN case_referral_links link ON link.id = result.case_referral_link_id
       WHERE result.case_referral_id = $1`,
      [referralId],
    );
    assert(
      stored &&
        stored.recorded_by_user_id === null &&
        stored.reporter_identity_provider_code === 'ARAID' &&
        stored.reporter_provider_subject === 'smoke-referral-araid-subject' &&
        stored.reporter_name === REPORTER_NAME &&
        stored.action_date === report.action_date &&
        stored.status_code === 'COMPLETED' &&
        stored.link_status === 'USED',
      `stored report is ${JSON.stringify(stored)}`,
    );
    // PostgreSQL CHECK must reject NULL as well as empty reporter fields.
    for (const [field, value] of [
      ['reporter_identity_provider_code', null],
      ['reporter_provider_subject', null],
      ['reporter_name', null],
      ['action_date', null],
      ['reporter_provider_subject', '   '],
      ['reporter_name', '   '],
    ]) {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let rejected = false;
      try {
        await runner.query(
          `UPDATE case_referral_results SET ${field} = $2
          WHERE case_referral_id = $1`,
          [referralId, value],
        );
      } catch (error) {
        rejected = error.code === '23514';
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
      assert(rejected, `reporter constraint accepted missing ${field}`);
    }
    console.log('ok reporter CHECK refuses NULL and blank identity fields');
    await request('POST', `${linkPath(link.token)}/report`, 409, {
      headers: session,
      body: report,
    });
    await request('GET', linkPath(link.token), 409, { headers: session });
    const detail = await caseService.getCase(caseId, director);
    const shown = detail.data.referrals.find((item) => item.id === referralId);
    assert(
      shown.result.reported_by_agency === true &&
        shown.result.reporter_name === REPORTER_NAME &&
        shown.result.reporter_identity_provider === 'AraID',
      `case page result is ${JSON.stringify(shown.result)}`,
    );
    assert(shown.link.status_code === 'USED' && shown.link.url === null, 'spent link is shareable');
    console.log('ok the agency report is filed once, with its reporter, and spends the link');

    // 8. Outside its window a link does not open; a link that ran out can be sent again.
    await decide('ส่งต่อมูลนิธิ');
    const early = await send('ส่งต่อมูลนิธิ', window(60, 60 * 24));
    await request('GET', linkPath(early.token), 403);
    await request('POST', cancelPath(early.referralId), 200, {
      headers: { cookie: directorCookie },
      body: { cancel_reason: 'ตั้งเวลาเริ่มผิด' },
    });
    const expired = await send('ส่งต่อมูลนิธิ');
    await dataSource.query(
      `UPDATE case_referral_links
       SET starts_at = now() - interval '2 days', expires_at = now() - interval '1 day'
       WHERE token_hash = encode(sha256($1::bytea), 'hex')`,
      [expired.token],
    );
    await request('GET', linkPath(expired.token), 410);
    await request('POST', `${linkPath(expired.token)}/araid/challenge`, 410, {
      body: { access_code: expired.code },
    });
    const sends = await Promise.all(
      [1, 2].map(() =>
        fetch(`${baseUrl}${sendPath}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: directorCookie },
          body: JSON.stringify(sendBody('ส่งต่อมูลนิธิอีกครั้ง')),
        }),
      ),
    );
    const sendStatuses = sends.map((response) => response.status).sort((a, b) => a - b);
    assert(
      JSON.stringify(sendStatuses) === JSON.stringify([201, 409]),
      `simultaneous replacement sends returned ${sendStatuses}`,
    );
    const sent = (await sends.find((response) => response.status === 201).json()).data;
    const raceRound = {
      token: sent.url.split('/referral-report/')[1],
      referralId: sent.referral_id,
    };
    console.log('ok simultaneous replacement sends issue exactly one new round');
    const expiredRow = await referralRow(expired.referralId);
    assert(
      expiredRow.status_code === 'CANCELLED' && expiredRow.cancel_reason?.includes('หมดอายุ'),
      `expired round did not close as ยกเลิก: ${JSON.stringify(expiredRow)}`,
    );
    console.log(
      'ok a link outside its window does not open; an expired round is replaced and closed',
    );

    // The report and the school's cancellation race for the same round.
    const [raceLink] = await dataSource.query(
      `SELECT id FROM case_referral_links WHERE case_referral_id = $1`,
      [raceRound.referralId],
    );
    const raceSession = await app
      .get(MagicSessionStoreService)
      .issue(`referral-link:${raceLink.id}`, {
        provider: 'ARAID',
        subject: 'smoke-referral-araid-subject',
        name: REPORTER_NAME,
      });
    const attempts = await Promise.all([
      fetch(`${baseUrl}${linkPath(raceRound.token)}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-referral-session': raceSession },
        body: JSON.stringify(report),
      }),
      fetch(`${baseUrl}${cancelPath(raceRound.referralId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: directorCookie },
        body: JSON.stringify({ cancel_reason: 'ทดสอบยกเลิกพร้อมรายงาน' }),
      }),
    ]);
    const statuses = attempts.map((response) => response.status).sort((a, b) => a - b);
    assert(
      statuses[0] === 200 && [409, 410].includes(statuses[1]),
      `report/cancel race returned ${statuses}`,
    );
    const [raceState] = await dataSource.query(
      `SELECT c.status AS case_status,
        r.status_code AS referral_status, l.status_code AS link_status,
        EXISTS (SELECT 1 FROM case_referral_results result WHERE result.case_referral_id = r.id) AS has_result
      FROM case_referrals r JOIN cases c ON c.id = r.case_id
      JOIN case_referral_links l ON l.case_referral_id = r.id WHERE r.id = $1`,
      [raceRound.referralId],
    );
    assert(
      raceState.has_result
        ? raceState.case_status === 'PENDING_REVIEW' && raceState.link_status === 'USED'
        : raceState.case_status === 'AWAITING_REFERRAL' &&
            raceState.referral_status === 'CANCELLED' &&
            raceState.link_status === 'REVOKED',
      'report/cancel race left mixed states',
    );
    console.log(
      'ok simultaneous report/cancel has one winner with consistent case/referral/link state',
    );
    console.log('Referral link smoke passed');
  } finally {
    if (caseId) {
      const referrals = `(SELECT id FROM case_referrals WHERE case_id = $1)`;
      for (const sql of [
        `DELETE FROM case_referral_results WHERE case_referral_id IN ${referrals}`,
        `DELETE FROM case_referral_links WHERE case_referral_id IN ${referrals}`,
        `DELETE FROM case_referrals WHERE case_id = $1`,
        `DELETE FROM notifications WHERE case_id = $1`,
        `DELETE FROM case_reviews WHERE case_id = $1`,
        `DELETE FROM cases WHERE id = $1`,
      ]) {
        await dataSource.query(sql, [caseId]).catch(() => undefined);
      }
    }
    for (const userId of userIds) {
      // audit_log is append-only, so a fixture with history is switched off.
      await dataSource
        .query(`DELETE FROM users WHERE id = $1`, [userId])
        .catch(() =>
          dataSource
            .query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [userId])
            .catch(() => undefined),
        );
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
