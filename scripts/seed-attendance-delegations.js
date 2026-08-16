require('dotenv/config');

const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { AppExceptionFilter } = require('../dist/common/filters/app-exception.filter');
const {
  createValidationException,
} = require('../dist/common/validation/validation-exception.factory');
const appDataSource = require('../dist/database/typeorm.datasource').default;

const AUDIT_ONLY = process.argv.includes('--audit-only');

/**
 * Fills ประวัติการมอบหมาย the way it fills in real life: by calling the same
 * endpoints the screens call. Nothing is written straight to the tables, so the
 * rows carry real grants, real tokens, real audit entries — and the three
 * states the history shows (รอเช็กชื่อ / เสร็จสิ้น / ยกเลิก) come out of the
 * flow rather than out of a fixture.
 */
async function main() {
  await appDataSource.initialize();
  const runner = appDataSource.createQueryRunner();
  await runner.connect();

  const [{ existing }] = await runner.query(`
    SELECT COUNT(*)::int AS existing
    FROM teacher_access_attendance_assignments delegated
    JOIN teacher_access_grants grant_row ON grant_row.id = delegated.grant_id
    WHERE grant_row.access_scope = 'ATTENDANCE_ONLY'
  `);
  console.log(`delegations already recorded : ${existing}`);

  // A classroom whose homeroom teacher can delegate, in the active term, with a
  // second teacher in the same school to receive it.
  const targets = await runner.query(`
    SELECT DISTINCT ON (classroom.id)
      classroom.id::text AS classroom_id,
      classroom.school_id,
      classroom.school_term_id::text AS school_term_id,
      homeroom.id::text AS assignment_id,
      homeroom.teacher_membership_id::text AS owner_membership_id,
      owner_account.id AS owner_user_id,
      admin_account.id AS admin_user_id,
      (
        SELECT membership.id
        FROM school_teacher_memberships membership
        JOIN teachers teacher ON teacher.id = membership.teacher_id
        WHERE membership.school_id = classroom.school_id
          AND membership.id <> homeroom.teacher_membership_id
          AND membership.membership_status = 'ACTIVE'
          AND membership.deleted_at IS NULL
          AND teacher.teacher_status = 'ACTIVE'
        ORDER BY membership.id
        LIMIT 1
      )::text AS recipient_membership_id
    FROM school_classrooms classroom
    JOIN school_terms term ON term.id = classroom.school_term_id
    JOIN classroom_teacher_assignments homeroom
      ON homeroom.classroom_id = classroom.id
     AND homeroom.assignment_kind = 'HOMEROOM'
     AND homeroom.assignment_status = 'ACTIVE'
     AND homeroom.deleted_at IS NULL
    JOIN school_teacher_memberships owner_membership
      ON owner_membership.id = homeroom.teacher_membership_id
    LEFT JOIN users owner_account ON owner_account.id = owner_membership.teacher_user_id
    -- Whoever the school would really use: an account that holds the permission
    -- the endpoint requires and can see this school.
    JOIN users admin_account
      ON admin_account.status = 'ACTIVE'
     AND admin_account.permissions::text ILIKE '%manage-teacher-access%'
     AND (
       admin_account.data_scope->>'global' = 'true'
       OR admin_account.data_scope->'school_ids' @> to_jsonb(classroom.school_id)
     )
    WHERE classroom.classroom_status = 'ACTIVE'
      AND classroom.deleted_at IS NULL
      AND term.status = 'ACTIVE'
      AND term.deleted_at IS NULL
      AND CURRENT_DATE BETWEEN term.starts_on AND term.ends_on
    ORDER BY classroom.id, admin_account.id
    LIMIT 3
  `);
  const target = targets[0];
  if (!target?.recipient_membership_id) {
    throw new Error('no classroom with a homeroom teacher and a second teacher to delegate to');
  }
  const [{ day: today }] = await runner.query(
    `SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS day`,
  );
  console.log(
    `target classroom ${target.classroom_id} · owner membership ${target.owner_membership_id} → recipient ${target.recipient_membership_id}`,
  );
  await runner.release();

  if (AUDIT_ONLY) {
    console.log('audit-only: no changes written');
    await appDataSource.destroy();
    return;
  }

  const app = await NestFactory.create(AppModule, { logger: false });
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
  await app.listen(0);
  const baseUrl = await app.getUrl();
  const cookieService = app.get(SessionCookieService);
  let cookie;
  cookieService.setSession(
    {
      cookie: (name, value) => {
        cookie = `${name}=${value}`;
      },
    },
    Number(target.admin_user_id),
  );

  async function post(path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
    const payload = await response.text();
    if (!response.ok) {
      throw new Error(`POST ${path} -> ${response.status} ${payload}`);
    }
    return payload ? JSON.parse(payload) : null;
  }

  // One classroom per state — a homeroom can only carry one live delegation per
  // day, which is the rule the screens rely on, so the states are spread across
  // rooms instead of stacked on one.
  const plans = [
    { startsAt: '07:30', endsAt: '08:30', leaveAs: 'EXPIRED' },
    { startsAt: '09:00', endsAt: '23:58', leaveAs: 'REVOKED' },
    { startsAt: '09:30', endsAt: '23:59', leaveAs: 'PENDING' },
  ];
  const issued = [];
  for (const [index, plan] of plans.entries()) {
    const room = targets[index];
    if (!room?.recipient_membership_id) continue;
    const result = await post('/api/teacher-access-grants/attendance-delegations', {
      schoolId: Number(room.school_id),
      schoolTermId: Number(room.school_term_id),
      teacherMembershipId: Number(room.recipient_membership_id),
      assignmentId: Number(room.assignment_id),
      attendanceDate: today,
      startsAt: plan.startsAt,
      endsAt: plan.endsAt,
    }).catch((error) => {
      console.log(
        `skipped classroom ${room.classroom_id} ${plan.startsAt}-${plan.endsAt}: ${error.message.slice(0, 120)}`,
      );
      return null;
    });
    if (!result?.data?.id) continue;
    issued.push({ grantId: result.data.id, classroomId: room.classroom_id, ...plan });
    if (plan.leaveAs === 'REVOKED') {
      await post(
        `/api/teacher-access-grants/attendance-delegations/${result.data.id}/revoke`,
        {},
      );
    }
  }

  await app.close();

  const verifyRunner = appDataSource.createQueryRunner();
  await verifyRunner.connect();
  const rows = await verifyRunner.query(
    `
      SELECT
        delegated.attendance_date::text AS attendance_date,
        delegated.starts_at,
        delegated.ends_at,
        CASE
          WHEN grant_row.revoked_at IS NOT NULL THEN 'REVOKED'
          WHEN delegated.ends_at < now() THEN 'EXPIRED'
          ELSE 'PENDING'
        END AS status
      FROM teacher_access_attendance_assignments delegated
      JOIN teacher_access_grants grant_row ON grant_row.id = delegated.grant_id
      WHERE delegated.classroom_id = ANY($1::bigint[])
      ORDER BY delegated.classroom_id, delegated.starts_at
    `,
    [targets.map((room) => Number(room.classroom_id))],
  );
  await verifyRunner.release();
  await appDataSource.destroy();

  console.log(`issued ${issued.length} delegation(s) through the API`);
  for (const row of rows) {
    console.log(
      `  ${row.attendance_date} ${new Date(row.starts_at).toISOString()} → ${new Date(row.ends_at).toISOString()} : ${row.status}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
