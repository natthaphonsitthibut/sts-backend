/** Guardian migration proof on temporary tables; every change rolls back. */
require('dotenv/config');
const assert = require('node:assert/strict');
const db = require('../dist/database/typeorm.datasource').default;
const { AllowSeveralGuardiansPerSubmission20261012120000: Migration } = require('../dist/database/migrations/20261012120000-AllowSeveralGuardiansPerSubmission');

if (process.env.DB_NAME !== 'sts_smoke' || process.env.NODE_ENV === 'production'
  || !['localhost', '127.0.0.1', '::1'].includes(db.options.host)) {
  throw new Error('Run only on loopback sts_smoke outside production');
}

async function main() {
  await db.initialize();
  const runner = db.createQueryRunner();
  try {
    await runner.connect();
    await runner.startTransaction();
    await runner.query('CREATE TEMP TABLE users (id INTEGER PRIMARY KEY) ON COMMIT DROP');
    await runner.query('SET LOCAL search_path TO pg_temp');
    await runner.query(`CREATE TEMP TABLE guardian_type_options (
      code VARCHAR(40) PRIMARY KEY, label_th TEXT, sort_order SMALLINT,
      requires_detail BOOLEAN NOT NULL DEFAULT FALSE) ON COMMIT DROP`);
    await runner.query(`CREATE TEMP TABLE task_submissions (
      id INTEGER PRIMARY KEY, submitted_at TIMESTAMPTZ, guardian_type_code VARCHAR(40),
      guardian_type_detail VARCHAR(200),
      CONSTRAINT fk_task_submissions_guardian_type FOREIGN KEY (guardian_type_code)
        REFERENCES guardian_type_options(code) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT chk_task_submissions_guardian_type_detail CHECK (
        guardian_type_detail IS NULL OR (guardian_type_code IS NOT NULL
          AND length(btrim(guardian_type_detail)) > 0))) ON COMMIT DROP`);
    await runner.query(`INSERT INTO guardian_type_options VALUES
      ('FATHER','father',10,FALSE), ('MOTHER','mother',20,FALSE),
      ('FATHER_AND_MOTHER','both',30,FALSE), ('MATERNAL_GRANDPARENTS','grandparents',50,FALSE),
      ('OTHER','other',80,TRUE), ('NO_GUARDIAN','none',90,FALSE)`);
    await runner.query(`INSERT INTO task_submissions VALUES
      (1,now(),'FATHER_AND_MOTHER',NULL),(2,now(),'OTHER','guardian detail'),
      (3,now(),NULL,NULL),(4,now(),'MOTHER',NULL)`);
    const migration = new Migration();
    const answers = () => runner.query(`SELECT task_submission_id, guardian_type_code
      FROM task_submission_guardian_types ORDER BY 1,2`);
    await migration.up(runner);
    const original = await answers();
    assert.deepEqual(original, [
      { task_submission_id: 1, guardian_type_code: 'FATHER' },
      { task_submission_id: 1, guardian_type_code: 'MOTHER' },
      { task_submission_id: 2, guardian_type_code: 'OTHER' },
      { task_submission_id: 4, guardian_type_code: 'MOTHER' },
    ]);
    const rejectDown = async () => {
      const before = await answers();
      await runner.query('SAVEPOINT guardian_rollback_guard');
      await assert.rejects(migration.down(runner), /refusing rollback: guardian answers/);
      await runner.query('ROLLBACK TO SAVEPOINT guardian_rollback_guard');
      assert.deepEqual(await answers(), before, 'rejected rollback must preserve all guardian picks');
      assert.equal((await runner.query("SELECT count(*)::int AS count FROM guardian_type_options WHERE code='FATHER_AND_MOTHER'"))[0].count, 0);
      assert.equal((await runner.query("SELECT guardian_type_detail FROM task_submissions WHERE id=2"))[0].guardian_type_detail, 'guardian detail');
    };
    await runner.query("INSERT INTO task_submission_guardian_types(task_submission_id,guardian_type_code) VALUES (4,'MATERNAL_GRANDPARENTS')");
    await rejectDown();
    await runner.query("DELETE FROM task_submission_guardian_types WHERE task_submission_id=4 AND guardian_type_code='MATERNAL_GRANDPARENTS'");
    await runner.query("INSERT INTO task_submission_guardian_types(task_submission_id,guardian_type_code) VALUES (1,'OTHER')");
    await rejectDown();
    await runner.query("DELETE FROM task_submission_guardian_types WHERE task_submission_id=1 AND guardian_type_code='OTHER'");
    await runner.query("UPDATE task_submissions SET guardian_type_detail='unlinked detail' WHERE id=3");
    await rejectDown();
    await runner.query('UPDATE task_submissions SET guardian_type_detail=NULL WHERE id=3');
    await migration.down(runner);
    assert.deepEqual(await runner.query('SELECT id,guardian_type_code,guardian_type_detail FROM task_submissions ORDER BY id'), [
      { id: 1, guardian_type_code: 'FATHER_AND_MOTHER', guardian_type_detail: null },
      { id: 2, guardian_type_code: 'OTHER', guardian_type_detail: 'guardian detail' },
      { id: 3, guardian_type_code: null, guardian_type_detail: null },
      { id: 4, guardian_type_code: 'MOTHER', guardian_type_detail: null },
    ]);
    await migration.up(runner);
    assert.deepEqual(await answers(), original, 'safe down/up must retain every answer');
    console.log('PASS guardian migration: rejects mixed sets, extra picks and unlinked details; safe down/up preserves answers');
  } finally {
    try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
    finally { try { await runner.release(); } finally { await db.destroy(); } }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
