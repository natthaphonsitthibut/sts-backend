const { ValidationPipe } = require('@nestjs/common');
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');
const { randomUUID } = require('crypto');
const { AppModule } = require('../dist/app.module');
const { AraIdService } = require('../dist/araid/araid.service');
const {
  AraIdSessionCookieService,
} = require('../dist/araid/araid-session-cookie.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');
const { authConfig } = require('../dist/config/auth.config');
const {
  ClassroomLinkSessionStore,
} = require('../dist/classroom-attendance-links/classroom-link-session.store');
const {
  GoogleOidcProvider,
} = require('../dist/classroom-attendance-links/google-oidc.provider');
const {
  CLASSROOM_LINK_SESSION_COOKIE,
  CLASSROOM_LINK_TOKEN_HEADER,
} = require('../dist/classroom-attendance-links/classroom-attendance-links.constants');
const { MESSAGING_PROVIDER } = require('../dist/common/messaging/messaging.types');
const { RiskProfileService } = require('../dist/risk-profile/risk-profile.service');

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

// `::date` comes back from pg as a Date object; the API takes YYYY-MM-DD, and
// toISOString() would shift the day backwards in Asia/Bangkok.
function asDateKey(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  let capturedGoogle = null;
  let googleIdentity = null;
  let araIdIdentity = null;
  let messagingEnabled = true;
  let messagingDelivered = true;
  const outboundMessages = [];
  const messagingProvider = {
    isEnabled: () => messagingEnabled,
    buildAuthorizationUrl: () => '',
    buildAddContactUrl: () => '',
    completeAuthorization: async () => { throw new Error('not used'); },
    readFriendState: async () => 'FRIEND',
    sendMessages: async (messages, idempotencyKeyPrefix) => {
      outboundMessages.push({ messages, idempotencyKeyPrefix });
      return messages.map((message) => ({
        providerUserId: message.providerUserId,
        delivered: messagingDelivered,
      }));
    },
    verifyWebhookSignature: () => false,
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleOidcProvider)
    .useValue({
      authorizationUrl: (state, nonce) => {
        capturedGoogle = { state, nonce };
        const url = new URL('https://accounts.example/authorize');
        url.searchParams.set('state', state);
        url.searchParams.set('nonce', nonce);
        return url.toString();
      },
      exchange: async (_code, expectedNonce) => {
        assert(capturedGoogle?.nonce === expectedNonce, 'Google nonce was not bound to callback');
        assert(googleIdentity, 'Google identity fixture was not initialized');
        return googleIdentity;
      },
    })
    .overrideProvider(AraIdService)
    .useValue({
      getVerifiedIdentityClaim: async () => {
        assert(araIdIdentity, 'AraID identity fixture was not initialized');
        return araIdIdentity;
      },
    })
    .overrideProvider(MESSAGING_PROVIDER)
    .useValue(messagingProvider)
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

  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dataSource = app.get(DataSource);
  const jwt = app.get(JwtService);
  const runtimeAuth = app.get(authConfig.KEY);
  const sessionStore = app.get(ClassroomLinkSessionStore);
  const araIdCookies = app.get(AraIdSessionCookieService);
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const usernames = {
    allowed: 'classroom_link_allowed_fixture',
    scoped: 'classroom_link_scoped_fixture',
    denied: 'classroom_link_denied_fixture',
  };
  const userIds = [];
  let linkId = null;
  let attendanceSessionId = null;
  let messagingAccountId = null;
  let originalHomeroom = null;
  let scope = null;

  const cookieFor = (userId) => {
    const token = jwt.sign({ sub: userId });
    return `${runtimeAuth.cookieName}=${encodeURIComponent(token)}`;
  };
  const request = async (method, path, expectedStatus, options = {}) => {
    const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
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
      `${method} ${path}: expected ${expectedStatus}, received ${response.status}`,
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
    [scope] = await dataSource.query(`
      SELECT classroom.id::int AS classroom_id, classroom.school_id,
             classroom.school_term_id::int,
             available.check_in_date,
             offering.id::int AS classroom_subject_id,
             membership.id::int AS teacher_membership_id,
             membership.teacher_id::int, lower(btrim(teacher.email)) AS teacher_email,
             teacher.citizen_id
      FROM school_classrooms classroom
      JOIN school_terms term
        ON term.id = classroom.school_term_id
       AND term.school_id = classroom.school_id
       AND term.status = 'ACTIVE'
       AND term.deleted_at IS NULL
      JOIN school_teacher_memberships membership
        ON membership.school_id = classroom.school_id
       AND membership.membership_status = 'ACTIVE'
       AND membership.deleted_at IS NULL
      JOIN teachers teacher
        ON teacher.id = membership.teacher_id
       AND teacher.teacher_status = 'ACTIVE'
       AND teacher.deleted_at IS NULL
      JOIN classroom_subjects offering
        ON offering.classroom_id = classroom.id
       AND offering.school_id = classroom.school_id
       AND offering.offering_status = 'ACTIVE'
       AND offering.deleted_at IS NULL
      JOIN school_subjects school_subject
        ON school_subject.id = offering.school_subject_id
       AND school_subject.school_id = offering.school_id
       AND school_subject.subject_status = 'ACTIVE'
       AND school_subject.deleted_at IS NULL
      JOIN subjects homeroom_subject
        ON homeroom_subject.id = school_subject.subject_id
       AND homeroom_subject.code = 'HOMEROOM101'
       AND homeroom_subject.is_active
       AND homeroom_subject.deleted_at IS NULL
      JOIN LATERAL (
        SELECT candidate.check_in_date::date AS check_in_date
        FROM generate_series(
          term.starts_on,
          LEAST(term.ends_on, (now() AT TIME ZONE 'Asia/Bangkok')::date),
          INTERVAL '1 day'
        ) AS candidate(check_in_date)
        WHERE term.starts_on <= (now() AT TIME ZONE 'Asia/Bangkok')::date
          AND NOT EXISTS (
            SELECT 1 FROM attendance_sessions existing
            WHERE existing.school_term_id = classroom.school_term_id
              AND existing.classroom_id = classroom.id
              AND existing.classroom_subject_id = offering.id
              AND existing.attendance_date = candidate.check_in_date::date
              AND existing.record_storage_mode = 'EXCEPTIONS'
              AND existing.deleted_at IS NULL
          )
        ORDER BY candidate.check_in_date DESC
        LIMIT 1
      ) available ON TRUE
      WHERE classroom.classroom_status = 'ACTIVE'
        AND classroom.deleted_at IS NULL
        AND teacher.email IS NOT NULL
        AND teacher.citizen_id ~ '^[0-9]{13}$'
        AND (
          SELECT count(*)
          FROM student_term enrollment
          JOIN student_current_enrollment_resolution resolution
            ON resolution.person_uuid = enrollment.person_uuid
           AND resolution.selected_student_uuid = enrollment.student_uuid
           AND resolution.resolution_state = 'ACTIVE'
          WHERE enrollment.classroom_id = classroom.id
            AND enrollment.deleted_at IS NULL
        ) >= 2
        AND NOT EXISTS (
          SELECT 1 FROM teacher_messaging_accounts account
          WHERE account.teacher_id = teacher.id
            AND account.provider = 'LINE'
            AND account.unlinked_at IS NULL
            AND account.deleted_at IS NULL
        )
      ORDER BY available.check_in_date DESC, classroom.id, membership.id
      LIMIT 1
    `);
    assert(scope, 'No active classroom and same-school teacher membership are available');
    const [otherMembership] = await dataSource.query(
      `SELECT membership.id::int, membership.teacher_id::int,
              lower(btrim(teacher.email)) AS teacher_email
       FROM school_teacher_memberships membership
       JOIN teachers teacher ON teacher.id = membership.teacher_id
       WHERE membership.school_id <> $1
         AND membership.membership_status = 'ACTIVE'
         AND membership.deleted_at IS NULL
         AND teacher.teacher_status = 'ACTIVE'
         AND teacher.deleted_at IS NULL
         AND teacher.email IS NOT NULL
       LIMIT 1`,
      [scope.school_id],
    );
    assert(otherMembership, 'No wrong-school teacher membership is available');
    googleIdentity = {
      subject: `google-classroom-${suffix}`,
      email: scope.teacher_email,
    };
    araIdIdentity = {
      providerSubject: `araid-classroom-${suffix}`,
      identityNumber: scope.citizen_id,
    };

    for (const [key, role, permissions, dataScope] of [
      ['allowed', 'ADMIN', ['manage-classroom-links'], { school_ids: [scope.school_id] }],
      ['scoped', 'ADMIN', ['manage-classroom-links'], { school_ids: [-1] }],
      ['denied', 'EXECUTIVE', ['home'], { school_ids: [scope.school_id] }],
    ]) {
      const [user] = await dataSource.query(
        `INSERT INTO users (
           username, password, status, permissions, "FirstName", "LastName",
           role, data_scope, data_origin_code
         ) VALUES ($1, 'NOT_A_LOGIN_CREDENTIAL', 'ACTIVE', $2::jsonb,
           'ผู้ใช้งาน', 'ระบบอัตโนมัติ', $3, $4::jsonb, 'AUTOMATED_TEST')
         ON CONFLICT (username) DO UPDATE SET
           status = 'ACTIVE', permissions = EXCLUDED.permissions,
           role = EXCLUDED.role, data_scope = EXCLUDED.data_scope,
           data_origin_code = 'AUTOMATED_TEST'
         RETURNING id`,
        [usernames[key], JSON.stringify(permissions), role, JSON.stringify(dataScope)],
      );
      userIds.push(Number(user.id));
    }
    const [allowedId, scopedId, deniedId] = userIds;

    await request('GET', '/api/teacher-access-grants', 404, {
      headers: { cookie: cookieFor(allowedId) },
    });
    await request('GET', '/api/teacher-access/context', 404);

    [originalHomeroom] = await dataSource.query(
      `SELECT classroom_id, school_id, teacher_membership_id, created_at, created_by,
              updated_at, updated_by
       FROM classroom_homeroom_teachers WHERE classroom_id = $1`,
      [scope.classroom_id],
    );
    await dataSource.query(
      `INSERT INTO classroom_homeroom_teachers (
         classroom_id, school_id, teacher_membership_id, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (classroom_id) DO UPDATE
       SET school_id = EXCLUDED.school_id,
           teacher_membership_id = EXCLUDED.teacher_membership_id,
           updated_by = EXCLUDED.updated_by`,
      [scope.classroom_id, scope.school_id, scope.teacher_membership_id, allowedId],
    );
    [messagingAccountId] = await dataSource.query(
      `INSERT INTO teacher_messaging_accounts (
         teacher_id, provider, provider_channel_id, provider_user_id,
         display_name, friend_state, friend_checked_at, verified_at, verified_via,
         created_by, updated_by
       ) VALUES ($1, 'LINE', $2, $3, NULL, 'FRIEND', now(), now(), 'ARAID', $4, $4)
       RETURNING id`,
      [scope.teacher_id, `smoke-channel-${suffix}`, `smoke-user-${suffix}`, allowedId],
    );

    await request(
      'POST',
      '/api/classroom-attendance-links/bulk',
      403,
      {
        headers: { cookie: cookieFor(deniedId) },
        body: {
          schoolId: scope.school_id,
          schoolTermId: scope.school_term_id,
          classroomIds: [scope.classroom_id],
        },
      },
    );
    await request(
      'POST',
      '/api/classroom-attendance-links/bulk',
      404,
      {
        headers: { cookie: cookieFor(scopedId) },
        body: {
          schoolId: scope.school_id,
          schoolTermId: scope.school_term_id,
          classroomIds: [scope.classroom_id],
        },
      },
    );

    const created = await request('POST', '/api/classroom-attendance-links/bulk', 201, {
      headers: { cookie: cookieFor(allowedId) },
      body: {
        schoolId: scope.school_id,
        schoolTermId: scope.school_term_id,
        classroomIds: [scope.classroom_id],
      },
    });
    linkId = created.payload.data[0].id;
    assert(
      created.payload.data[0].lineDelivery.status === 'SENT',
      `Bulk create did not deliver to the current homeroom teacher after commit: ${JSON.stringify(created.payload.data[0].lineDelivery)}`,
    );
    assert(outboundMessages.length === 1, 'Bulk create did not call the messaging provider once');
    const firstUrl = new URL(created.payload.data[0].accessUrl);
    const firstToken = new URLSearchParams(firstUrl.hash.slice(1)).get('token');
    assert(firstToken && /^[0-9a-f]{64}$/.test(firstToken), 'Bulk create did not return a valid fragment token');

    const listed = await request(
      'GET',
      `/api/classroom-attendance-links?schoolId=${scope.school_id}&schoolTermId=${scope.school_term_id}&linkStatus=ACTIVE&limit=100`,
      200,
      { headers: { cookie: cookieFor(allowedId) } },
    );
    assert(listed.payload.data.some((row) => row.id === linkId), 'Scoped list omitted the created link');
    const allRooms = await request(
      'GET',
      `/api/classroom-attendance-links?schoolId=${scope.school_id}&schoolTermId=${scope.school_term_id}&limit=100`,
      200,
      { headers: { cookie: cookieFor(allowedId) } },
    );
    const [roomCount] = await dataSource.query(
      `SELECT count(*)::int AS count
       FROM school_classrooms
       WHERE school_id = $1 AND school_term_id = $2 AND deleted_at IS NULL`,
      [scope.school_id, scope.school_term_id],
    );
    assert(
      allRooms.payload.meta.total === roomCount.count,
      'Scoped list was not one paginated row per classroom',
    );

    messagingDelivered = false;
    const failedRequestId = randomUUID();
    const failedDelivery = await request(
      'POST',
      `/api/classroom-attendance-links/${linkId}/resend-line`,
      201,
      {
        headers: { cookie: cookieFor(allowedId) },
        body: { deliveryRequestId: failedRequestId },
      },
    );
    assert(
      failedDelivery.payload.data.lineDelivery.status === 'FAILED',
      'Provider failure was not persisted without rolling back the link',
    );

    messagingDelivered = true;
    const retryRequestId = randomUUID();
    const beforeRetry = outboundMessages.length;
    await request('POST', `/api/classroom-attendance-links/${linkId}/resend-line`, 201, {
      headers: { cookie: cookieFor(allowedId) },
      body: { deliveryRequestId: retryRequestId },
    });
    await request('POST', `/api/classroom-attendance-links/${linkId}/resend-line`, 201, {
      headers: { cookie: cookieFor(allowedId) },
      body: { deliveryRequestId: retryRequestId },
    });
    assert(
      outboundMessages.length === beforeRetry + 1,
      'A completed delivery request was sent more than once',
    );

    messagingEnabled = false;
    const notReady = await request(
      'POST',
      `/api/classroom-attendance-links/${linkId}/resend-line`,
      201,
      {
        headers: { cookie: cookieFor(allowedId) },
        body: { deliveryRequestId: randomUUID() },
      },
    );
    assert(
      notReady.payload.data.lineDelivery.failureCode === 'MESSAGING_DISABLED',
      'Disabled messaging did not produce an explicit not-ready state',
    );
    messagingEnabled = true;

    const anonymous = await request('GET', '/api/classroom/context', 200, {
      headers: { [CLASSROOM_LINK_TOKEN_HEADER]: firstToken },
    });
    assert(anonymous.payload.data.authentication.status === 'REQUIRED', 'Anonymous context was not auth-required');

    // Links handed out before the rename hit /api/check-in, and the Google
    // redirect URI registered in the console still points there until it is
    // updated, so the old namespace has to keep answering.
    const legacyNamespace = await request('GET', '/api/check-in/context', 200, {
      headers: { [CLASSROOM_LINK_TOKEN_HEADER]: firstToken },
    });
    assert(
      legacyNamespace.payload.data.authentication.status === 'REQUIRED',
      'Legacy /api/check-in namespace stopped answering',
    );

    capturedGoogle = null;
    const googleStart = await request('GET', '/api/classroom/auth/google/start', 200, {
      headers: { [CLASSROOM_LINK_TOKEN_HEADER]: firstToken },
    });
    assert(capturedGoogle?.state, 'Google start did not create server-side state');
    assert(
      new URL(googleStart.payload.data.authorizationUrl).searchParams.get('state') ===
        capturedGoogle.state,
      'Google authorization URL did not carry the issued state',
    );
    const googleCallback = await request(
      'GET',
      `/api/classroom/auth/google/callback?code=verified&state=${encodeURIComponent(capturedGoogle.state)}`,
      302,
    );
    const googleCookie = responseCookie(googleCallback.response, CLASSROOM_LINK_SESSION_COOKIE);
    const googleContext = await request('GET', '/api/classroom/context', 200, {
      headers: { cookie: googleCookie },
    });
    assert(
      googleContext.payload.data.authentication.provider === 'GOOGLE',
      'Google callback did not issue a link-bound teacher session',
    );
    await request(
      'GET',
      `/api/classroom/auth/google/callback?code=replay&state=${encodeURIComponent(capturedGoogle.state)}`,
      410,
    );

    const araIdChallenge = await request('POST', '/api/classroom/auth/araid/challenge', 201, {
      headers: { [CLASSROOM_LINK_TOKEN_HEADER]: firstToken },
      body: {},
    });
    const challengeToken = araIdChallenge.payload.data.challengeToken;
    // The QR sends a phone to this URL; the authorize page reads the challenge
    // and the scope out of the hash, so both keys are part of the contract.
    const verificationHash = new URLSearchParams(
      new URL(araIdChallenge.payload.data.verificationUrl).hash.slice(1),
    );
    assert(
      verificationHash.get('challenge') === challengeToken &&
        verificationHash.get('scope') === 'classroom-check-in',
      `AraID verification url did not carry challenge+scope: ${araIdChallenge.payload.data.verificationUrl}`,
    );
    const araIdBegin = await request('POST', '/api/classroom/auth/araid/challenge/begin', 201, {
      headers: { 'x-araid-challenge': challengeToken },
      body: {},
    });
    const authorizationCookie = responseCookie(
      araIdBegin.response,
      'araid_classroom_check_in_authorization',
    );
    let identityCookie = null;
    araIdCookies.setSession(
      {
        cookie: (name, value) => {
          identityCookie = `${name}=${encodeURIComponent(value)}`;
        },
      },
      'classroom-link-araid-profile',
    );
    assert(identityCookie, 'AraID identity cookie was not created');
    await request('POST', '/api/classroom/auth/araid/challenge/approve', 201, {
      headers: { cookie: `${identityCookie}; ${authorizationCookie}` },
      body: {},
    });
    const araIdPoll = await request('POST', '/api/classroom/auth/araid/challenge/status', 201, {
      headers: { 'x-araid-challenge': challengeToken },
      body: {},
    });
    const araIdClassroomCookie = responseCookie(
      araIdPoll.response,
      CLASSROOM_LINK_SESSION_COOKIE,
    );
    const araIdContext = await request('GET', '/api/classroom/context', 200, {
      headers: { cookie: araIdClassroomCookie },
    });
    assert(
      araIdContext.payload.data.authentication.provider === 'THAID',
      'AraID approval did not issue a link-bound teacher session',
    );

    const [linkRow] = await dataSource.query(
      `SELECT token_hash FROM classroom_attendance_links WHERE id = $1`,
      [linkId],
    );
    const sameSchoolSession = await sessionStore.issue({
      linkId,
      tokenHash: linkRow.token_hash,
      teacherId: String(scope.teacher_id),
      teacherMembershipId: String(scope.teacher_membership_id),
      schoolId: scope.school_id,
      provider: 'GOOGLE',
    });
    const authenticated = await request('GET', '/api/classroom/context', 200, {
      headers: { cookie: `${CLASSROOM_LINK_SESSION_COOKIE}=${encodeURIComponent(sameSchoolSession)}` },
    });
    assert(authenticated.payload.data.authentication.status === 'AUTHENTICATED', 'Same-school teacher session was denied');

    const checkInCookie = `${CLASSROOM_LINK_SESSION_COOKIE}=${encodeURIComponent(sameSchoolSession)}`;
    const options = await request(
      'GET',
      `/api/classroom/subjects?date=${encodeURIComponent(asDateKey(scope.check_in_date))}`,
      200,
      { headers: { cookie: checkInCookie } },
    );
    assert(
      options.response.headers.get('cache-control')?.includes('no-store'),
      'Check-in options were cacheable',
    );
    assert(
      options.payload.data.classroom.id === scope.classroom_id &&
        options.payload.data.subjects.some(
          (subject) => subject.classroomSubjectId === scope.classroom_subject_id,
        ),
      'Public options escaped the link classroom or omitted HOMEROOM',
    );
    const roster = await request('GET', '/api/classroom/roster', 200, {
      headers: { cookie: checkInCookie },
    });
    assert(roster.payload.data.length >= 2, 'Check-in roster fixture needs at least two students');
    assert(
      roster.payload.data.every(
        (student) => !('nationalId' in student) && !('citizenId' in student) && !('PersonID_Onec' in student),
      ),
      'Check-in roster leaked a national identity field',
    );
    // The avatar on the roster opens the student's profile, so the link serves
    // the same profile reads the staff screens use — bounded by its classroom.
    const rosterStudentId = roster.payload.data[0].id;
    const profile = await request('GET', `/api/classroom/students/${rosterStudentId}`, 200, {
      headers: { cookie: checkInCookie },
    });
    assert(
      profile.payload?.data?.student_uuid === rosterStudentId ||
        profile.payload?.student_uuid === rosterStudentId ||
        profile.payload?.data?.id === rosterStudentId ||
        profile.payload?.id === rosterStudentId,
      `Classroom link profile returned the wrong student: ${JSON.stringify(profile.payload).slice(0, 300)}`,
    );
    const profileBody = JSON.stringify(profile.payload);
    assert(
      !/\b\d{13}\b/.test(profileBody),
      'Classroom link profile returned an unmasked national id',
    );
    await request('GET', `/api/classroom/students/${rosterStudentId}/profile-summary`, 200, {
      headers: { cookie: checkInCookie },
    });
    await request('GET', `/api/classroom/students/${rosterStudentId}/cases`, 200, {
      headers: { cookie: checkInCookie },
    });
    await request('GET', `/api/classroom/students/${rosterStudentId}/attendance`, 200, {
      headers: { cookie: checkInCookie },
    });
    // Asking to see a masked field is allowed through a link, and the access log
    // has to name the teacher who asked — a link teacher has no user row, so the
    // row carries their school membership and the link instead.
    const revealed = await request(
      'POST',
      `/api/classroom/students/${rosterStudentId}/pii-reveal`,
      201,
      {
        headers: { cookie: checkInCookie },
        body: { field_group: 'NATIONAL_ID', reason_code: 'CONTACT_PARENT' },
      },
    );
    assert(
      typeof revealed.payload?.values?.PersonID_Onec === 'string' ||
        revealed.payload?.values?.PersonID_Onec === null,
      `Reveal through the classroom link returned no value: ${JSON.stringify(revealed.payload).slice(0, 200)}`,
    );
    const [revealEvent] = await dataSource.query(
      `SELECT actor_user_id, actor_teacher_membership_id, actor_kind, purpose_link_id,
              field_group, reason_code
       FROM pii_access_events
       WHERE subject_type = 'STUDENT'
         AND created_at > now() - interval '2 minutes'
       ORDER BY id DESC
       LIMIT 1`,
    );
    assert(
      revealEvent &&
        revealEvent.actor_user_id === null &&
        Number(revealEvent.actor_teacher_membership_id) === Number(scope.teacher_membership_id) &&
        revealEvent.field_group === 'NATIONAL_ID' &&
        revealEvent.purpose_link_id,
      `Reveal through the link was not logged against the teacher: ${JSON.stringify(revealEvent)}`,
    );

    // The roster tab writes a teacher comment through the link. The comment is
    // the staff one — same catalogs, same table — with the link's teacher as its
    // author, since a link holds no account.
    const commentOptions = await request(
      'GET',
      '/api/classroom/students/comment-options',
      200,
      { headers: { cookie: checkInCookie } },
    );
    assert(
      commentOptions.payload?.data?.problemCategories?.length > 0 &&
        commentOptions.payload?.data?.concernLevels?.length > 0,
      'Classroom link comment options were empty',
    );
    const commentCategory = commentOptions.payload.data.problemCategories[0].code;
    await request('POST', `/api/classroom/students/${rosterStudentId}/comments`, 201, {
      headers: { cookie: checkInCookie },
      body: {
        problemCategory: commentCategory,
        concernLevelCode: 'NOTE',
        problemDescription: 'สังเกตจากลิงก์ห้องเรียน',
      },
    });
    const [writtenComment] = await dataSource.query(
      `SELECT comment.authored_by_user_id, comment.authored_by_teacher_id::text AS authored_by_teacher_id
       FROM classroom_student_comments comment
       JOIN student_term enrollment ON enrollment.person_uuid = comment.person_uuid
       WHERE enrollment.student_uuid = $1
       ORDER BY comment.id DESC
       LIMIT 1`,
      [rosterStudentId],
    );
    assert(
      writtenComment &&
        writtenComment.authored_by_user_id === null &&
        String(writtenComment.authored_by_teacher_id) === String(scope.teacher_id),
      `Link comment was not filed under the link teacher: ${JSON.stringify(writtenComment)}`,
    );
    const listedComments = await request(
      'GET',
      `/api/classroom/students/${rosterStudentId}/comments`,
      200,
      { headers: { cookie: checkInCookie } },
    );
    assert(
      listedComments.payload?.data?.some(
        (row) => row.problemDescription === 'สังเกตจากลิงก์ห้องเรียน',
      ),
      'Link comment did not come back on the link comment list',
    );
    await request('GET', `/api/classroom/students/${rosterStudentId}/comments`, 401);

    // The header photo is served like every other photo: through the API, and
    // only to the teacher the session signed in as.
    await request('GET', '/api/classroom/my-photo', 401);

    // Opening a case works from the link too, and the case names the teacher who
    // opened it — the reason the owner allowed it at all.
    const openedCase = await request(
      'POST',
      `/api/classroom/students/${rosterStudentId}/cases`,
      201,
      {
        headers: { cookie: checkInCookie },
        body: { reason: 'ขาดเรียนติดต่อกันหลายวัน' },
      },
    );
    assert(
      openedCase.payload?.data?.id,
      `Opening a case through the link returned no case: ${JSON.stringify(openedCase.payload).slice(0, 200)}`,
    );
    const [caseRow] = await dataSource.query(
      `SELECT created_by, created_by_teacher_id::text AS created_by_teacher_id, school_id
       FROM cases WHERE id = $1`,
      [openedCase.payload.data.id],
    );
    assert(
      caseRow &&
        caseRow.created_by === null &&
        String(caseRow.created_by_teacher_id) === String(scope.teacher_id),
      `Case opened from the link was not filed under the link teacher: ${JSON.stringify(caseRow)}`,
    );
    await request('POST', `/api/classroom/students/${rosterStudentId}/cases`, 401, {
      body: { reason: 'ไม่มี session' },
    });

    // A student from another classroom is invisible even with a valid session,
    // and no session at all cannot read a profile at all.
    // Same school, different classroom — otherwise the school in the read scope
    // could be what rejects them and the roster check would never be exercised.
    const [outsider] = await dataSource.query(
      `SELECT enrollment.student_uuid::text AS id
       FROM student_term enrollment
       WHERE enrollment.classroom_id <> $1
         AND enrollment."SchoolID_Onec" = $2
         AND enrollment.deleted_at IS NULL
       ORDER BY enrollment.student_uuid
       LIMIT 1`,
      [scope.classroom_id, scope.school_id],
    );
    assert(
      outsider,
      'need a student in the same school but another classroom to prove the boundary',
    );
    await request('GET', `/api/classroom/students/${outsider.id}`, 404, {
      headers: { cookie: checkInCookie },
    });
    await request('POST', `/api/classroom/students/${outsider.id}/cases`, 404, {
      headers: { cookie: checkInCookie },
      body: { reason: 'ห้ามเปิดข้ามห้อง' },
    });
    await request('POST', `/api/classroom/students/${outsider.id}/comments`, 404, {
      headers: { cookie: checkInCookie },
      body: {
        problemCategory: commentCategory,
        concernLevelCode: 'NOTE',
        problemDescription: 'ห้ามคอมเมนต์ข้ามห้อง',
      },
    });
    await request('GET', `/api/classroom/students/${rosterStudentId}`, 401);

    await request('POST', '/api/classroom/sessions/start', 400, {
      headers: { cookie: checkInCookie },
      body: {
        date: asDateKey(scope.check_in_date),
        classroomSubjectId: scope.classroom_subject_id,
        classroomId: -1,
      },
    });
    await request(
      'GET',
      `/api/attendance/check-in/options?classroomId=${scope.classroom_id}&date=${encodeURIComponent(asDateKey(scope.check_in_date))}`,
      403,
      { headers: { cookie: cookieFor(allowedId) } },
    );

    const startBody = {
      date: asDateKey(scope.check_in_date),
      classroomSubjectId: scope.classroom_subject_id,
    };
    const started = await request('POST', '/api/classroom/sessions/start', 201, {
      headers: { cookie: checkInCookie },
      body: startBody,
    });
    attendanceSessionId = started.payload.data.id;
    assert(
      started.payload.data.storageMode === 'EXCEPTIONS' &&
        started.payload.data.status === 'OPEN' &&
        started.payload.data.recordedCount === 0 &&
        started.payload.data.expectedRosterCount === roster.payload.data.length,
      'First interaction did not create one OPEN exception-only roster snapshot',
    );
    const repeatedStart = await request('POST', '/api/classroom/sessions/start', 201, {
      headers: { cookie: checkInCookie },
      body: startBody,
    });
    assert(
      repeatedStart.payload.data.id === attendanceSessionId &&
        repeatedStart.payload.data.idempotent === true &&
        repeatedStart.payload.data.checkingStartedAt === started.payload.data.checkingStartedAt,
      'Repeated start changed the session identity or first-interaction time',
    );
    const [openStorage] = await dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM attendance_exceptions WHERE session_id = $1) AS exception_count,
         (SELECT count(*)::int FROM attendance_session_roster WHERE session_id = $1) AS roster_count`,
      [attendanceSessionId],
    );
    assert(
      openStorage.exception_count === 0 &&
        openStorage.roster_count === roster.payload.data.length,
      'OPEN session stored exception rows or failed to freeze the roster',
    );

    const exceptions = [
      { studentId: roster.payload.data[0].id, status: 'P_ABSENT' },
      { studentId: roster.payload.data[1].id, status: 'P_LATE' },
    ];
    const submitted = await request(
      'POST',
      `/api/classroom/sessions/${attendanceSessionId}/submit`,
      201,
      { headers: { cookie: checkInCookie }, body: { exceptions } },
    );
    assert(
      submitted.payload.data.status === 'SUBMITTED' &&
        submitted.payload.data.recordedCount === roster.payload.data.length &&
        submitted.payload.data.exceptionCount === exceptions.length,
      `Submit did not finalize the frozen roster with exception-only counts: ${JSON.stringify({
        status: submitted.payload.data.status,
        recordedCount: submitted.payload.data.recordedCount,
        expectedRosterCount: submitted.payload.data.expectedRosterCount,
        exceptionCount: submitted.payload.data.exceptionCount,
        rosterCount: roster.payload.data.length,
      })}`,
    );
    const [submittedStorage] = await dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM attendance_exceptions WHERE session_id = $1) AS exception_count,
         (SELECT count(*)::int
            FROM attendance_day day
            JOIN attendance_session_roster roster ON roster.student_uuid = day.student_uuid
           WHERE roster.session_id = $1 AND day."AttendanceDate" = $2::date) AS logical_roster_count`,
      [attendanceSessionId, scope.check_in_date],
    );
    assert(
      submittedStorage.exception_count === exceptions.length &&
        submittedStorage.logical_roster_count === roster.payload.data.length,
      'Submitted session stored the wrong exception count or failed logical attendance compatibility',
    );
    const duplicateSubmit = await request(
      'POST',
      `/api/classroom/sessions/${attendanceSessionId}/submit`,
      201,
      { headers: { cookie: checkInCookie }, body: { exceptions } },
    );
    assert(duplicateSubmit.payload.data.idempotent === true, 'Identical duplicate submit was not idempotent');
    await request(
      'POST',
      `/api/classroom/sessions/${attendanceSessionId}/submit`,
      409,
      { headers: { cookie: checkInCookie }, body: { exceptions: exceptions.slice(0, 1) } },
    );

    const wrongSchoolSession = await sessionStore.issue({
      linkId,
      tokenHash: linkRow.token_hash,
      teacherId: String(otherMembership.teacher_id),
      teacherMembershipId: String(otherMembership.id),
      schoolId: scope.school_id,
      provider: 'GOOGLE',
    });
    await request('GET', '/api/classroom/context', 403, {
      headers: { cookie: `${CLASSROOM_LINK_SESSION_COOKIE}=${encodeURIComponent(wrongSchoolSession)}` },
    });

    await dataSource.query(`UPDATE teachers SET teacher_status = 'INACTIVE' WHERE id = $1`, [
      scope.teacher_id,
    ]);
    await request('GET', '/api/classroom/context', 403, {
      headers: {
        [CLASSROOM_LINK_TOKEN_HEADER]: firstToken,
        cookie: `${CLASSROOM_LINK_SESSION_COOKIE}=${encodeURIComponent(sameSchoolSession)}`,
      },
    });
    await dataSource.query(`UPDATE teachers SET teacher_status = 'ACTIVE' WHERE id = $1`, [
      scope.teacher_id,
    ]);

    const rotated = await request(
      'POST',
      `/api/classroom-attendance-links/${linkId}/rotate`,
      201,
      { headers: { cookie: cookieFor(allowedId) }, body: {} },
    );
    const rotatedUrl = new URL(rotated.payload.data.accessUrl);
    const rotatedToken = new URLSearchParams(rotatedUrl.hash.slice(1)).get('token');
    assert(rotatedToken && rotatedToken !== firstToken, 'Rotate did not replace the token');
    await request('GET', '/api/classroom/context', 410, {
      headers: { [CLASSROOM_LINK_TOKEN_HEADER]: firstToken },
    });
    const rotatedAnonymous = await request('GET', '/api/classroom/context', 200, {
      headers: {
        [CLASSROOM_LINK_TOKEN_HEADER]: rotatedToken,
        cookie: `${CLASSROOM_LINK_SESSION_COOKIE}=${encodeURIComponent(sameSchoolSession)}`,
      },
    });
    assert(
      rotatedAnonymous.payload.data.authentication.status === 'REQUIRED',
      'A stale session was reused for a newly rotated raw token',
    );
    await request('GET', '/api/classroom/context', 200, {
      headers: { [CLASSROOM_LINK_TOKEN_HEADER]: rotatedToken },
    });

    await request(
      'POST',
      `/api/classroom-attendance-links/${linkId}/deactivate`,
      201,
      { headers: { cookie: cookieFor(allowedId) }, body: {} },
    );
    await request('GET', '/api/classroom/context', 410, {
      headers: { [CLASSROOM_LINK_TOKEN_HEADER]: rotatedToken },
    });

    console.error('[smoke] classroom attendance link API allowed/denied/rotate/session states passed');
  } finally {
    try {
      if (attendanceSessionId) {
        await dataSource.query(`DELETE FROM attendance_exceptions WHERE session_id = $1`, [attendanceSessionId]);
        await dataSource.query(`DELETE FROM attendance_session_roster WHERE session_id = $1`, [attendanceSessionId]);
        await dataSource.query(`DELETE FROM attendance_sessions WHERE id = $1`, [attendanceSessionId]);
      }
      if (linkId) {
        await dataSource.query(`DELETE FROM classroom_attendance_links WHERE id = $1`, [linkId]);
      }
      if (messagingAccountId) {
        await dataSource.query(`DELETE FROM teacher_messaging_accounts WHERE id = $1`, [messagingAccountId.id]);
      }
      if (originalHomeroom) {
        await dataSource.query(
          `INSERT INTO classroom_homeroom_teachers (
             classroom_id, school_id, teacher_membership_id, created_at, created_by, updated_at, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (classroom_id) DO UPDATE
           SET school_id = EXCLUDED.school_id,
               teacher_membership_id = EXCLUDED.teacher_membership_id,
               created_at = EXCLUDED.created_at,
               created_by = EXCLUDED.created_by,
               updated_at = EXCLUDED.updated_at,
               updated_by = EXCLUDED.updated_by`,
          [
            originalHomeroom.classroom_id,
            originalHomeroom.school_id,
            originalHomeroom.teacher_membership_id,
            originalHomeroom.created_at,
            originalHomeroom.created_by,
            originalHomeroom.updated_at,
            originalHomeroom.updated_by,
          ],
        );
      } else if (scope) {
        await dataSource.query(`DELETE FROM classroom_homeroom_teachers WHERE classroom_id = $1`, [scope.classroom_id]);
      }
      await dataSource.query(
        `DELETE FROM teacher_external_identities
         WHERE provider_subject = ANY($1::text[])`,
        [[`google-classroom-${suffix}`, `araid-classroom-${suffix}`]],
      );
      if (userIds.length > 0) {
        await dataSource.query(
          `UPDATE users
           SET status = 'DISABLED', permissions = '[]'::jsonb,
               data_scope = '{"own_only":true}'::jsonb
           WHERE id = ANY($1::int[]) AND data_origin_code = 'AUTOMATED_TEST'`,
          [userIds],
        );
      }
    } finally {
      await app.close();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
