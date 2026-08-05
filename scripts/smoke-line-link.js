// Fake LINE credentials, set before the app is required so the module factory
// arms the provider without ever reading the operator's real ones. Every call is
// stubbed below, so the smoke can never reach LINE.
process.env.LINE_ENABLED = 'true';
process.env.LINE_LOGIN_CHANNEL_ID = 'smoke-login-channel';
process.env.LINE_LOGIN_CHANNEL_SECRET = 'smoke-login-secret';
process.env.LINE_LOGIN_CALLBACK_URL = 'http://127.0.0.1/api/line/link/callback';
process.env.LINE_MESSAGING_CHANNEL_ID = 'smoke-channel';
process.env.LINE_MESSAGING_CHANNEL_SECRET = 'smoke-messaging-secret';
process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = 'smoke-token';
process.env.LINE_OA_BASIC_ID = '@sts-smoke';

const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { EmailService } = require('../dist/common/email/email.service');
const { MESSAGING_PROVIDER } = require('../dist/common/messaging/messaging.types');
const { RedisClientService } = require('../dist/redis/redis-client.service');
const { createHmac } = require('crypto');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run LINE link smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const EMAIL_ONE = 'line.link.smoke.one@sts-smoke.invalid';
const EMAIL_TWO = 'line.link.smoke.two@sts-smoke.invalid';
const LINE_USER_ONE = 'U00000000000000000000000000smoke1';
const LINE_USER_TWO = 'U00000000000000000000000000smoke2';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function parseJsonResponse(response) {
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

async function request(baseUrl, method, path, expectedStatus, body, extraHeaders) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(extraHeaders || {}) },
    // A raw string body is passed through verbatim so its bytes — and therefore
    // its signature — survive.
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'manual',
  });
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const payload = response.status === 302 ? null : await parseJsonResponse(response);
  assert(
    expected.includes(response.status),
    `${method} ${path}: expected ${expected.join('/')}, received ${response.status}; message=${
      payload?.message || 'none'
    }`,
  );
  return { response, payload };
}

/**
 * The real provider is replaced in-process. The smoke must never reach LINE:
 * it would need a live sign-in, and the whole point is to exercise OUR flow —
 * OTP, session, transaction, uniqueness — against the real database.
 */
function stubMessagingProvider(app) {
  const provider = app.get(MESSAGING_PROVIDER);
  const state = { friendState: 'FRIEND', identity: { providerUserId: LINE_USER_ONE, displayName: 'Smoke One' } };
  provider.isEnabled = () => true;
  provider.buildAuthorizationUrl = ({ state: value }) =>
    `https://access.line.me/oauth2/v2.1/authorize?state=${value}`;
  provider.buildAddContactUrl = () => 'https://line.me/R/ti/p/@sts-smoke';
  provider.completeAuthorization = () =>
    Promise.resolve({ identity: state.identity, friendState: state.friendState });
  return state;
}

/**
 * Rate-limit counters live in Redis and outlive the process, so a previous run
 * would otherwise leave this one throttled before it starts. Clearing them keeps
 * the run repeatable while the limiter itself stays armed (step 9 proves it).
 */
async function resetThrottleCounters(app) {
  const client = app.get(RedisClientService).getClient();
  if (!client) return;
  const keys = await client.keys('sts:throttle:otp*');
  if (keys.length > 0) await client.del(...keys);
}

function captureOtpCodes(app) {
  const emailService = app.get(EmailService);
  const codes = new Map();
  emailService.sendOTP = (email, code) => {
    codes.set(email.toLowerCase(), code);
    return Promise.resolve({ success: true, provider: 'SMOKE_CAPTURE' });
  };
  return codes;
}

async function cleanup(dataSource) {
  await dataSource.query(
    `
      DELETE FROM teacher_messaging_accounts
      WHERE teacher_id IN (SELECT id FROM teachers WHERE email = ANY($1::text[]))
    `,
    [[EMAIL_ONE, EMAIL_TWO]],
  );
  await dataSource.query(`DELETE FROM teachers WHERE email = ANY($1::text[])`, [
    [EMAIL_ONE, EMAIL_TWO],
  ]);
}

