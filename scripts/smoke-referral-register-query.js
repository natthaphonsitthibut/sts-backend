/** Read-only regression check against the real referral query and HTTP guards. */
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { RiskProfileService } = require('../dist/risk-profile/risk-profile.service');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { appConfig } = require('../dist/config/app.config');

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.DB_NAME !== 'sts') {
    throw new Error('Requires the local sts database');
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RiskProfileService)
    .useValue({ requestStudentRecalculation: async () => {}, enqueueFull: async () => {}, refreshDailyRecalcCron: async () => {} })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  try {
    await app.init();
    const db = app.get(DataSource);
    const [actor] = await db.query(`SELECT u.id FROM users u LEFT JOIN roles r ON r.name=u.role
      WHERE u.status='ACTIVE' AND COALESCE(u.permissions,r.default_permissions,'[]'::jsonb) @> '["dashboard"]'::jsonb
        AND u.data_scope IS NOT NULL AND u.data_scope <> '{}'::jsonb
      ORDER BY u.id LIMIT 1`);
    assert(actor, 'Need an active scoped dashboard user');
    let cookie;
    app.get(SessionCookieService).setSession({ cookie: (name, value) => { cookie = `${name}=${value}`; } }, actor.id);
    await app.listen(0, '127.0.0.1');
    const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const request = async (base, suffix = '', authenticated = true) => {
      const response = await fetch(`${base}/api/dashboard/referrals?page=1&limit=20${suffix}`, {
        headers: authenticated ? { Cookie: cookie } : {},
      });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await request(origin, '', false)).status, 401);
    const result = await request(origin);
    assert.equal(result.status, 200, 'Referral list must load without an SQL error');
    assert(Array.isArray(result.body.data));
    for (const row of result.body.data) {
      assert.equal(typeof row.accessCodeAvailable, 'boolean');
      assert(!Object.keys(row).some((key) => /encrypted|hash|access_code/.test(key)), 'Internal credentials must not leak');
    }
    const filtered = await request(origin, '&searchTerm=NO_MATCH_REFERRAL_REGRESSION');
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.data.length, 0);
    const liveOrigin = `http://127.0.0.1:${app.get(appConfig.KEY).port}`;
    const live = await request(liveOrigin);
    assert.equal(live.status, 200, 'Running development server must load referrals too');
    assert(Array.isArray(live.body.data));
    const watchlistStates = {};
    if (process.argv.includes('--watchlist')) {
      for (const status of ['OPEN', 'IN_PROGRESS', 'STUDENT_NOT_FOUND', 'PENDING_REVIEW', 'AWAITING_REFERRAL', 'AWAITING_REFERRAL_OUTCOME', 'RESOLVED']) {
        const response = await fetch(`${liveOrigin}/api/dashboard/risk-watchlist?studentGroup=WATCHLIST&schoolId=10010004&caseStatus=${status}&page=1&limit=20`, { headers: { Cookie: cookie } });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert(body.data.every(row => row.latestCaseStatus === status));
        const prepared = body.data.filter(row => row.latestCaseId >= 3354 && row.latestCaseId <= 3374);
        assert.equal(prepared.length, 3, 'Each status must expose three prepared watchlist students');
        if (process.argv.includes('--recorded-causes')) {
          assert(prepared.every(row => typeof row.latestOpenCaseReason === 'string'
            && row.latestOpenCaseReason.trim().length > 0
            && !row.latestOpenCaseReason.includes('รอบตุลาคม 2569')
            && !/ — .* [123]$/.test(row.latestOpenCaseReason)), 'The follow-up reason must contain a recorded cause');
        }
        watchlistStates[status] = prepared.length;
      }
    }
    process.stdout.write(JSON.stringify({ success: true, isolatedApiStatus: 200, liveApiStatus: 200, unauthenticatedStatus: 401, rows: result.body.data.length, credentialsExposed: false, watchlistStates }) + '\n');
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  process.stderr.write(JSON.stringify({ success: false, errorType: error.name,
    code: error.code, actualStatus: typeof error.actual === 'number' ? error.actual : undefined }) + '\n');
  process.exitCode = 1;
});
