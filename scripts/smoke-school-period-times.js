const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run school-period-times smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const USERNAME = 'school_period_times_smoke_admin';
const SCHOOL_ID = 10010002;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function parseJsonResponse(response) {
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

function cookieHeader(response) {
  const cookie = response.headers.get('set-cookie');
  assert(cookie && cookie.includes('HttpOnly'), 'Login did not return an httpOnly session cookie');
  return cookie.split(';')[0];
}

async function request(baseUrl, method, path, expectedStatus, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await parseJsonResponse(response);
  assert(
    response.status === expectedStatus,
    `${method} ${path}: expected ${expectedStatus}, received ${response.status}; payload=${JSON.stringify(payload)}`,
  );
  return { response, payload };
}

async function upsertActor(dataSource, passwordHash) {
  const permissions = JSON.stringify(['manage-timetable']);
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    USERNAME,
  ]);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'School Period Times',
            "LastName" = 'Smoke',
            status = 'ACTIVE',
            permissions = $3::jsonb,
            role = 'ADMIN',
            data_scope = '{"global":true}'::jsonb,
            must_change_password = FALSE,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
        WHERE id = $1
      `,
      [existing.id, passwordHash, permissions],
    );
    return Number(existing.id);
  }

  const [created] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, data_origin_code, email, phone
      )
      VALUES (
        $1, $2, 'School Period Times', 'Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        '{"global":true}'::jsonb, FALSE, 'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [USERNAME, passwordHash, permissions],
  );
  return Number(created.id);
}

async function disableActor(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated school-period-times smoke fixture')
      WHERE username = $1
    `,
    [USERNAME],
  );
}

async function restoreOriginalSchedule(dataSource, originalRows) {
  await dataSource.query(
    `DELETE FROM school_period_times WHERE school_id = $1 AND day_of_week = 1`,
    [SCHOOL_ID],
  );
  for (const row of originalRows) {
    await dataSource.query(
      `
        INSERT INTO school_period_times (school_id, day_of_week, period, starts_at, ends_at, source)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [row.school_id, row.day_of_week, row.period, row.starts_at, row.ends_at, row.source],
    );
  }
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
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
  const passwordService = app.get(PasswordService);
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const password = `SchoolPeriodTimes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const originalMondayRows = await dataSource.query(
    `SELECT school_id, day_of_week, period, starts_at, ends_at, source
     FROM school_period_times WHERE school_id = $1 AND day_of_week = 1 AND deleted_at IS NULL
     ORDER BY period`,
    [SCHOOL_ID],
  );

  try {
    await upsertActor(dataSource, await passwordService.hash(password));
    const login = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: USERNAME, password },
    });
    const cookie = cookieHeader(login.response);

    // 1. Baseline read: backfilled schedule should already be there for Monday.
    const before = await request(
      baseUrl,
      'GET',
      `/api/timetable/period-times?schoolId=${SCHOOL_ID}`,
      200,
      { headers: { cookie } },
    );
    const mondayBefore = before.payload.data.filter((row) => row.day_of_week === 1);
    assert(mondayBefore.length === 8, `Expected 8 backfilled Monday periods, got ${mondayBefore.length}`);
    assert(
      mondayBefore.every((row) => row.source === 'BACKFILL'),
      'Expected all pre-existing Monday periods to be source=BACKFILL',
    );

    // 2. Generate replaces Monday with a fresh computed schedule.
    const generated = await request(
      baseUrl,
      'POST',
      '/api/timetable/period-times/generate',
      201,
      {
        headers: { cookie },
        body: {
          schoolId: SCHOOL_ID,
          daysOfWeek: [1],
          periodsCount: 4,
          firstPeriodStartsAt: '08:00',
          periodLengthMinutes: 45,
          breakAfterPeriod: 2,
          breakMinutes: 15,
        },
      },
    );
    const mondayAfterGenerate = generated.payload.data.filter((row) => row.day_of_week === 1);
    assert(
      mondayAfterGenerate.length === 4,
      `Expected 4 generated Monday periods, got ${mondayAfterGenerate.length}`,
    );
    assert(
      mondayAfterGenerate.every((row) => row.source === 'GENERATED'),
      'Expected regenerated Monday periods to be source=GENERATED',
    );
    const period1 = mondayAfterGenerate.find((row) => row.period === 1);
    assert(period1.starts_at.startsWith('08:00'), `period 1 should start at 08:00, got ${period1.starts_at}`);
    const period3 = mondayAfterGenerate.find((row) => row.period === 3);
    // period1 08:00-08:45, period2 08:45-09:30, +15min break -> period3 09:45-10:30
    assert(period3.starts_at.startsWith('09:45'), `period 3 should start at 09:45 after the break, got ${period3.starts_at}`);

    // 3. Override a single period -> source flips to MANUAL, others untouched.
    const overridden = await request(
      baseUrl,
      'PATCH',
      '/api/timetable/period-times/override',
      200,
      {
        headers: { cookie },
        body: { schoolId: SCHOOL_ID, dayOfWeek: 1, period: 1, startsAt: '07:30', endsAt: '08:15' },
      },
    );
    const overriddenPeriod1 = overridden.payload.data.find(
      (row) => row.day_of_week === 1 && row.period === 1,
    );
    assert(overriddenPeriod1.starts_at.startsWith('07:30'), 'Override did not update starts_at');
    assert(overriddenPeriod1.source === 'MANUAL', 'Override did not flip source to MANUAL');
    const untouchedPeriod2 = overridden.payload.data.find(
      (row) => row.day_of_week === 1 && row.period === 2,
    );
    assert(untouchedPeriod2.source === 'GENERATED', 'Override incorrectly touched a different period');

    // 4. Invalid override (end before start) is rejected.
    await request(baseUrl, 'PATCH', '/api/timetable/period-times/override', 400, {
      headers: { cookie },
      body: { schoolId: SCHOOL_ID, dayOfWeek: 1, period: 1, startsAt: '09:00', endsAt: '08:00' },
    });

    // 5. Unauthenticated access is rejected.
    await request(baseUrl, 'GET', `/api/timetable/period-times?schoolId=${SCHOOL_ID}`, 401);

    console.log('school-period-times smoke passed');
  } finally {
    try {
      await restoreOriginalSchedule(dataSource, originalMondayRows);
    } finally {
      try {
        await disableActor(dataSource);
      } finally {
        await app.close();
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