async function createTeacher(dataSource, email, firstName) {
  const [row] = await dataSource.query(
    `
      INSERT INTO teachers (first_name, last_name, email, teacher_status)
      VALUES ($1, 'Line Smoke', $2, 'ACTIVE')
      RETURNING id::text AS id
    `,
    [firstName, email],
  );
  return row.id;
}

/** Starts with the proof in a POST body and returns the generated OAuth state. */
async function startAuthorization(baseUrl, bindingToken) {
  const { payload } = await request(
    baseUrl,
    'POST',
    '/api/line/link/start',
    201,
    { token: bindingToken },
  );
  const authorizationUrl = payload?.data?.authorizationUrl;
  assert(
    authorizationUrl && authorizationUrl.includes('access.line.me'),
    'start did not return the provider URL',
  );
  const state = new URL(authorizationUrl).searchParams.get('state');
  assert(state, 'start did not carry a state value');
  return state;
}

async function callbackStatus(baseUrl, state) {
  const { response } = await request(
    baseUrl,
    'GET',
    `/api/line/link/callback?code=smoke-code&state=${encodeURIComponent(state)}`,
    302,
  );
  const location = response.headers.get('location');
  assert(location, 'callback did not redirect anywhere');
  return new URL(location).searchParams.get('status');
}

async function activeAccounts(dataSource, teacherId) {
  return await dataSource.query(
    `
      SELECT provider_user_id, friend_state, unlinked_at
      FROM teacher_messaging_accounts
      WHERE teacher_id = $1::bigint
      ORDER BY id
    `,
    [teacherId],
  );
}

async function verifiedBindingToken(baseUrl, codes, email) {
  await request(baseUrl, 'POST', '/api/line/link/otp/request', 201, { email });
  const code = codes.get(email.toLowerCase());
  assert(code, `no OTP was emailed to ${email}`);
  const { payload } = await request(baseUrl, 'POST', '/api/line/link/otp/verify', 201, {
    email,
    code,
  });
  const token = payload?.data?.bindingToken;
  assert(token, 'OTP verify did not return a binding token');
  return token;
}

