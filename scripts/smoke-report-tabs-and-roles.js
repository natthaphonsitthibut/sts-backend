/**
 * Report tabs + default-role smoke: the student report's referral tab follows
 * the global school/area and ชั้น/ห้อง filters, the home grade chart turns into
 * rooms once a ชั้น is picked, a case reads its school and student from the
 * current rows, a school's ผู้ดูแลระบบ can open the PII export tab, no default
 * group starts with เช็กชื่อ, and creating a school no longer sends a status.
 *
 * Fixture accounts use data_origin_code='AUTOMATED_TEST' and are removed at the
 * end; nothing else is written.
 */
const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { PasswordService } = require('../dist/auth/password.service');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run report tabs smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const USERNAME_PREFIX = 'report-tabs-smoke-';

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
  return `${captured.name}=${captured.value}`;
}

async function request(baseUrl, method, path, cookie, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}

async function createUser(dataSource, passwordService, { suffix, role, permissions, dataScope }) {
  const passwordHash = await passwordService.hash(`Smoke-${Date.now()}-pass`);
  const [row] = await dataSource.query(
    `
      INSERT INTO users (
        username, password, "FirstName", "LastName", status, permissions, role,
        data_scope, must_change_password, affiliation, data_origin_code, email, phone
      )
      VALUES ($1, $2, 'รายงาน', 'ทดสอบอัตโนมัติ', 'ACTIVE', $3::jsonb, $4, $5::jsonb,
        FALSE, NULL, 'AUTOMATED_TEST', NULL, NULL)
      RETURNING id
    `,
    [
      `${USERNAME_PREFIX}${suffix}-${Date.now()}`,
      passwordHash,
      JSON.stringify(permissions),
      role,
      JSON.stringify(dataScope),
    ],
  );
  return row.id;
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
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
  const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
  const dataSource = app.get(DataSource);
  const passwordService = app.get(PasswordService);
  const sessionCookieService = app.get(SessionCookieService);
  const createdUserIds = [];
  const createdReferralIds = [];

  try {
    // ---- no default group starts with เช็กชื่อ
    const withAttendance = await dataSource.query(`
      SELECT name FROM roles
      WHERE default_permissions ? 'attendance'
        AND (name IN ('ADMIN', 'EXECUTIVE', 'DIRECTOR', 'ADMIN_PROVINCE', 'ADMIN_DISTRICT',
                      'ADMIN_SUBDISTRICT', 'ADMIN_SCHOOL')
             OR name ~ '^(A|S)[0-9]+_BASE_')
    `);
    assert(
      withAttendance.length === 0,
      `default groups still hold attendance: ${withAttendance.map((r) => r.name).join(', ')}`,
    );

    const [adminRole] = await dataSource.query(
      `SELECT default_permissions FROM roles WHERE name = 'ADMIN'`,
    );
    const adminId = await createUser(dataSource, passwordService, {
      suffix: 'admin',
      role: 'ADMIN',
      permissions: adminRole.default_permissions,
      dataScope: { global: true },
    });
    createdUserIds.push(adminId);
    const adminCookie = createSessionCookie(sessionCookieService, adminId);

    // ---- referral tab: school / grade / room / status / search filters
    // A smoke database may carry no referral; attach one to a review that has
    // none (removed in finally) so this section always runs.
    const [{ count: referralCount }] = await dataSource.query(
      `SELECT count(*)::int AS count FROM case_referrals`,
    );
    if (referralCount === 0) {
      const [fixture] = await dataSource.query(`
        INSERT INTO case_referrals (case_review_id, case_id, referral_agency_id, status_code)
        SELECT review.id, review.case_id,
          (SELECT id FROM referral_agencies WHERE is_active ORDER BY id LIMIT 1), 'REFERRED'
        FROM case_reviews review
        JOIN cases c ON c.id = review.case_id AND c.deleted_at IS NULL
        JOIN student_term st ON st.student_uuid = c.student_uuid
        WHERE NOT EXISTS (SELECT 1 FROM case_referrals r WHERE r.case_review_id = review.id)
        ORDER BY review.reviewed_at DESC
        LIMIT 1
        RETURNING id
      `);
      assert(fixture, 'could not create a fixture referral');
      createdReferralIds.push(fixture.id);
    }
    const [referralSchool] = await dataSource.query(`
      SELECT c.school_id, count(*)::int AS n
      FROM case_referrals r JOIN cases c ON c.id = r.case_id AND c.deleted_at IS NULL
      GROUP BY c.school_id ORDER BY n DESC LIMIT 1
    `);
    assert(referralSchool, 'need at least one referral');
    {
      const all = await request(baseUrl, 'GET', '/dashboard/referrals?limit=50', adminCookie);
      assert(all.status === 200, `referrals returned ${all.status}`);
      const bySchool = await request(
        baseUrl,
        'GET',
        `/dashboard/referrals?limit=50&schoolId=${referralSchool.school_id}`,
        adminCookie,
      );
      assert(bySchool.status === 200, `referrals?schoolId returned ${bySchool.status}`);
      assert(
        bySchool.body.data.every((row) => row.schoolId === referralSchool.school_id),
        'school filter returned another school',
      );
      assert(bySchool.body.meta.totalCount === referralSchool.n, 'school filter count mismatch');
      const summary = await request(
        baseUrl,
        'GET',
        `/dashboard/follow-up-summary?schoolId=${referralSchool.school_id}`,
        adminCookie,
      );
      assert(summary.status === 200, `follow-up-summary returned ${summary.status}`);
      assert(
        summary.body.data.referrals.total === referralSchool.n,
        'summary cards must count the same filtered referrals as the table',
      );
      const sample = bySchool.body.data[0];
      assert(
        'grade' in sample && 'room' in sample && 'studentId' in sample,
        'referral rows carry grade/room/studentId',
      );
      if (sample.grade && sample.room) {
        const byRoom = await request(
          baseUrl,
          'GET',
          `/dashboard/referrals?limit=50&schoolId=${referralSchool.school_id}&grade=${encodeURIComponent(sample.grade)}&room=${encodeURIComponent(sample.room)}`,
          adminCookie,
        );
        assert(byRoom.status === 200, `referrals?grade&room returned ${byRoom.status}`);
        assert(byRoom.body.data.length > 0, 'grade/room filter lost the sampled row');
        assert(
          byRoom.body.data.every((row) => row.grade === sample.grade && row.room === sample.room),
          'grade/room filter returned another class',
        );
      }
      const byStatus = await request(
        baseUrl,
        'GET',
        `/dashboard/referrals?limit=50&statusCode=${encodeURIComponent(sample.statusCode)}`,
        adminCookie,
      );
      assert(
        byStatus.body.data.every((row) => row.statusCode === sample.statusCode),
        'status filter returned another status',
      );
      const bySearch = await request(
        baseUrl,
        'GET',
        `/dashboard/referrals?limit=50&searchTerm=${encodeURIComponent(sample.studentName)}`,
        adminCookie,
      );
      assert(
        bySearch.body.data.some((row) => row.id === sample.id),
        'search by student name did not find the row',
      );
      const none = await request(
        baseUrl,
        'GET',
        '/dashboard/referrals?limit=50&province=__no_such_province__',
        adminCookie,
      );
      assert(none.body.meta.totalCount === 0, 'unknown province must match nothing');
    }

    // ---- home grade chart: ชั้น, then that ชั้น's ห้อง
    const [gradeSchool] = await dataSource.query(`
      SELECT s."SchoolID_Onec" AS school_id FROM student_term s
      WHERE s.deleted_at IS NULL AND s."SchoolID_Onec" IS NOT NULL
      GROUP BY 1 ORDER BY count(*) DESC LIMIT 1
    `);
    if (gradeSchool) {
      const grades = await request(
        baseUrl,
        'GET',
        `/home-dashboard/trends?period=30_DAYS&schoolId=${gradeSchool.school_id}`,
        adminCookie,
      );
      assert(grades.status === 200, `trends returned ${grades.status}`);
      const gradeChart = grades.body.data.gradeRiskDistribution;
      assert(gradeChart?.dimension === 'GRADE', 'school scope charts by grade');
      if (gradeChart.points.length > 0) {
        const grade = gradeChart.points[0].key;
        const rooms = await request(
          baseUrl,
          'GET',
          `/home-dashboard/trends?period=30_DAYS&schoolId=${gradeSchool.school_id}&grade=${encodeURIComponent(grade)}`,
          adminCookie,
        );
        const roomChart = rooms.body.data.gradeRiskDistribution;
        assert(roomChart?.dimension === 'ROOM', 'picking a grade charts its rooms');
        const roomTotal = roomChart.points.reduce((sum, point) => sum + point.total, 0);
        assert(
          roomTotal === gradeChart.points[0].total,
          'rooms of a grade must add up to the grade bar',
        );
      }
    }

    // ---- case detail reads current school + student rows
    const [someCase] = await dataSource.query(`
      SELECT c.id, sc.name AS school_name,
        TRIM(CONCAT_WS(' ', st."FirstName_Onec", st."LastName_Onec")) AS student_name
      FROM cases c
      JOIN schools sc ON sc.id = c.school_id
      JOIN student_term st ON st.student_uuid = c.student_uuid
      WHERE c.deleted_at IS NULL
      ORDER BY c.id LIMIT 1
    `);
    if (someCase) {
      const detail = await request(baseUrl, 'GET', `/cases/${someCase.id}`, adminCookie);
      assert(detail.status === 200, `case detail returned ${detail.status}`);
      const record = detail.body.data?.case ?? detail.body.data;
      assert(record.student_school === someCase.school_name, 'case detail shows a stale school');
      assert(
        record.student_name === someCase.student_name,
        'case detail shows a stale student name',
      );
    }

    // ---- a school's ผู้ดูแลระบบ opens the PII export tab
    const [schoolAdminRole] = await dataSource.query(`
      SELECT name, school_id, default_permissions FROM roles
      WHERE name ~ '^S[0-9]+_BASE_ADMIN$' AND school_id IS NOT NULL
      ORDER BY name LIMIT 1
    `);
    assert(schoolAdminRole, 'need a school admin group');
    assert(
      !schoolAdminRole.default_permissions.includes('students'),
      'school admin fixture should not hold students (the case this smoke guards)',
    );
    const schoolAdminId = await createUser(dataSource, passwordService, {
      suffix: 'school-admin',
      role: schoolAdminRole.name,
      permissions: schoolAdminRole.default_permissions,
      dataScope: { school_ids: [schoolAdminRole.school_id] },
    });
    createdUserIds.push(schoolAdminId);
    const schoolAdminCookie = createSessionCookie(sessionCookieService, schoolAdminId);
    const piiList = await request(
      baseUrl,
      'GET',
      '/students/pii-export-requests?limit=20',
      schoolAdminCookie,
    );
    assert(piiList.status === 200, `school admin PII export list returned ${piiList.status}`);
    const attendanceProbe = await request(baseUrl, 'GET', '/attendance/history', schoolAdminCookie);
    assert(attendanceProbe.status === 403, 'school admin must not open เช็กชื่อ by default');

    // ---- create-school body: status is not a create field
    const withStatus = await request(baseUrl, 'POST', '/schools', adminCookie, {
      name: '',
      schoolStatus: 'ACTIVE',
    });
    assert(withStatus.status === 400, `create with status returned ${withStatus.status}`);
    const withoutStatus = await request(baseUrl, 'POST', '/schools', adminCookie, { name: '' });
    assert(withoutStatus.status === 400, `create with empty name returned ${withoutStatus.status}`);
    const rejected = JSON.stringify(withoutStatus.body);
    assert(!rejected.includes('schoolStatus'), 'the form body must not trip on schoolStatus');
    assert(JSON.stringify(withStatus.body).includes('schoolStatus'), 'DTO still rejects status');

    console.log('smoke:report-tabs-and-roles ok');
  } finally {
    if (createdReferralIds.length > 0) {
      await dataSource.query(`DELETE FROM case_referrals WHERE id = ANY($1::uuid[])`, [
        createdReferralIds,
      ]);
    }
    if (createdUserIds.length > 0) {
      await dataSource
        .query(`DELETE FROM user_sessions WHERE user_id = ANY($1::int[])`, [createdUserIds])
        .catch(() => undefined);
      await dataSource.query(
        `DELETE FROM users WHERE id = ANY($1::int[]) AND data_origin_code = 'AUTOMATED_TEST'`,
        [createdUserIds],
      );
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
