/** Real PostgreSQL regression checks; fixtures live only in a rolled-back session. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { TaskRepository } = require('../dist/task/task.repository');
const { TaskPolicyService } = require('../dist/task/task-policy.service');
const { CaseRoundLineService } = require('../dist/task/case-round-line.service');
const { RiskProfileService } = require('../dist/risk-profile/risk-profile.service');

if (process.env.NODE_ENV === 'production' || process.env.DB_NAME !== 'sts_smoke') {
  throw new Error('This regression smoke requires non-production sts_smoke');
}

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RiskProfileService)
    .useValue({
      requestStudentRecalculation: async () => {},
      enqueueFull: async () => {},
      refreshDailyRecalcCron: async () => {},
    })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  // Reuse this connection so temporary fixtures shadow production tables.
  // The real repository still executes its normal SQL and bound parameters.
  const repository = new TaskRepository(
    {
      createQueryRunner: () => ({
        connect: async () => {},
        release: async () => {},
        query: (...args) => runner.query(...args),
      }),
    },
    { decrypt: () => 'FIXTURE_TOKEN_PLACEHOLDER' },
    { frontendBaseUrl: '' },
  );
  const actor = {
    id: 7,
    username: 'review_fixture',
    permissions: ['dashboard'],
    roles: ['DIRECTOR'],
    data_scope: { school_ids: [1001] },
  };
  try {
    await runner.query(`
      CREATE TEMP TABLE student_term (
        student_uuid uuid, person_uuid uuid, "GradeLevelID_Onec" int, "RoomID_Onec" int
      ) ON COMMIT DROP;
      CREATE TEMP TABLE cases (
        id int PRIMARY KEY, student_uuid uuid, school_id int, student_name text,
        student_school text, status text, workflow_phase_code text, created_by int,
        deleted_at timestamptz
      ) ON COMMIT DROP;
      CREATE TEMP TABLE tasks (
        id uuid PRIMARY KEY, case_id int, task_type text, created_at timestamptz,
        deleted_at timestamptz
      ) ON COMMIT DROP;
      CREATE TEMP TABLE task_links (
        id uuid PRIMARY KEY, task_id uuid, status text, assigned_teacher_id bigint,
        assigned_to_name text, token_encrypted text, opens_at timestamptz,
        expires_at timestamptz, assignment_note text, created_at timestamptz DEFAULT now(),
        deleted_at timestamptz, admin_locked int DEFAULT 0, updated_by int,
        line_delivery_teacher_id bigint, line_delivery_status text DEFAULT 'NOT_READY',
        line_delivery_request_id uuid, line_delivery_failure_code text,
        line_delivery_attempt_count int DEFAULT 0, line_delivery_last_attempted_at timestamptz,
        line_delivered_at timestamptz
      ) ON COMMIT DROP;
      CREATE TEMP TABLE task_submissions (
        id int, task_link_id uuid, visited_at timestamptz, submitted_at timestamptz,
        cause_detail text, follow_up_problem_category_code text,
        home_visit_exception_code text, deleted_at timestamptz
      ) ON COMMIT DROP;
      CREATE TEMP TABLE follow_up_problem_categories (code text, label_th text, guidance_th text) ON COMMIT DROP;
      CREATE TEMP TABLE home_visit_exception_options (code text, label_th text) ON COMMIT DROP;
      CREATE TEMP TABLE teachers (id bigint, teacher_status text, deleted_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE teacher_messaging_accounts (
        id int, teacher_id bigint, provider text, provider_user_id text, friend_state text,
        verified_at timestamptz, unlinked_at timestamptz, deleted_at timestamptz
      ) ON COMMIT DROP;
      CREATE TEMP TABLE case_referrals (
        id uuid, case_id int, referral_agency_id int, status_code text, referred_at timestamptz
      ) ON COMMIT DROP;
      CREATE TEMP TABLE referral_agencies (id int, agency_name text) ON COMMIT DROP;
      CREATE TEMP TABLE case_referral_results (case_referral_id uuid) ON COMMIT DROP;
      CREATE TEMP TABLE case_referral_links (
        id uuid, case_referral_id uuid, status_code text, expires_at timestamptz,
        created_at timestamptz, cancelled_at timestamptz
      ) ON COMMIT DROP;
    `);
    const personId = randomUUID();
    const studentIds = [randomUUID(), randomUUID(), randomUUID()];
    for (let index = 0; index < 3; index++) {
      const schoolId = index === 1 ? 2002 : 1001;
      await runner.query('INSERT INTO student_term VALUES ($1, $2, 101, 1)', [
        studentIds[index],
        personId,
      ]);
      await runner.query(
        `INSERT INTO cases VALUES ($1, $2, $3, 'Fixture student', 'Fixture school',
        'AWAITING_REFERRAL_OUTCOME', NULL, 7, NULL)`,
        [index + 1, studentIds[index], schoolId],
      );
      const taskId = randomUUID();
      const linkId = randomUUID();
      await runner.query(
        "INSERT INTO tasks VALUES ($1, $2, 'VISIT', now() - interval '40 days', NULL)",
        [taskId, index + 1],
      );
      await runner.query(
        `INSERT INTO task_links (id, task_id, assigned_to_name, opens_at, expires_at, status)
        VALUES ($1, $2, 'Fixture teacher', now(), now() + interval '1 day', 'ACTIVE')`,
        [linkId, taskId],
      );
      await runner.query(
        `INSERT INTO task_submissions VALUES ($1, $2, now(), now(), $3, NULL, NULL, NULL)`,
        [index + 1, linkId, `school-${schoolId}-case-${index + 1}`],
      );
    }
    const histories = await repository.listStudentFollowUpHistory(1, 5, { publicCase: true });
    assert.equal(histories.length, 2, 'public history retains both same-school cases');
    assert(histories.every((row) => row.cause_detail.startsWith('school-1001')));
    assert.equal((await repository.listStudentFollowUpHistory(1, 5, { actor })).length, 2);
    assert.equal(
      (
        await repository.listStudentFollowUpHistory(1, 5, {
          actor: { ...actor, data_scope: { global: true } },
        })
      ).length,
      3,
    );
    assert.equal(
      (await repository.listStudentFollowUpHistory(1, 5, { actor: { ...actor, data_scope: {} } }))
        .length,
      0,
    );
    assert.equal(
      (
        await repository.listStudentFollowUpHistory(1, 5, {
          actor: { ...actor, data_scope: { school_ids: [1001], room_ids: [2] } },
        })
      ).length,
      0,
    );

    // A standalone case without a school may expose only its own history.
    const standaloneTask = randomUUID();
    const standaloneLink = randomUUID();
    await runner.query("INSERT INTO cases(id, student_name) VALUES (4, 'Fixture standalone')");
    await runner.query("INSERT INTO tasks VALUES ($1, 4, 'VISIT', now(), NULL)", [standaloneTask]);
    await runner.query(
      "INSERT INTO task_links(id, task_id, assigned_to_name) VALUES ($1, $2, 'Fixture standalone')",
      [standaloneLink, standaloneTask],
    );
    await runner.query(
      "INSERT INTO task_submissions VALUES (4, $1, now(), now(), 'standalone', NULL, NULL, NULL)",
      [standaloneLink],
    );
    assert.equal(
      (await repository.listStudentFollowUpHistory(4, 5, { publicCase: true })).length,
      1,
    );

    // Aggregate deadline matrix: short, long, revoked, cancelled, answered,
    // replaced latest link, expired status and completed referral.
    const states = [
      ['short', 'ACTIVE', -1, 'REFERRED', false, false, 1],
      ['long', 'ACTIVE', 15, 'REFERRED', false, false, 0],
      ['revoked', 'REVOKED', -1, 'REFERRED', false, false, 0],
      ['cancelled', 'ACTIVE', -1, 'REFERRED', true, false, 0],
      ['answered', 'ACTIVE', -1, 'REFERRED', false, true, 0],
      ['replaced', 'ACTIVE', 15, 'REFERRED', false, false, 0],
      ['expired', 'EXPIRED', -1, 'ACCEPTED', false, false, 1],
      ['locked', 'LOCKED', -1, 'REFERRED', false, false, 1],
      ['completed', 'ACTIVE', -1, 'COMPLETED', false, false, 0],
    ];
    for (const [
      index,
      [name, linkStatus, days, referralStatus, cancelled, answered],
    ] of states.entries()) {
      const referralId = randomUUID();
      await runner.query('INSERT INTO referral_agencies VALUES ($1, $2)', [index + 1, name]);
      await runner.query(
        `INSERT INTO case_referrals VALUES ($1, 1, $2, $3, now() - interval '15 days')`,
        [referralId, index + 1, referralStatus],
      );
      if (name === 'replaced') {
        await runner.query(
          `INSERT INTO case_referral_links VALUES ($1, $2, 'REVOKED', now() - interval '1 day', now() - interval '2 days', NULL)`,
          [randomUUID(), referralId],
        );
      }
      await runner.query(
        `INSERT INTO case_referral_links VALUES ($1, $2, $3,
        now() + $4::int * interval '1 day', now(), CASE WHEN $5 THEN now() ELSE NULL END)`,
        [randomUUID(), referralId, linkStatus, days, cancelled],
      );
      if (answered)
        await runner.query('INSERT INTO case_referral_results VALUES ($1)', [referralId]);
    }
    const aggregates = await repository.getReferralAggregate(actor);
    for (const [name, , , , , , expected] of states) {
      assert.equal(
        aggregates.find((row) => row.agency_name === name)?.overdue_count,
        expected,
        `${name} deadline count`,
      );
    }
    assert.equal(
      (await repository.getReferralAggregate({ ...actor, data_scope: { school_ids: [2002] } }))
        .length,
      0,
    );

    const taskId = randomUUID();
    const linkId = randomUUID();
    await runner.query("INSERT INTO tasks VALUES ($1, 1, 'VISIT', now(), NULL)", [taskId]);
    await runner.query("INSERT INTO teachers VALUES (41, 'ACTIVE', NULL), (42, 'ACTIVE', NULL)");
    await runner.query(`INSERT INTO teacher_messaging_accounts VALUES
      (1, 41, 'LINE', 'FIXTURE_PROVIDER_PLACEHOLDER', 'FRIEND', now(), NULL, NULL)`);
    await runner.query(
      `INSERT INTO task_links (id, task_id, assigned_teacher_id, token_encrypted, opens_at, expires_at, status)
      VALUES ($1, $2, 41, 'FIXTURE_ENCRYPTED_PLACEHOLDER', now() + interval '1 day', now() + interval '2 days', 'SCHEDULED')`,
      [linkId, taskId],
    );
    let calls = 0;
    let delivered = true;
    const service = new CaseRoundLineService(
      repository,
      new TaskPolicyService(repository),
      { record: async () => {} },
      {
        isEnabled: () => true,
        sendMessages: async () => {
          calls++;
          return [{ delivered }];
        },
      },
    );
    const firstRequest = randomUUID();
    assert.equal((await service.send(1, taskId, firstRequest, actor)).data.status, 'SENT');
    assert.equal((await service.send(1, taskId, firstRequest, actor)).data.status, 'SENT');
    assert.equal(calls, 1, 'completed SENT retry does not send again');
    delivered = false;
    const failureRequest = randomUUID();
    assert.equal((await service.send(1, taskId, failureRequest, actor)).data.status, 'FAILED');
    assert.deepEqual((await service.send(1, taskId, failureRequest, actor)).data, {
      status: 'FAILED',
      failure_code: 'PROVIDER_UNAVAILABLE',
    });
    assert.equal(calls, 2, 'completed FAILED retry does not send again');
    const concurrent = await Promise.all([
      repository.claimRoundLine(linkId, '41', randomUUID(), 7),
      repository.claimRoundLine(linkId, '41', randomUUID(), 7),
    ]);
    assert.deepEqual(concurrent.map((claim) => claim.kind).sort(), ['claimed', 'in_flight']);
    for (const mutation of [
      "expires_at = now() - interval '1 second'",
      'admin_locked = 1',
      'deleted_at = now()',
      "status = 'CANCELLED'",
      'assigned_teacher_id = 42',
    ]) {
      await runner.query(
        `UPDATE task_links SET expires_at = now() + interval '1 day', admin_locked = 0,
        deleted_at = NULL, status = 'ACTIVE', assigned_teacher_id = 41, line_delivery_status = 'NOT_READY',
        line_delivery_request_id = NULL WHERE id = $1`,
        [linkId],
      );
      await runner.query(`UPDATE task_links SET ${mutation} WHERE id = $1`, [linkId]);
      const before = calls;
      assert.equal(
        (await repository.claimRoundLine(linkId, '41', randomUUID(), 7)).kind,
        'unavailable',
      );
      const outcome = await service.send(1, taskId, randomUUID(), actor).catch((error) => {
        assert.equal(error.name, 'GoneException');
        return { data: { status: 'GONE' } };
      });
      assert(['GONE', 'NOT_READY'].includes(outcome.data.status));
      assert.equal(calls, before, 'unavailable state never calls provider');
    }
    await checkConcurrentClaims(app.get(DataSource));
    console.log(
      'review findings SQL smoke passed: history scope, deadline matrix, LINE expiry/claim/replay/race',
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
}
/** Two independent sessions contend on a shared clone with the real column types/CHECKs. */
async function checkConcurrentClaims(db) {
  const fixtureSchema = `review_findings_${randomUUID().replaceAll('-', '')}`;
  const first = db.createQueryRunner();
  const second = db.createQueryRunner();
  await first.connect();
  await second.connect();
  const taskId = randomUUID();
  const linkId = randomUUID();
  try {
    await db.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of ['cases', 'tasks', 'task_links']) {
      await db.query(
        `CREATE TABLE "${fixtureSchema}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`,
      );
    }
    await db.query(
      `INSERT INTO "${fixtureSchema}".cases(id, student_name, status) VALUES (1, 'Fixture', 'OPEN')`,
    );
    await db.query(
      `INSERT INTO "${fixtureSchema}".tasks(id, case_id, task_type) VALUES ($1, 1, 'VISIT')`,
      [taskId],
    );
    await db.query(
      `INSERT INTO "${fixtureSchema}".task_links(id, task_id, status, assigned_to_name,
      assigned_teacher_id, token_hash, expires_at)
      VALUES ($1, $2, 'ACTIVE', 'Fixture teacher', 41, 'FIXTURE_HASH_PLACEHOLDER', now() + interval '1 day')`,
      [linkId, taskId],
    );
    for (const connection of [first, second])
      await connection.query(`SET search_path TO "${fixtureSchema}", public`);
    const repoFor = (connection) =>
      new TaskRepository(
        {
          createQueryRunner: () => ({
            connect: async () => {},
            release: async () => {},
            query: (...args) => connection.query(...args),
          }),
        },
        {},
        {},
      );
    const outcomes = await Promise.all([
      repoFor(first).claimRoundLine(linkId, '41', randomUUID(), null),
      repoFor(second).claimRoundLine(linkId, '41', randomUUID(), null),
    ]);
    assert.deepEqual(
      outcomes.map((result) => result.kind).sort(),
      ['claimed', 'in_flight'],
      'two sessions must claim once',
    );
    const [row] = await db.query(
      `SELECT line_delivery_attempt_count FROM "${fixtureSchema}".task_links WHERE id = $1`,
      [linkId],
    );
    assert.equal(row.line_delivery_attempt_count, 1);
  } finally {
    for (const connection of [first, second]) {
      await connection.query('SET search_path TO public');
      await connection.release();
    }
    await db.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
  }
}

main().catch((error) => {
  // Do not expose SQL, fixtures, identities or transport payloads on failure.
  console.error(`review findings smoke failed: ${error.name}`);
  if (error instanceof assert.AssertionError) console.error(error.message);
  process.exitCode = 1;
});