async function main() {
  // rawBody mirrors main.ts: the webhook signature is over the exact bytes.
  const app = await NestFactory.create(AppModule, { logger: ['error'], rawBody: true });
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

  const dataSource = app.get(DataSource);
  const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const provider = stubMessagingProvider(app);
  const codes = captureOtpCodes(app);
  await resetThrottleCounters(app);

  try {
    await cleanup(dataSource);
    const teacherOneId = await createTeacher(dataSource, EMAIL_ONE, 'Line');
    const teacherTwoId = await createTeacher(dataSource, EMAIL_TWO, 'Other');

    // 1. An unknown address is answered exactly like a known one, and sends nothing.
    const unknownEmail = 'nobody.line.smoke@sts-smoke.invalid';
    const unknown = await request(baseUrl, 'POST', '/api/line/link/otp/request', 201, {
      email: unknownEmail,
    });
    const known = await request(baseUrl, 'POST', '/api/line/link/otp/request', 201, {
      email: EMAIL_ONE,
    });
    assert(
      JSON.stringify(unknown.payload) === JSON.stringify(known.payload),
      'The response differs for an unknown address, which leaks who is a teacher',
    );
    assert(!codes.has(unknownEmail), 'An OTP was emailed for an address with no teacher');

    // 2. A wrong code buys nothing.
    await request(baseUrl, 'POST', '/api/line/link/otp/verify', 400, {
      email: EMAIL_ONE,
      code: '000000',
    });

    // 3. The real code yields a binding session.
    const bindingToken = await verifiedBindingToken(baseUrl, codes, EMAIL_ONE);

    // 4. A teacher who has not added the OA is refused and nothing is stored.
    provider.friendState = 'NOT_FRIEND';
    assert(
      (await callbackStatus(baseUrl, await startAuthorization(baseUrl, bindingToken))) ===
        'not_friend',
      'A teacher who never added the account was not told to add it',
    );
    assert(
      (await activeAccounts(dataSource, teacherOneId)).length === 0,
      'An unreachable account was recorded as verified',
    );

    // 5. After adding, the same OTP proof still works — no second email needed.
    provider.friendState = 'FRIEND';
    const usedState = await startAuthorization(baseUrl, bindingToken);
    assert(
      (await callbackStatus(baseUrl, usedState)) === 'success',
      'Retrying after adding the account did not succeed',
    );
    const afterBind = await activeAccounts(dataSource, teacherOneId);
    assert(
      afterBind.length === 1 && afterBind[0].provider_user_id === LINE_USER_ONE,
      'The verified account was not stored',
    );
    assert(afterBind[0].friend_state === 'FRIEND', 'The stored friend state is wrong');

    // 6. Replaying a spent state must not bind anything again.
    assert(
      (await callbackStatus(baseUrl, usedState)) === 'expired',
      'A replayed callback was accepted',
    );
    assert(
      (await activeAccounts(dataSource, teacherOneId)).length === 1,
      'A replayed callback wrote a second row',
    );

    // 7. Linking a different LINE account keeps the old row as history.
    provider.identity = { providerUserId: LINE_USER_TWO, displayName: 'Smoke One New' };
    const rebindToken = await verifiedBindingToken(baseUrl, codes, EMAIL_ONE);
    assert(
      (await callbackStatus(baseUrl, await startAuthorization(baseUrl, rebindToken))) === 'success',
      'Re-linking a new LINE account failed',
    );
    const afterRebind = await activeAccounts(dataSource, teacherOneId);
    assert(afterRebind.length === 2, 'Re-linking overwrote the previous binding instead of keeping it');
    const previous = afterRebind.find((row) => row.provider_user_id === LINE_USER_ONE);
    const current = afterRebind.find((row) => row.provider_user_id === LINE_USER_TWO);
    assert(previous?.unlinked_at, 'The replaced binding was not closed');
    assert(current && !current.unlinked_at, 'The new binding is not active');

    // 8. That LINE account cannot be pointed at a second teacher.
    const otherToken = await verifiedBindingToken(baseUrl, codes, EMAIL_TWO);
    assert(
      (await callbackStatus(baseUrl, await startAuthorization(baseUrl, otherToken))) ===
        'already_linked_to_another_teacher',
      'One LINE account was allowed to claim two teachers',
    );
    assert(
      (await activeAccounts(dataSource, teacherTwoId)).length === 0,
      'A stolen binding was written for the second teacher',
    );

    // 9. An unfollow webhook flips the stored state, so the table stops claiming
    //    a teacher who blocked the account is still reachable.
    const unfollowBody = JSON.stringify({
      events: [{ type: 'unfollow', source: { userId: LINE_USER_TWO } }],
    });
    await request(baseUrl, 'POST', '/api/line/webhook', 400, unfollowBody, {
      'x-line-signature': 'not-a-signature',
    });
    assert(
      (await activeAccounts(dataSource, teacherOneId)).find(
        (row) => row.provider_user_id === LINE_USER_TWO,
      ).friend_state === 'FRIEND',
      'An unsigned webhook was allowed to change the friendship state',
    );

    await request(baseUrl, 'POST', '/api/line/webhook', 200, unfollowBody, {
      'x-line-signature': createHmac('sha256', process.env.LINE_MESSAGING_CHANNEL_SECRET)
        .update(unfollowBody)
        .digest('base64'),
    });
    assert(
      (await activeAccounts(dataSource, teacherOneId)).find(
        (row) => row.provider_user_id === LINE_USER_TWO,
      ).friend_state === 'NOT_FRIEND',
      'A signed unfollow did not mark the account unreachable',
    );

    // 10. The public OTP endpoint is rate limited. The script runs with a raised
    //    limit so the flow above fits; this proves the limiter is still attached.
    await request(baseUrl, 'POST', '/api/line/link/otp/request', 429, { email: EMAIL_ONE });

    console.log(
      JSON.stringify({
        status: 'line_link_smoke_ok',
        checked: [
          'an unknown address is answered identically and receives no mail',
          'a wrong OTP yields no binding session',
          'a teacher who has not added the OA is refused and nothing is stored',
          'retrying after adding the OA reuses the same OTP proof',
          'a replayed callback is rejected without binding twice',
          're-linking keeps the previous binding as history',
          'one LINE account cannot be claimed by a second teacher',
          'an unsigned webhook is refused; a signed unfollow marks the account unreachable',
        ],
      }),
    );
  } finally {
    await cleanup(dataSource).catch(() => undefined);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
