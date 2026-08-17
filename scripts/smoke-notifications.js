const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { NotificationsService } = require('../dist/notifications/notifications.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run notifications smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
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
  const runId = `notification-smoke-${Date.now()}`;
  const expiredRefId = `${runId}-expired`;
  const retainedRefId = `${runId}-retained`;
  let caseId;
  let reviewerId;

  try {
    const [enrollment] = await dataSource.query(
      `SELECT enrollment.student_uuid, enrollment.person_uuid,
              enrollment."SchoolID_Onec" AS school_id,
              school.name AS school_name,
              CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec") AS student_name
       FROM student_term enrollment
       INNER JOIN schools school ON school.id = enrollment."SchoolID_Onec"
       WHERE enrollment.person_uuid IS NOT NULL
       ORDER BY enrollment.student_uuid
       LIMIT 1`,
    );
    assert(enrollment, 'need one canonical student enrollment');

    const [createdCase] = await dataSource.query(
      `INSERT INTO cases
         (student_uuid, student_name, school_id, student_school, reason_flagged, status)
       VALUES ($1, $2, $3, $4, $5, 'OPEN')
       RETURNING id`,
      [
        enrollment.student_uuid,
        enrollment.student_name,
        enrollment.school_id,
        enrollment.school_name,
        'ขาดเรียนติดต่อกัน 3 วัน',
      ],
    );
    caseId = createdCase.id;
    const [reviewer] = await dataSource.query(
      `INSERT INTO users
         (username, password, "FirstName", "LastName", status, permissions, role,
          data_scope, must_change_password, data_origin_code)
       VALUES ($1, 'smoke-unused-password', 'Notification', 'Smoke', 'ACTIVE',
               '["review-cases"]'::jsonb, 'ADMIN', '{"global":true}'::jsonb, FALSE, 'DEMO')
       RETURNING id`,
      [`${runId}-reviewer`],
    );
    reviewerId = reviewer.id;

    const before = await dataSource.query(`SELECT COUNT(*)::int AS count FROM notifications`);
    const recipients = await service.notifyCaseStatusChanged({
      caseId,
      studentName: enrollment.student_name,
      schoolId: enrollment.school_id,
      nextStatus: 'OPEN',
      actorUserId: null,
    });
    assert(recipients.includes(reviewerId), 'case-status notification must reach the scoped reviewer');

    const rows = await dataSource.query(
      `SELECT type_code, case_id, case_status_code, student_person_uuid, student_name_masked
       FROM notifications
       WHERE case_id = $1 AND ref_id = $1::text`,
      [caseId],
    );
    assert(rows.length > 0, 'case-status notification was not persisted');
    assert(rows.every((row) => row.type_code === 'CASE_STATUS_CHANGED'), 'legacy type code persisted');
    assert(rows.every((row) => row.case_status_code === 'OPEN'), 'status code was not persisted');
    assert(rows.every((row) => row.case_id === caseId), 'case FK was not persisted');
    assert(rows.every((row) => row.student_name_masked), 'masked student name was not persisted');

    const targetRecipientId = reviewerId;
    const inbox = await service.listForUser(targetRecipientId, {});
    const target = inbox.rows.find((row) => row.case_id === caseId);
    assert(target, 'recipient inbox does not contain the case notification');
    assert(target.case_status_code === 'OPEN', 'inbox did not expose the case status code');

    await service.markAllSeen(targetRecipientId);
    const seenInbox = await service.listForUser(targetRecipientId, {});
    assert(seenInbox.unseenCount === 0, 'bell count must clear after items are seen');
    await service.markRead(targetRecipientId, target.id);
    const unreadInbox = await service.listForUser(targetRecipientId, { unreadOnly: true });
    assert(!unreadInbox.rows.some((row) => row.id === target.id), 'read item remained unread');

    const retentionNow = new Date('2000-01-01T00:00:00.000Z');
    await dataSource.query(
      `INSERT INTO notifications
        (recipient_user_id, type_code, title, ref_entity, ref_id, created_at,
         case_id, case_status_code, student_name_masked)
       VALUES
        ($1, 'CASE_STATUS_CHANGED', 'Retention expired', 'case', $2,
         $4::timestamptz - INTERVAL '91 days', $5, 'OPEN', 'นร.****'),
        ($1, 'CASE_STATUS_CHANGED', 'Retention retained', 'case', $3,
         $4::timestamptz - INTERVAL '89 days', $5, 'OPEN', 'นร.****')`,
      [targetRecipientId, expiredRefId, retainedRefId, retentionNow.toISOString(), caseId],
    );
    const retention = await service.cleanupExpiredNotifications(retentionNow);
    assert(retention.deleted === 1, 'retention must delete only the expired case notification');
    const retained = await dataSource.query(
      `SELECT ref_id FROM notifications WHERE ref_id = $1`,
      [retainedRefId],
    );
    assert(retained.length === 1, 'retention deleted the 89-day notification');

    const after = await dataSource.query(`SELECT COUNT(*)::int AS count FROM notifications`);
    console.log(
      `notifications smoke passed (${recipients.length} recipients, total ${before[0].count} -> ${after[0].count})`,
    );
  } finally {
    if (caseId) {
      await dataSource.query(`DELETE FROM notifications WHERE case_id = $1`, [caseId]);
      await dataSource.query(`DELETE FROM cases WHERE id = $1`, [caseId]);
    }
    if (reviewerId) {
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [reviewerId]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
