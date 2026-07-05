const { randomBytes } = require('crypto');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { TaskLifecycleService } = require('../dist/task/task-lifecycle.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run task overdue notifications smoke with NODE_ENV=production');
}

const TYPE_CODE = 'TASK_OVERDUE';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function returningRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

// TASK_OVERDUE is a brand-new type and this cron has never run in sts_smoke, so
// every overdue_notified_at flag and TASK_OVERDUE notification below is created
// by this smoke — cleanup can safely clear all of them to restore state.
async function cleanup(dataSource, linkId) {
  await dataSource.query(`DELETE FROM notifications WHERE type_code = $1`, [TYPE_CODE]);
  await dataSource.query(`UPDATE task_links SET overdue_notified_at = NULL WHERE overdue_notified_at IS NOT NULL`);
  if (linkId) {
    await dataSource.query(`DELETE FROM task_links WHERE id = $1`, [linkId]);
  }
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const dataSource = app.get(DataSource);
  const lifecycle = app.get(TaskLifecycleService);
  const now = new Date();
  const linkId = `overdue-task-smoke-${now.getTime()}`;

  try {
    // A real (non-test) staff user with 'create' permission — the assigner who
    // must be reminded (fan-out to a test-tagged account would be filtered out).
    const [recipient] = await dataSource.query(
      `SELECT u.id
       FROM users u
       LEFT JOIN roles r ON r.name = u.role
       WHERE u.status = 'ACTIVE' AND u.role <> 'STUDENT' AND u.data_origin_code <> 'AUTOMATED_TEST'
         AND (CASE WHEN jsonb_typeof(u.permissions) = 'array' AND jsonb_array_length(u.permissions) > 0
                THEN u.permissions ? 'create'
                ELSE COALESCE(r.default_permissions ? 'create', FALSE) END)
       LIMIT 1`,
    );
    assert(recipient?.id, 'No real create-permission user exists to receive the reminder');
    const recipientId = Number(recipient.id);

    await cleanup(dataSource, null);
    // An ACTIVE, already-expired link with no completion → overdue. task_id NULL
    // so the notification ref is the (unique) link id, keeping the assert precise.
    await dataSource.query(
      `INSERT INTO task_links (id, token_hash, status, expires_at, created_by, assigned_to_name, otp_attempts)
       VALUES ($1, $2, 'ACTIVE', $3, $4, $5, 0)`,
      [linkId, randomBytes(32).toString('hex'), new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), recipientId, 'สมชาย เยี่ยมบ้าน'],
    );

    const first = await lifecycle.remindOverdueTaskLinks(now);
    assert(first.notified >= 1, 'Overdue reminder did not notify anyone');

    const [notified] = await dataSource.query(
      `SELECT overdue_notified_at FROM task_links WHERE id = $1`,
      [linkId],
    );
    assert(notified?.overdue_notified_at, 'Overdue link was not flagged after the reminder');

    const [note] = returningRows(
      await dataSource.query(
        `SELECT id FROM notifications WHERE type_code = $1 AND ref_entity = 'task' AND ref_id = $2 AND recipient_user_id = $3`,
        [TYPE_CODE, linkId, recipientId],
      ),
    );
    assert(note?.id, 'The assigning staff did not receive an overdue notification');

    // Idempotent: a second pass must not re-remind the already-flagged link.
    const second = await lifecycle.remindOverdueTaskLinks(now);
    const [stillOne] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE type_code = $1 AND ref_id = $2`,
      [TYPE_CODE, linkId],
    );
    assert(stillOne.count === 1, `Overdue link was reminded ${stillOne.count} times, expected once`);

    console.log(
      JSON.stringify({
        status: 'task_overdue_notifications_smoke_ok',
        firstPassNotified: first.notified,
        secondPassNotified: second.notified,
        checked: [
          'expired ACTIVE link reminds the assigning staff once',
          'link is flagged overdue_notified_at after reminding',
          'notification is not resent on the next pass (idempotent)',
        ],
      }),
    );
  } finally {
    await cleanup(dataSource, linkId);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
