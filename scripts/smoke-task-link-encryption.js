const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { TaskService } = require('../dist/task/task.service');
const { TaskAccessService } = require('../dist/task/task-access.service');
const { TaskRepository } = require('../dist/task/task.repository');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run task-link encryption smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const ACTOR = {
  id: 1,
  username: 'task_link_encryption_smoke',
  roles: ['ADMIN'],
  permissions: ['create'],
  data_scope: { global: true },
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const taskService = app.get(TaskService);
  const taskAccessService = app.get(TaskAccessService);
  const taskRepository = app.get(TaskRepository);

  const createdTaskIds = [];

  try {
    // 1. Create a task link through the real service (encrypt path).
    const created = await taskService.createTask(
      ACTOR,
      {
        task_type: 'VISIT',
        assigned_to_name: 'Task Link Encryption Smoke',
        student_name: 'Smoke Test Student',
      },
      'http://127.0.0.1:5174',
    );
    const taskId = created.task_id || created.id;
    assert(taskId, `createTask did not return a task id: ${JSON.stringify(created)}`);
    createdTaskIds.push(taskId);
    assert(
      typeof created.magic_link === 'string' && created.magic_link.includes('/task/'),
      `createTask response did not include a magic_link: ${JSON.stringify(created)}`,
    );
    const rawToken = created.magic_link.split('/').pop();
    assert(rawToken && rawToken.length > 0, 'Could not extract raw token from magic_link');

    // 2. DB-level: new rows must carry token_encrypted and NOT a plaintext magic_link.
    const [dbRow] = await dataSource.query(
      `SELECT magic_link, token_encrypted, token_hash FROM task_links WHERE task_id = $1`,
      [taskId],
    );
    assert(dbRow, 'No task_links row found for the created task');
    assert(dbRow.magic_link === null, `Expected magic_link to be NULL on a new row, got: ${dbRow.magic_link}`);
    assert(
      typeof dbRow.token_encrypted === 'string' && dbRow.token_encrypted.startsWith('v1:'),
      `Expected an encrypted token_encrypted value, got: ${dbRow.token_encrypted}`,
    );
    assert(
      !dbRow.token_encrypted.includes(rawToken),
      'token_encrypted must not contain the raw token in plaintext',
    );

    // 3. Repository read path: listTaskLinksByTaskId must decrypt back to a working URL.
    const chainLinks = await taskRepository.listTaskLinksByTaskId(taskId);
    assert(chainLinks.length === 1, `Expected 1 link in the chain, got ${chainLinks.length}`);
    // Read-time reconstruction deliberately uses the configured FRONTEND_BASE_URL,
    // not whatever baseUrl happened to be passed at creation time (a live request's
    // host) — the frontend's own normalizeTaskPublicLink() rewrites the origin
    // anyway, so only the /task/<token> path needs to match.
    assert(
      chainLinks[0].magic_link.endsWith(`/task/${rawToken}`),
      `Decrypted magic_link did not resolve to the right token: ${chainLinks[0].magic_link}`,
    );

    // 4. The raw token extracted from the (decrypted, reconstructed) magic_link must
    // still resolve via the unaffected token_hash login-validation path.
    const fetchedTask = await taskService.getTaskByToken(rawToken, undefined);
    assert(fetchedTask && fetchedTask.task_id === taskId, 'Raw token did not resolve back to the created task');

    // 5. A garbage/unknown token must still fail cleanly (no crash on decrypt of
    // arbitrary input reaching the login path).
    const missing = await taskService.getTaskByToken('not-a-real-token', undefined);
    assert(!missing || missing.error, 'An invalid token unexpectedly resolved to a task');

    console.log('task-link encryption smoke passed');
  } finally {
    if (createdTaskIds.length > 0) {
      await dataSource.query(`DELETE FROM task_links WHERE task_id = ANY($1::uuid[])`, [
        createdTaskIds,
      ]);
      await dataSource.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [createdTaskIds]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
