const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const {
  NotificationsService,
} = require('../dist/notifications/notifications.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run notifications smoke with NODE_ENV=production');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const service = app.get(NotificationsService);
  const dataSource = app.get(DataSource);
  const refId = `smoke-${Date.now()}`;

  try {
    // Pick real fixtures: a school, a global admin, a school-scoped admin
    // covering that school, and one whose scope does NOT cover it.
    const schools = await dataSource.query(
      `SELECT id, name, province FROM schools ORDER BY id LIMIT 2`,
    );
    assert(schools.length === 2, 'need two schools');
    const [schoolA, schoolB] = schools;

    const globalAdmins = await dataSource.query(
      `SELECT u.id FROM users u LEFT JOIN roles r ON r.name = u.role
       WHERE u.status='ACTIVE' AND u.data_scope->'global' = 'true'::jsonb
         AND u.data_origin_code <> 'AUTOMATED_TEST'
         AND (CASE WHEN jsonb_typeof(u.permissions)='array' AND jsonb_array_length(u.permissions)>0
              THEN u.permissions ? 'review-cases' ELSE COALESCE(r.default_permissions ? 'review-cases', FALSE) END)
       LIMIT 1`,
    );
    assert(globalAdmins.length === 1, 'need a global admin with review-cases');
    const globalAdminId = globalAdmins[0].id;

    const before = await dataSource.query(`SELECT COUNT(*)::int AS c FROM notifications`);

    await service.notifyCaseCreated({
      caseId: 999999,
      studentName: 'ทดสอบ ระบบแจ้งเตือน',
      schoolId: schoolA.id,
      schoolName: schoolA.name,
      reason: 'ขาดเรียนติดต่อกัน 3 วัน',
    });
    // Overwrite ref for precise cleanup: fan-out uses caseId as ref, so patch rows.
    await dataSource.query(
      `UPDATE notifications SET ref_id = $1 WHERE ref_entity='case' AND ref_id='999999'`,
      [refId],
    );

    const rows = await dataSource.query(
      `SELECT n.recipient_user_id, u.data_scope, u.role
       FROM notifications n JOIN users u ON u.id = n.recipient_user_id
       WHERE n.ref_id = $1`,
      [refId],
    );
    assert(rows.length > 0, 'fan-out must reach at least the global admin');
    assert(
      rows.some((r) => r.recipient_user_id === globalAdminId),
      'global admin must receive the notification',
    );
    for (const row of rows) {
      assert(row.role !== 'STUDENT', 'students must not receive notifications');
      const scope = row.data_scope || {};
      const covered =
        scope.global === true ||
        (Array.isArray(scope.school_ids) &&
          scope.school_ids.map(String).includes(String(schoolA.id))) ||
        (Array.isArray(scope.provinces) && scope.provinces.includes(schoolA.province)) ||
        Array.isArray(scope.districts) ||
        Array.isArray(scope.sub_districts);
      assert(covered, `recipient ${row.recipient_user_id} scope does not cover the event school`);
    }

    // Users scoped to a different school only must NOT be recipients.
    const otherSchoolOnly = await dataSource.query(
      `SELECT u.id FROM users u
       WHERE u.status='ACTIVE'
         AND jsonb_typeof(u.data_scope->'school_ids')='array'
         AND u.data_scope->'school_ids' @> to_jsonb($1::int)
         AND NOT (u.data_scope->'school_ids' @> to_jsonb($2::int))
         AND NOT (u.data_scope ? 'provinces')`,
      [schoolB.id, schoolA.id],
    );
    for (const user of otherSchoolOnly) {
      assert(
        !rows.some((r) => r.recipient_user_id === user.id),
        `user ${user.id} scoped to another school must not receive it`,
      );
    }

    // PII: title/body must not contain the raw full name.
    const contents = await dataSource.query(
      `SELECT title, body FROM notifications WHERE ref_id = $1 LIMIT 1`,
      [refId],
    );
    assert(!`${contents[0].title} ${contents[0].body}`.includes('ระบบแจ้งเตือน'), 'body must mask the name');

    // Inbox API behaviour for the global admin.
    const list1 = await service.listForUser(globalAdminId, {});
    assert(list1.unreadCount >= 1 && list1.unseenCount >= 1, 'admin must have unread+unseen');
    const target = list1.rows.find((r) => r.ref_id === refId);
    assert(target, 'admin list must contain the smoke notification');

    await service.markAllSeen(globalAdminId);
    const list2 = await service.listForUser(globalAdminId, {});
    assert(list2.unseenCount === 0, 'badge (unseen) must clear after seen');
    assert(list2.unreadCount >= 1, 'unread must persist after seen');

    await service.markRead(globalAdminId, target.id);
    const list3 = await service.listForUser(globalAdminId, { unreadOnly: true });
    assert(!list3.rows.some((r) => r.id === target.id), 'read item must leave unread filter');

    // Another recipient's read state must be untouched.
    const other = rows.find((r) => r.recipient_user_id !== globalAdminId);
    if (other) {
      const otherRows = await dataSource.query(
        `SELECT read_at FROM notifications WHERE ref_id=$1 AND recipient_user_id=$2`,
        [refId, other.recipient_user_id],
      );
      assert(otherRows[0].read_at === null, 'other recipient read state must be independent');
    }

    await service.markAllRead(globalAdminId);
    const list4 = await service.listForUser(globalAdminId, {});
    assert(list4.unreadCount === 0, 'read-all must clear unread');

    const after = await dataSource.query(`SELECT COUNT(*)::int AS c FROM notifications`);
    console.log(
      `notifications smoke passed (${rows.length} recipients, total ${before[0].c} -> ${after[0].c})`,
    );
  } finally {
    await dataSource.query(`DELETE FROM notifications WHERE ref_id = $1`, [refId]);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
