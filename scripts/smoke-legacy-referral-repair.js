/** Regression of the local repair's actual SQL on TEMP tables, always rolled back. */
const assert = require('node:assert/strict');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const {
  repairLegacyReferralCases,
  caseFingerprint,
  LEGACY_CASE_IDS,
} = require('./repair-legacy-referral-cases');

async function main() {
  if (process.env.NODE_ENV === 'production' || !(process.env.DB_NAME || '').endsWith('_smoke')) {
    throw new Error('This regression requires a non-production *_smoke database');
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const db = app.get(DataSource);
  assert.ok(String(db.options.database).endsWith('_smoke'));
  const runner = db.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query('SET LOCAL search_path TO pg_temp, public');
    for (const table of [
      `cases (id int PRIMARY KEY, student_uuid uuid, school_id int, created_at timestamptz,
        updated_at timestamptz, deleted_at timestamptz, status text, completion_outcome_code text, result_summary text)`,
      `case_referrals (id uuid PRIMARY KEY, case_id int, referred_at timestamptz,
        referral_agency_id int, referred_by_user_id int, status_code text)`,
      `case_reviews (case_id int, review_action text)`,
      `student_term (student_uuid uuid PRIMARY KEY, classroom_id int)`,
      `classroom_homeroom_teachers (classroom_id int, teacher_membership_id int, created_at timestamptz)`,
      `school_teacher_memberships (id int PRIMARY KEY, teacher_id int)`,
      `teachers (id int PRIMARY KEY, first_name text, last_name text, email text)`,
      `tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id int, status text,
        task_type text, target_school_id int, created_at timestamptz, updated_at timestamptz,
        created_by int, updated_by int, deleted_at timestamptz)`,
      `task_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, token_hash text,
        token_encrypted text, assigned_to_name text, assigned_to_email text, assigned_teacher_id int,
        status text, admin_locked int, expires_at timestamptz, created_at timestamptz,
        updated_at timestamptz, created_by int, updated_by int)`,
      `task_submissions (task_link_id uuid, cause_detail text, recommendation text,
        submitted_at timestamptz, address_changed bool, created_at timestamptz, updated_at timestamptz,
        case_follow_up_decision text, visited_at timestamptz, task_execution_outcome_code text)`,
    ])
      await runner.query(`CREATE TEMP TABLE ${table} ON COMMIT DROP`);

    // A fixture boundary wraps the production callback in a real savepoint.
    const fixtureDb = {
      transaction: async (work) => {
        await runner.query('SAVEPOINT repair');
        try {
          const result = await work({ query: (sql, params) => runner.query(sql, params) });
          await runner.query('RELEASE SAVEPOINT repair');
          return result;
        } catch (error) {
          await runner.query('ROLLBACK TO SAVEPOINT repair');
          await runner.query('RELEASE SAVEPOINT repair');
          throw error;
        }
      },
    };
    const encryption = { encrypt: () => 'TEST_ENCRYPTED_TOKEN_PLACEHOLDER' };
    const allIds = [...LEGACY_CASE_IDS, 9001];
    for (const id of allIds) {
      const studentUuid = `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
      const referralId = `10000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
      await runner.query(
        `INSERT INTO cases
        (id, student_uuid, school_id, created_at, updated_at, status)
        VALUES ($1, $2, 77, '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z', 'RESOLVED')`,
        [id, studentUuid],
      );
      await runner.query(
        `INSERT INTO case_referrals VALUES ($1, $2, '2026-01-04T00:00:00Z', 1, 1, 'NOT_SUCCEEDED')`,
        [referralId, id],
      );
      await runner.query('INSERT INTO student_term VALUES ($1, 1)', [studentUuid]);
    }
    await runner.query(
      `INSERT INTO teachers VALUES (1, 'Fixture', 'Teacher', 'fixture@example.invalid')`,
    );
    await runner.query('INSERT INTO school_teacher_memberships VALUES (1, 1)');
    await runner.query(
      `INSERT INTO classroom_homeroom_teachers VALUES (1, 1, '2026-01-01T00:00:00Z')`,
    );
    const fingerprintRows = () =>
      runner.query(
        `SELECT c.id, c.student_uuid::text AS student_uuid,
      c.school_id, c.created_at, r.id AS referral_id, r.referred_at, r.referral_agency_id,
      r.referred_by_user_id FROM cases c JOIN case_referrals r ON r.case_id=c.id
      WHERE c.id=ANY($1::int[]) ORDER BY c.id`,
        [LEGACY_CASE_IDS],
      );
    const expected = Object.fromEntries(
      (await fingerprintRows()).map((row) => [row.id, caseFingerprint(row)]),
    );
    const run = (apply = true, fingerprints = expected) =>
      repairLegacyReferralCases(fixtureDb, encryption, apply, fingerprints);
    const counts = async () =>
      (
        await runner.query(`SELECT
      (SELECT count(*)::int FROM tasks) AS tasks,
      (SELECT count(*)::int FROM task_links) AS links,
      (SELECT count(*)::int FROM task_submissions) AS submissions`)
      )[0];

    // The CLI snapshot must reject a different dataset even when case IDs match.
    await assert.rejects(repairLegacyReferralCases(fixtureDb, encryption, true), /fingerprint/);
    assert.deepEqual(await counts(), { tasks: 0, links: 0, submissions: 0 });
    await run(false);
    assert.deepEqual(await counts(), { tasks: 0, links: 0, submissions: 0 });

    for (const mutation of ['student_uuid = gen_random_uuid()', 'school_id = 78']) {
      await runner.query('SAVEPOINT mismatch');
      await runner.query(`UPDATE cases SET ${mutation} WHERE id=3321`);
      await assert.rejects(run(), /fingerprint/);
      assert.deepEqual(await counts(), { tasks: 0, links: 0, submissions: 0 });
      await runner.query('ROLLBACK TO SAVEPOINT mismatch');
    }
    await runner.query('SAVEPOINT referral_mismatch');
    await runner.query('UPDATE case_referrals SET referral_agency_id=2 WHERE case_id=3321');
    await assert.rejects(run(), /fingerprint/);
    await runner.query('ROLLBACK TO SAVEPOINT referral_mismatch');
    await runner.query('SAVEPOINT missing_case');
    await runner.query('DELETE FROM case_referrals WHERE case_id=3328');
    await assert.rejects(run(), /incomplete/);
    await runner.query('ROLLBACK TO SAVEPOINT missing_case');

    // The last case fails after the earlier seven wrote: the whole run rolls back.
    await runner.query('SAVEPOINT bad_timing');
    await runner.query(
      `UPDATE case_referrals SET referred_at='2026-01-01T12:00:00Z' WHERE case_id=3328`,
    );
    const badTimingExpected = Object.fromEntries(
      (await fingerprintRows()).map((row) => [row.id, caseFingerprint(row)]),
    );
    await assert.rejects(run(true, badTimingExpected), /no room/);
    assert.deepEqual(await counts(), { tasks: 0, links: 0, submissions: 0 });
    assert.equal(
      (
        await runner.query(
          'SELECT count(*)::int AS count FROM cases WHERE result_summary IS NOT NULL',
        )
      )[0].count,
      0,
    );
    await runner.query('ROLLBACK TO SAVEPOINT bad_timing');

    assert.equal((await run()).length, 8);
    assert.deepEqual(await counts(), { tasks: 8, links: 8, submissions: 8 });
    assert.equal(
      (
        await runner.query(
          "SELECT count(*)::int AS count FROM cases WHERE id=ANY($1::int[]) AND status='PENDING_REVIEW'",
          [LEGACY_CASE_IDS],
        )
      )[0].count,
      8,
    );
    assert.equal((await run()).length, 0);
    assert.deepEqual(await counts(), { tasks: 8, links: 8, submissions: 8 });
    const [outside] = await runner.query('SELECT status, result_summary FROM cases WHERE id=9001');
    assert.deepEqual(outside, { status: 'RESOLVED', result_summary: null });
    assert.equal(
      (await runner.query('SELECT count(*)::int AS count FROM tasks WHERE case_id=9001'))[0].count,
      0,
    );
    console.log(
      'PASS legacy repair: bounded cohort, identity mismatch, dry-run, rollback, run twice; TEMP tables rolled back',
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
