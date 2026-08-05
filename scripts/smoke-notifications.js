const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const {
  NotificationsService,
} = require('../dist/notifications/notifications.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run notifications smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorMessage(error) {
  if (error instanceof AggregateError) {
    const messages = error.errors.map((cause) => cause?.message || String(cause));
    return `AggregateError: ${messages.join(' | ')}`;
  }
  return error?.message || String(error);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const service = app.get(NotificationsService);
  const dataSource = app.get(DataSource);
  const runId = `smoke-${Date.now()}`;
  const importRefId = `${runId}-import`;
  const accountBatchRefId = `${runId}-account-batch`;
  const expiredRefId = `${runId}-retention-expired`;
  const retainedRefId = `${runId}-retention-retained`;
  let caseId;
  let refId;

  try {
    // Pick real fixtures: a school, a global admin, a school-scoped admin
    // covering that school, and one whose scope does NOT cover it.
    const schools = await dataSource.query(
      `SELECT id, name, province FROM schools ORDER BY id LIMIT 2`,
    );
    assert(schools.length === 2, 'need two schools');
    const [schoolA, schoolB] = schools;
    const enrollments = await dataSource.query(
      `SELECT student_uuid, CONCAT_WS(' ', "FirstName_Onec", "LastName_Onec") AS student_name
       FROM student_term
       WHERE "SchoolID_Onec" = $1 AND person_uuid IS NOT NULL
       ORDER BY student_uuid
       LIMIT 1`,
      [schoolA.id],
    );
    assert(enrollments.length === 1, 'need one canonical student enrollment in the smoke school');
    const [createdCase] = await dataSource.query(
      `INSERT INTO cases
         (student_uuid, student_name, school_id, student_school, reason_flagged, status)
       VALUES ($1, $2, $3, $4, $5, 'OPEN')
       RETURNING id`,
      [
        enrollments[0].student_uuid,
        enrollments[0].student_name,
        schoolA.id,
        schoolA.name,
        'ขาดเรียนติดต่อกัน 3 วัน',
      ],
    );
    caseId = createdCase.id;
    refId = String(caseId);

    const globalAdmins = await dataSource.query(
      `SELECT u.id FROM users u LEFT JOIN roles r ON r.name = u.role
       WHERE u.status='ACTIVE' AND u.data_scope->'global' = 'true'::jsonb
         AND u.data_origin_code <> 'AUTOMATED_TEST'
         AND (CASE WHEN jsonb_typeof(u.permissions)='array' AND jsonb_array_length(u.permissions)>0
              THEN u.permissions ? 'review-cases' ELSE COALESCE(r.default_permissions ? 'review-cases', FALSE) END)
         AND (CASE WHEN jsonb_typeof(u.permissions)='array' AND jsonb_array_length(u.permissions)>0
              THEN u.permissions ? 'import-data' ELSE COALESCE(r.default_permissions ? 'import-data', FALSE) END)
         AND (CASE WHEN jsonb_typeof(u.permissions)='array' AND jsonb_array_length(u.permissions)>0
              THEN u.permissions ? 'manage-student-accounts'
              ELSE COALESCE(r.default_permissions ? 'manage-student-accounts', FALSE) END)
       LIMIT 1`,
    );
    assert(globalAdmins.length === 1, 'need a global admin with notification smoke permissions');
    const globalAdminId = globalAdmins[0].id;

    const before = await dataSource.query(`SELECT COUNT(*)::int AS c FROM notifications`);

    await service.notifyCaseCreated({
      caseId,
      studentName: enrollments[0].student_name,
      schoolId: schoolA.id,
      schoolName: schoolA.name,
      reason: 'ขาดเรียนติดต่อกัน 3 วัน',
    });

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
      `SELECT title, body, student_person_uuid, case_id, student_name_masked, reason_text
       FROM notifications WHERE ref_id = $1 LIMIT 1`,
      [refId],
    );
    assert(contents[0].student_person_uuid, 'student notification must persist the person FK');
    assert(contents[0].case_id === caseId, 'case notification must persist the case FK');
    assert(contents[0].student_name_masked, 'student notification must persist the masked name');
    assert(
      contents[0].reason_text === 'ขาดเรียนติดต่อกัน 3 วัน',
      'student notification must persist the reason separately',
    );

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

    await service.notifyImportCompleted({
      batchId: importRefId,
      actorUserId: globalAdminId,
      targetLabel: 'ข้อมูลนักเรียนในระบบ (รายภาคเรียน)',
      importedRows: 12,
      quarantinedRows: 3,
    });
    const importRows = await dataSource.query(
      `SELECT recipient_user_id, type_code, body
       FROM notifications
       WHERE ref_entity = 'import' AND ref_id = $1`,
      [importRefId],
    );
    assert(importRows.length === 1, 'import event must notify only the initiating user');
    assert(importRows[0].recipient_user_id === globalAdminId, 'import recipient must be the actor');
    assert(importRows[0].type_code === 'IMPORT_COMPLETED', 'import type must be persisted');
    assert(importRows[0].body.includes('สำเร็จ 12 รายการ'), 'import summary must include result counts');

    await service.notifyStudentAccountBatchCompleted({
      jobId: accountBatchRefId,
      actorUserId: globalAdminId,
      createdCount: 20,
      skippedCount: 2,
      failedCount: 1,
    });
    const accountBatchRows = await dataSource.query(
      `SELECT recipient_user_id, type_code, body
       FROM notifications
       WHERE ref_entity = 'student-account-batch' AND ref_id = $1`,
      [accountBatchRefId],
    );
    assert(accountBatchRows.length === 1, 'account batch event must notify only the owner');
    assert(
      accountBatchRows[0].recipient_user_id === globalAdminId,
      'account batch recipient must be the owner',
    );
    assert(
      accountBatchRows[0].type_code === 'STUDENT_ACCOUNT_BATCH_COMPLETED',
      'account batch type must be persisted',
    );
    assert(
      accountBatchRows[0].body.includes('สร้าง 20 บัญชี'),
      'account batch summary must include result counts',
    );

    // Retention boundary: use a historical reference time so the smoke cannot
    // delete any current development data while still exercising real SQL.
    const retentionNow = new Date('2000-01-01T00:00:00.000Z');
    await dataSource.query(
      `INSERT INTO notifications
         (recipient_user_id, type_code, title, ref_entity, ref_id, created_at)
       VALUES
         ($1, 'IMPORT_COMPLETED', 'Retention expired fixture', 'import', $2,
          $4::timestamptz - INTERVAL '91 days'),
         ($1, 'IMPORT_COMPLETED', 'Retention retained fixture', 'import', $3,
          $4::timestamptz - INTERVAL '89 days')`,
      [globalAdminId, expiredRefId, retainedRefId, retentionNow.toISOString()],
    );

    const retentionResult = await service.cleanupExpiredNotifications(retentionNow);
    assert(retentionResult.deleted === 1, 'retention cleanup must delete only the 91-day fixture');
    const retentionRows = await dataSource.query(
      `SELECT ref_id FROM notifications WHERE ref_id = ANY($1::text[]) ORDER BY ref_id`,
      [[expiredRefId, retainedRefId]],
    );
    assert(
      retentionRows.length === 1 && retentionRows[0].ref_id === retainedRefId,
      'retention cleanup must keep the 89-day fixture',
    );

    const after = await dataSource.query(`SELECT COUNT(*)::int AS c FROM notifications`);
    console.log(
      `notifications smoke passed (${rows.length} recipients, total ${before[0].c} -> ${after[0].c})`,
    );
  } finally {
    await dataSource.query(`DELETE FROM notifications WHERE ref_id = ANY($1::text[])`, [
      [refId, importRefId, accountBatchRefId, expiredRefId, retainedRefId].filter(Boolean),
    ]);
    if (caseId) {
      await dataSource.query(`DELETE FROM cases WHERE id = $1`, [caseId]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
