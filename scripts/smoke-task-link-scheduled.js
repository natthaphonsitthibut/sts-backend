const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { TaskService } = require('../dist/task/task.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run task-link scheduled smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const ACTOR = {
  id: 1,
  username: 'task_link_scheduled_smoke',
  roles: ['ADMIN'],
  permissions: ['create'],
  data_scope: { global: true },
};

const BASE_URL = 'http://127.0.0.1:5174';
const HOUR_MS = 60 * 60 * 1000;

async function createLink(taskService, opensAt) {
  return taskService.createTask(
    ACTOR,
    {
      task_type: 'VISIT',
      assigned_to_name: 'Task Link Scheduled Smoke',
      student_name: 'Smoke Test Student',
      expires_value: '7',
      expires_unit: 'days',
      opens_at: opensAt,
    },
    BASE_URL,
  );
}

function tokenOf(created) {
  assert(
    typeof created.magic_link === 'string' && created.magic_link.includes('/task/'),
    `createTask did not return a magic_link: ${JSON.stringify(created)}`,
  );
  return created.magic_link.split('/').pop();
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const taskService = app.get(TaskService);

  const createdTaskIds = [];

  try {
    // 1. A link scheduled to open in the future must NOT be redeemable and must
    //    report SCHEDULED — never resolving to a usable task shape.
    const futureIso = new Date(Date.now() + HOUR_MS).toISOString();
    const futureLink = await createLink(taskService, futureIso);
    const futureTaskId = futureLink.task_id || futureLink.id;
    createdTaskIds.push(futureTaskId);
    const futureToken = tokenOf(futureLink);

    const [futureRow] = await dataSource.query(
      `SELECT opens_at FROM task_links WHERE task_id = $1`,
      [futureTaskId],
    );
    assert(futureRow && futureRow.opens_at, 'Scheduled link did not persist opens_at');

    const blocked = await taskService.getTaskByToken(futureToken, undefined);
    assert(
      blocked && blocked.error && blocked.status === 'SCHEDULED',
      `A not-yet-open link must be rejected as SCHEDULED, got: ${JSON.stringify(blocked)}`,
    );
    assert(
      !blocked.task_id,
      'A not-yet-open link must not resolve to a usable task shape',
    );

    // 2. A link whose opens_at is already in the past redeems normally.
    const pastIso = new Date(Date.now() - HOUR_MS).toISOString();
    const openLink = await createLink(taskService, pastIso);
    const openTaskId = openLink.task_id || openLink.id;
    createdTaskIds.push(openTaskId);
    const openToken = tokenOf(openLink);

    const resolved = await taskService.getTaskByToken(openToken, undefined);
    assert(
      resolved && !resolved.error && resolved.task_id === openTaskId,
      `An already-open link should resolve to its task, got: ${JSON.stringify(resolved)}`,
    );

    // 3. A link with no opens_at (the default) also redeems immediately.
    const plainLink = await createLink(taskService, undefined);
    const plainTaskId = plainLink.task_id || plainLink.id;
    createdTaskIds.push(plainTaskId);
    const plainResolved = await taskService.getTaskByToken(tokenOf(plainLink), undefined);
    assert(
      plainResolved && !plainResolved.error && plainResolved.task_id === plainTaskId,
      `A link with no opens_at should resolve immediately, got: ${JSON.stringify(plainResolved)}`,
    );

    console.log('task-link scheduled smoke passed');
  } finally {
    if (createdTaskIds.length > 0) {
      await dataSource.query(`DELETE FROM task_links WHERE task_id = ANY($1::text[])`, [
        createdTaskIds,
      ]);
      await dataSource.query(`DELETE FROM tasks WHERE id = ANY($1::text[])`, [createdTaskIds]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
