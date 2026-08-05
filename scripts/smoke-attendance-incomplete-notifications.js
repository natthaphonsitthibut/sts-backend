const { randomUUID } = require('crypto');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { AttendanceOperationsService } = require('../dist/attendance/attendance-operations.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run attendance incomplete notifications smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const TYPE_CODE = 'ATTENDANCE_INCOMPLETE';
const SCHOOL_ID = 10010009;
const GRADE_LEVEL_ID = 101;
const ROOM_ID = 1;
const SCHOOL_TERM_ID = 2;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function returningRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

// ATTENDANCE_INCOMPLETE type + attendance_sessions.anomaly_notified_at are both
// brand-new and this cron has never run, so every value below is created by this
// smoke — cleanup can clear all of them to restore seed state.
async function cleanup(dataSource, sessionId) {
  await dataSource.query(`DELETE FROM notifications WHERE type_code = $1`, [TYPE_CODE]);
  await dataSource.query(
    `UPDATE attendance_sessions SET anomaly_notified_at = NULL WHERE anomaly_notified_at IS NOT NULL`,
  );
  if (sessionId) {
    await dataSource.query(`DELETE FROM attendance_sessions WHERE id = $1::uuid`, [sessionId]);
  }
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const dataSource = app.get(DataSource);
  const operations = app.get(AttendanceOperationsService);
  const now = new Date();
  const sessionId = randomUUID();

  try {
    // A real (non-test) staff user with global scope + 'attendance' — covers any
    // school/grade/room, so it must be a recipient of the incomplete reminder.
    const [recipient] = await dataSource.query(
      `SELECT u.id
       FROM users u LEFT JOIN roles r ON r.name = u.role
       WHERE u.status = 'ACTIVE' AND u.role <> 'STUDENT' AND u.data_origin_code <> 'AUTOMATED_TEST'
         AND u.data_scope->'global' = 'true'::jsonb
         AND (CASE WHEN jsonb_typeof(u.permissions) = 'array' AND jsonb_array_length(u.permissions) > 0
                THEN u.permissions ? 'attendance'
                ELSE COALESCE(r.default_permissions ? 'attendance', FALSE) END)
       LIMIT 1`,
    );
    assert(recipient?.id, 'No real global attendance user exists to receive the reminder');
    const recipientId = Number(recipient.id);

    await cleanup(dataSource, null);
    // A past-date session that was started but left incomplete (3 of 10 recorded).
    await dataSource.query(
      `INSERT INTO attendance_sessions
         (id, school_term_id, school_id, grade_level_id, room_id, attendance_date, period,
          session_kind, status, expected_roster_count, recorded_count)
       VALUES ($1::uuid, $2, $3, $4, $5, DATE '2026-01-05', 1, 'DAILY', 'SUBMITTED', 10, 3)`,
      [sessionId, SCHOOL_TERM_ID, SCHOOL_ID, GRADE_LEVEL_ID, ROOM_ID],
    );

    const first = await operations.remindIncompleteSessions(now);
    assert(first.notified >= 1, 'Incomplete-attendance reminder did not notify anyone');

    const [flagged] = await dataSource.query(
      `SELECT anomaly_notified_at FROM attendance_sessions WHERE id = $1::uuid`,
      [sessionId],
    );
    assert(flagged?.anomaly_notified_at, 'Session was not flagged after the reminder');

    const [note] = returningRows(
      await dataSource.query(
        `SELECT id FROM notifications WHERE type_code = $1 AND ref_entity = 'attendance' AND ref_id = $2 AND recipient_user_id = $3`,
        [TYPE_CODE, sessionId, recipientId],
      ),
    );
    assert(note?.id, 'The in-scope attendance staff did not receive an incomplete-session notification');

    // Fan-out creates one row per in-scope recipient for this session.
    const [before] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE type_code = $1 AND ref_id = $2`,
      [TYPE_CODE, sessionId],
    );
    // Idempotent: a second pass re-claims nothing and adds no new notifications.
    const second = await operations.remindIncompleteSessions(now);
    assert(second.notified === 0, `Second pass re-claimed ${second.notified} sessions, expected 0`);
    const [after] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE type_code = $1 AND ref_id = $2`,
      [TYPE_CODE, sessionId],
    );
    assert(
      after.count === before.count,
      `Second pass changed notification count ${before.count} -> ${after.count}`,
    );

    console.log(
      JSON.stringify({
        status: 'attendance_incomplete_notifications_smoke_ok',
        firstPassNotified: first.notified,
        secondPassNotified: second.notified,
        checked: [
          'past-date incomplete session reminds in-scope attendance staff once',
          'session flagged anomaly_notified_at after reminding',
          'notification not resent on the next pass (idempotent)',
        ],
      }),
    );
  } finally {
    await cleanup(dataSource, sessionId);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
