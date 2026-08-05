const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run home dashboard smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createSessionCookie(sessionCookieService, userId) {
  let captured = null;
  sessionCookieService.setSession(
    {
      cookie: (name, value) => {
        captured = { name, value };
      },
    },
    userId,
  );
  assert(captured, 'Session cookie was not created');
  return captured;
}

async function requestJson(baseUrl, path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      cookie: `${cookie.name}=${cookie.value}`,
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);

  try {
    const users = await dataSource.query(
      `
        SELECT u.id
        FROM users u
        LEFT JOIN roles r ON r.name = u.role
        WHERE u.status = 'ACTIVE'
          AND u.data_origin_code <> 'AUTOMATED_TEST'
          AND (
            (jsonb_typeof(u.permissions) = 'array' AND (u.permissions ? 'home' OR u.permissions ? 'ALL' OR u.permissions ? '*'))
            OR COALESCE(r.default_permissions ? 'home', FALSE)
          )
        ORDER BY u.id
        LIMIT 1
      `,
    );
    assert(users.length === 1, 'need an active user with home permission');
    const cookie = createSessionCookie(sessionCookieService, users[0].id);

    const summary = await requestJson(baseUrl, '/home-dashboard/summary?period=30_DAYS', cookie);
    assert(summary.status === 200, `summary returned ${summary.status}`);
    assert(summary.body?.success === true, 'summary must use success envelope');
    assert(Array.isArray(summary.body.data?.metrics), 'summary metrics must be an array');
    assert(
      Array.isArray(summary.body.data?.availableSections),
      'summary must expose availableSections',
    );

    const trends = await requestJson(baseUrl, '/home-dashboard/trends?period=7_DAYS', cookie);
    assert(trends.status === 200, `trends returned ${trends.status}`);
    assert(trends.body?.data?.period === '7_DAYS', 'trend period must echo the request');

    const options = await requestJson(baseUrl, '/home-dashboard/filter-options', cookie);
    assert(options.status === 200, `filter-options returned ${options.status}`);
    assert(Array.isArray(options.body?.data?.options?.schools), 'school options must be an array');

    const badCascade = await requestJson(
      baseUrl,
      '/home-dashboard/summary?district=เมืองชลบุรี',
      cookie,
    );
    assert(badCascade.status === 400, `bad cascade must be 400, got ${badCascade.status}`);

    const serialized = JSON.stringify(summary.body);
    assert(!serialized.includes('PersonID_Onec'), 'home response must not expose national id');
    assert(!serialized.includes('token'), 'home response must not expose token fields');
    assert(!serialized.includes('student_lat'), 'home response must not expose GPS fields');

    console.log('smoke:home-dashboard ok');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
