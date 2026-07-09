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
  throw new Error('Refusing to run recruitment-campaign smoke with NODE_ENV=production');
}

const GLOBAL_ADMIN_USERNAME = 'recruitment_campaign_smoke_global_admin';
const DISTRICT_ADMIN_USERNAME = 'recruitment_campaign_smoke_district_admin';
const SMOKE_ACTORS = [GLOBAL_ADMIN_USERNAME, DISTRICT_ADMIN_USERNAME];

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

async function upsertActor(dataSource, passwordHash, { username, dataScope }) {
  const [existing] = await dataSource.query(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
  const permissions = JSON.stringify(['field-monitor']);
  if (existing) {
    await dataSource.query(
      `
        UPDATE users
        SET password = $2,
            "FirstName" = 'Recruitment Campaign',
            "LastName" = 'Smoke',
            status = 'ACTIVE',
            permissions = $3::jsonb,
            role = 'ADMIN',
            data_scope = $4::jsonb,
            must_change_password = FALSE,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL,
            affiliation = 'Automated recruitment-campaign smoke',
            data_origin_code = 'AUTOMATED_TEST',
            email = NULL,
            phone = NULL
        WHERE id = $1
      `,
      [existing.id, passwordHash, permissions, JSON.stringify(dataScope)],
    );
    return existing;
  }

  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code, email, phone
      )
      VALUES (
        $1, $2, 'Recruitment Campaign', 'Smoke', 'ACTIVE', $3::jsonb, 'ADMIN',
        $4::jsonb, FALSE, 'Automated recruitment-campaign smoke',
        'AUTOMATED_TEST', NULL, NULL
      )
      RETURNING id
    `,
    [username, passwordHash, permissions, JSON.stringify(dataScope)],
  );
  return row;
}

async function cleanupData(dataSource, namePrefix) {
  // field_followers.campaign_id -> follower_recruitment_campaigns is ON DELETE
  // RESTRICT, so children must go first regardless of the campaign row's
  // soft-delete state.
  await dataSource.query(
    `
      DELETE FROM field_followers
      WHERE campaign_id IN (SELECT id FROM follower_recruitment_campaigns WHERE name LIKE $1)
    `,
    [`${namePrefix}%`],
  );
  await dataSource.query(`DELETE FROM follower_recruitment_campaigns WHERE name LIKE $1`, [
    `${namePrefix}%`,
  ]);
}

async function disableActors(dataSource) {
  await dataSource.query(
    `
      UPDATE users
      SET status = 'DISABLED',
          deactivated_at = COALESCE(deactivated_at, NOW()),
          deactivation_reason_code = COALESCE(deactivation_reason_code, 'OTHER'),
          deactivation_note = COALESCE(deactivation_note, 'Retained automated smoke fixture')
      WHERE username = ANY($1::text[])
    `,
    [SMOKE_ACTORS],
  );
  const [activeActors] = await dataSource.query(
    `SELECT COUNT(*)::int AS count FROM users WHERE username = ANY($1::text[]) AND status = 'ACTIVE'`,
    [SMOKE_ACTORS],
  );
  assert(activeActors.count === 0, 'Smoke actors were not disabled during cleanup');
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
  const password = `Campaign-${suffix}-Password`;
  const namePrefix = `SMOKE_CAMPAIGN_${suffix.toUpperCase()}_`;

  try {
    await cleanupData(dataSource, 'SMOKE_CAMPAIGN_');
    await upsertActor(dataSource, await passwordService.hash(password), {
      username: GLOBAL_ADMIN_USERNAME,
      dataScope: { global: true },
    });
    await upsertActor(dataSource, await passwordService.hash(password), {
      username: DISTRICT_ADMIN_USERNAME,
      dataScope: { districts: ['เมืองเชียงใหม่'] },
    });

    const globalLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: GLOBAL_ADMIN_USERNAME, password },
    });
    const globalCookie = cookieHeader(globalLogin.response);
    const districtLogin = await request(baseUrl, 'POST', '/api/users/login', 201, {
      body: { username: DISTRICT_ADMIN_USERNAME, password },
    });
    const districtCookie = cookieHeader(districtLogin.response);

    // 1. District-scoped actor cannot widen a campaign to global scope.
    await request(baseUrl, 'POST', '/api/follower-recruitment-campaigns', 403, {
      headers: { cookie: districtCookie },
      body: { name: `${namePrefix}TOO_WIDE`, data_scope: { global: true } },
    });

    // 2. Global admin creates a campaign (data_scope omitted -> defaults to own scope).
    const created = await request(baseUrl, 'POST', '/api/follower-recruitment-campaigns', 201, {
      headers: { cookie: globalCookie },
      body: { name: `${namePrefix}ROUND1` },
    });
    const campaign = created.payload.data;
    assert(campaign.public_code, 'Create did not return a public_code');
    assert(campaign.is_open === true, 'Freshly created campaign should be open');
    assert(campaign.view_count === 0, 'Freshly created campaign should have 0 views');

    // 3. It shows up in the admin list with a live submission_count of 0.
    const listAfterCreate = await request(
      baseUrl,
      'GET',
      '/api/follower-recruitment-campaigns',
      200,
      { headers: { cookie: globalCookie } },
    );
    const listedCampaign = listAfterCreate.payload.data.find((row) => row.id === campaign.id);
    assert(listedCampaign, 'New campaign missing from admin list');
    assert(listedCampaign.submission_count === 0, 'New campaign should start with 0 submissions');

    // 4. District-scoped actor (outside the campaign's scope) gets 404, not 403, on PATCH.
    await request(
      baseUrl,
      'PATCH',
      `/api/follower-recruitment-campaigns/${campaign.id}`,
      404,
      { headers: { cookie: districtCookie }, body: { is_active: false } },
    );

    // 5. Public lookup by code: open, and view_count increments per call.
    const publicView1 = await request(
      baseUrl,
      'GET',
      `/api/public/follower-applications/campaign/${campaign.public_code}`,
      200,
    );
    assert(publicView1.payload.is_open === true, 'Public lookup should report the campaign open');
    await request(
      baseUrl,
      'GET',
      `/api/public/follower-applications/campaign/${campaign.public_code}`,
      200,
    );
    const listAfterViews = await request(
      baseUrl,
      'GET',
      '/api/follower-recruitment-campaigns',
      200,
      { headers: { cookie: globalCookie } },
    );
    const viewedCampaign = listAfterViews.payload.data.find((row) => row.id === campaign.id);
    assert(viewedCampaign.view_count === 2, `Expected view_count=2, got ${viewedCampaign.view_count}`);

    // 6. Public apply through the campaign code attaches campaign_id and is
    // reflected in submission_count.
    await request(baseUrl, 'POST', '/api/public/follower-applications', 201, {
      body: {
        first_name: 'สมศรี',
        last_name: 'ทดสอบ',
        phone: '0899999999',
        campaign_code: campaign.public_code,
      },
    });
    const listAfterApply = await request(
      baseUrl,
      'GET',
      '/api/follower-recruitment-campaigns',
      200,
      { headers: { cookie: globalCookie } },
    );
    const appliedCampaign = listAfterApply.payload.data.find((row) => row.id === campaign.id);
    assert(
      appliedCampaign.submission_count === 1,
      `Expected submission_count=1, got ${appliedCampaign.submission_count}`,
    );

    const [followerRow] = await dataSource.query(
      `SELECT campaign_id, applied_via FROM field_followers WHERE phone = '0899999999' ORDER BY created_at DESC LIMIT 1`,
    );
    assert(String(followerRow.campaign_id) === String(campaign.id), 'Application campaign_id mismatch');
    assert(followerRow.applied_via === 'CAMPAIGN', 'Application applied_via should be CAMPAIGN');

    // 7. Toggle inactive -> public lookup reports closed, apply is rejected.
    await request(
      baseUrl,
      'PATCH',
      `/api/follower-recruitment-campaigns/${campaign.id}`,
      200,
      { headers: { cookie: globalCookie }, body: { is_active: false } },
    );
    const publicViewClosed = await request(
      baseUrl,
      'GET',
      `/api/public/follower-applications/campaign/${campaign.public_code}`,
      200,
    );
    assert(publicViewClosed.payload.is_open === false, 'Toggled-off campaign should report closed');

    await request(baseUrl, 'POST', '/api/public/follower-applications', 400, {
      body: {
        first_name: 'สมศักดิ์',
        last_name: 'ทดสอบ',
        phone: '0888888888',
        campaign_code: campaign.public_code,
      },
    });

    // 8. Soft-delete -> public lookup now 404s.
    await request(
      baseUrl,
      'DELETE',
      `/api/follower-recruitment-campaigns/${campaign.id}`,
      200,
      { headers: { cookie: globalCookie } },
    );
    await request(
      baseUrl,
      'GET',
      `/api/public/follower-applications/campaign/${campaign.public_code}`,
      404,
    );

    console.log('recruitment-campaign smoke passed');
  } finally {
    try {
      await cleanupData(dataSource, 'SMOKE_CAMPAIGN_');
    } finally {
      try {
        await disableActors(dataSource);
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
