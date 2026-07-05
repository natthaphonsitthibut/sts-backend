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
  throw new Error('Refusing to run account lifecycle notifications smoke with NODE_ENV=production');
}

const ACTOR_USERNAME = 'account_noti_smoke_actor';
const TARGET_USERNAME = 'account_noti_smoke_target';
const DEACTIVATED = 'ACCOUNT_DEACTIVATED';
const REACTIVATED = 'ACCOUNT_REACTIVATED';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function returningRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

async function parseJson(response) {
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

async function upsertUser(dataSource, { username, role, permissions, passwordHash }) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing) {
    await dataSource.query(
      `UPDATE users
       SET password = $2, "FirstName" = 'Account', "LastName" = 'Noti Smoke', status = 'ACTIVE',
           permissions = $3::jsonb, role = $4, data_scope = '{"global":true}'::jsonb,
           must_change_password = FALSE, deactivated_at = NULL, deactivated_by = NULL,
           deactivation_reason_code = NULL, deactivation_note = NULL, data_origin_code = 'AUTOMATED_TEST'
       WHERE id = $1`,
      [existing.id, passwordHash, JSON.stringify(permissions), role],
    );
    return existing.id;
  }
  const [created] = returningRows(
    await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions, role,
         data_scope, must_change_password, data_origin_code)
       VALUES ($1, $2, 'Account', 'Noti Smoke', 'ACTIVE', $3::jsonb, $4, '{"global":true}'::jsonb, FALSE, 'AUTOMATED_TEST')
       RETURNING id`,
      [username, passwordHash, JSON.stringify(permissions), role],
    ),
  );
  return created.id;
}

async function disableUser(dataSource, id, username) {
  if (!id) return;
  await dataSource.query(
    `UPDATE users SET status = 'DISABLED', deactivated_at = COALESCE(deactivated_at, now()),
       deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
       deactivation_note = COALESCE(deactivation_note, 'Account noti smoke fixture')
     WHERE id = $1 AND username = $2`,
    [id, username],
  );
}

async function deleteRefNotifications(dataSource, targetId) {
  await dataSource.query(
    `DELETE FROM notifications WHERE ref_entity = 'user' AND ref_id = $1 AND type_code = ANY($2::varchar[])`,
    [String(targetId), [DEACTIVATED, REACTIVATED]],
  );
}

// Recipients the fan-out should reach: real (non-test) active staff with global
// scope whose effective permission set includes manage-users-list.
async function expectedRecipientIds(dataSource) {
  const rows = await dataSource.query(
    `SELECT u.id
     FROM users u
     LEFT JOIN roles r ON r.name = u.role
     WHERE u.status = 'ACTIVE'
       AND u.role IS DISTINCT FROM 'STUDENT'
       AND u.data_origin_code <> 'AUTOMATED_TEST'
       AND u.data_scope->'global' = 'true'::jsonb
       AND (
         CASE
           WHEN jsonb_typeof(u.permissions) = 'array' AND jsonb_array_length(u.permissions) > 0
             THEN u.permissions ? 'manage-users-list'
           ELSE COALESCE(r.default_permissions ? 'manage-users-list', FALSE)
         END
       )`,
  );
  return rows.map((row) => Number(row.id));
}

async function recipientsFor(dataSource, targetId, typeCode) {
  const rows = await dataSource.query(
    `SELECT n.recipient_user_id, u.data_origin_code
     FROM notifications n JOIN users u ON u.id = n.recipient_user_id
     WHERE n.ref_entity = 'user' AND n.ref_id = $1 AND n.type_code = $2`,
    [String(targetId), typeCode],
  );
  return rows;
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert(response.status === 201, `${username} login returned ${response.status}`);
  const cookie = response.headers.get('set-cookie');
  assert(cookie && cookie.includes('HttpOnly'), 'Login did not return an httpOnly cookie');
  return cookie.split(';')[0];
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
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const actorPassword = `Actor-${suffix}`;
  let actorId;
  let targetId;

  try {
    const recipients = await expectedRecipientIds(dataSource);
    assert(recipients.length > 0, 'No real global manage-users-list recipient exists to notify');

    actorId = await upsertUser(dataSource, {
      username: ACTOR_USERNAME, role: 'ADMIN', permissions: ['manage-users-list', 'home'],
      passwordHash: await passwordService.hash(actorPassword),
    });
    targetId = await upsertUser(dataSource, {
      username: TARGET_USERNAME, role: 'TEACHER', permissions: [],
      passwordHash: await passwordService.hash(`Target-${suffix}`),
    });
    await deleteRefNotifications(dataSource, targetId);

    const actorCookie = await login(baseUrl, ACTOR_USERNAME, actorPassword);

    // Deactivate -> ACCOUNT_DEACTIVATED fan-out.
    const deacResponse = await fetch(`${baseUrl}/api/users/${targetId}/deactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: actorCookie },
      body: JSON.stringify({ reasonCode: 'OTHER', note: 'Account lifecycle notification smoke' }),
    });
    assert(deacResponse.status === 201, `Deactivate returned ${deacResponse.status} ${JSON.stringify(await parseJson(deacResponse))}`);

    const deacRows = await recipientsFor(dataSource, targetId, DEACTIVATED);
    const deacIds = deacRows.map((row) => Number(row.recipient_user_id));
    for (const id of recipients) {
      assert(deacIds.includes(id), `Expected recipient ${id} did not get the deactivation notification`);
    }
    assert(!deacIds.includes(actorId), 'The acting admin must not notify themselves');
    assert(
      deacRows.every((row) => row.data_origin_code !== 'AUTOMATED_TEST'),
      'A test-tagged account must never be a notification recipient',
    );

    // Reactivate -> ACCOUNT_REACTIVATED fan-out.
    const reacResponse = await fetch(`${baseUrl}/api/users/${targetId}/reactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: actorCookie },
      body: JSON.stringify({}),
    });
    assert(reacResponse.status === 201, `Reactivate returned ${reacResponse.status} ${JSON.stringify(await parseJson(reacResponse))}`);

    const reacIds = (await recipientsFor(dataSource, targetId, REACTIVATED)).map((row) => Number(row.recipient_user_id));
    for (const id of recipients) {
      assert(reacIds.includes(id), `Expected recipient ${id} did not get the reactivation notification`);
    }
    assert(!reacIds.includes(actorId), 'The acting admin must not notify themselves on reactivation');

    console.log(
      JSON.stringify({
        status: 'account_lifecycle_notifications_smoke_ok',
        recipients: recipients.length,
        checked: [
          'deactivate fans ACCOUNT_DEACTIVATED to in-scope manage-users-list admins',
          'reactivate fans ACCOUNT_REACTIVATED to the same admins',
          'acting admin excluded from both',
          'AUTOMATED_TEST accounts never receive',
        ],
      }),
    );
  } finally {
    if (targetId) await deleteRefNotifications(dataSource, targetId);
    await disableUser(dataSource, targetId, TARGET_USERNAME);
    await disableUser(dataSource, actorId, ACTOR_USERNAME);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
