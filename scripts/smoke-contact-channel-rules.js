/** Isolated PostgreSQL proof: temp transactions roll back; concurrent fixture schema is dropped. */
require('dotenv/config');
const assert = require('node:assert/strict');
const db = require('../dist/database/typeorm.datasource').default;
const { GuardContactChannelDetailRules20261012150000: Guard } = require('../dist/database/migrations/20261012150000-GuardContactChannelDetailRules');
const { AddContactChannelDetail20261012130000: Detail } = require('../dist/database/migrations/20261012130000-AddContactChannelDetail');
const { CatalogContactChannelDetailRules20261012140000: Migration } = require('../dist/database/migrations/20261012140000-CatalogContactChannelDetailRules');

if (process.env.DB_NAME !== 'sts_smoke' || process.env.NODE_ENV === 'production'
  || !['localhost', '127.0.0.1', '::1'].includes(db.options.host)) {
  throw new Error('Run only on loopback sts_smoke outside production');
}

async function proveConcurrency() {
  const schema = 'smoke_contact_rules_' + require('node:crypto').randomUUID().replaceAll('-', '');
  const setup = db.createQueryRunner();
  const holder = db.createQueryRunner();
  const contender = db.createQueryRunner();
  const pids = [];
  await db.query(`CREATE SCHEMA ${schema}`);
  try {
    await setup.connect();
    await setup.startTransaction();
    await setup.query(`SET LOCAL search_path TO ${schema}`);
    await setup.query('CREATE TABLE contact_channel_options (code VARCHAR(24) PRIMARY KEY)');
    await setup.query(`CREATE TABLE task_submissions (id INTEGER PRIMARY KEY,
      contact_channel_code VARCHAR(24) REFERENCES contact_channel_options(code),
      contact_channel_detail VARCHAR(200), CONSTRAINT chk_task_submissions_contact_channel_detail
      CHECK (contact_channel_detail IS NULL OR contact_channel_code='OTHER'))`);
    await setup.query("INSERT INTO contact_channel_options VALUES ('OTHER')");
    const scoped = { query: sql => setup.query(sql.replaceAll('SET search_path = pg_catalog, public', `SET search_path = pg_catalog, ${schema}`)) };
    await new Migration().up(scoped);
    await new Guard().up(scoped);
    await setup.commitTransaction();
    for (const runner of [holder, contender]) {
      await runner.connect();
      const [backend] = await runner.query('SELECT pg_backend_pid() AS pid');
      pids.push(backend.pid);
    }
    const begin = async runner => {
      await runner.startTransaction();
      await runner.query(`SET LOCAL search_path TO ${schema}`);
    };
    const blocked = async pid => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const [activity] = await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]);
        if (activity?.wait_event_type === 'Lock') return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Concurrent contact-rule writer did not wait on the catalog lock');
    };
    await begin(holder);
    await holder.query("INSERT INTO task_submissions VALUES (1,'OTHER','detail')");
    await begin(contender);
    let pending = contender.query("UPDATE contact_channel_options SET requires_detail=FALSE WHERE code='OTHER'").then(() => null, error => error);
    await blocked(pids[1]);
    await holder.commitTransaction();
    assert.equal((await pending)?.code, '23514', 'catalog change must see a committed concurrent detail');
    await contender.rollbackTransaction();
    await db.query(`DELETE FROM ${schema}.task_submissions`);
    await begin(holder);
    await holder.query("UPDATE contact_channel_options SET requires_detail=FALSE WHERE code='OTHER'");
    await begin(contender);
    pending = contender.query("INSERT INTO task_submissions VALUES (2,'OTHER','detail')").then(() => null, error => error);
    await blocked(pids[1]);
    await holder.commitTransaction();
    assert.equal((await pending)?.code, '23514', 'report must recheck a concurrently disabled catalog flag');
    await contender.rollbackTransaction();
    console.log('PASS contact catalog concurrency: report-first and catalog-first races serialize and reject invalid state');
  } finally {
    const errors = [];
    const cleanup = async action => { try { await action(); } catch (error) { errors.push(error); } };
    for (const pid of pids) await cleanup(() => db.query('SELECT pg_cancel_backend($1)', [pid]));
    for (const runner of [holder, contender, setup]) {
      if (runner.isTransactionActive) await cleanup(() => runner.rollbackTransaction());
      if (!runner.isReleased) await cleanup(() => runner.release());
    }
    await cleanup(() => db.query(`DROP SCHEMA ${schema} CASCADE`));
    if (errors.length) throw new AggregateError(errors, 'Contact concurrency fixture cleanup failed');
  }
}

async function proveDetailRollbackConcurrency() {
  const schema = 'smoke_contact_rollback_' + require('node:crypto').randomUUID().replaceAll('-', '');
  const writer = db.createQueryRunner();
  const rollback = db.createQueryRunner();
  let pending;
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.task_submissions (id INTEGER PRIMARY KEY, contact_channel_code VARCHAR(24))`);
    await writer.connect();
    await rollback.connect();
    await rollback.startTransaction();
    await rollback.query(`SET LOCAL search_path TO ${schema}`);
    await new Detail().up(rollback);
    await rollback.commitTransaction();
    await writer.startTransaction();
    await writer.query(`SET LOCAL search_path TO ${schema}`);
    await writer.query("INSERT INTO task_submissions VALUES (1, 'OTHER', 'committed concurrent detail')");
    await rollback.startTransaction();
    await rollback.query(`SET LOCAL search_path TO ${schema}`);
    const [{ pid }] = await rollback.query('SELECT pg_backend_pid() AS pid');
    pending = new Detail().down(rollback).then(() => null, error => error);
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < deadline) {
      const [activity] = await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]);
      if (activity?.wait_event_type === 'Lock') { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(waiting, 'rollback must serialize with the in-flight report');
    await writer.commitTransaction();
    const result = await pending;
    assert.match(result?.message ?? '', /refusing rollback/, 'rollback must refuse to drop the concurrently committed detail');
    await rollback.rollbackTransaction();
    const [saved] = await db.query(`SELECT contact_channel_detail FROM ${schema}.task_submissions WHERE id=1`);
    assert.equal(saved.contact_channel_detail, 'committed concurrent detail');
    console.log('PASS contact detail rollback: waits for the writer, refuses data loss, preserves committed detail');
  } finally {
    const errors = [];
    const cleanup = async action => { try { await action(); } catch (error) { errors.push(error); } };
    if (writer.isTransactionActive) await cleanup(() => writer.rollbackTransaction());
    if (pending) await cleanup(() => pending);
    if (rollback.isTransactionActive) await cleanup(() => rollback.rollbackTransaction());
    for (const runner of [writer, rollback]) if (!runner.isReleased) await cleanup(() => runner.release());
    await cleanup(() => db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
    if (errors.length) throw new AggregateError(errors, 'Contact rollback fixture cleanup failed');
  }
}

async function main() {
  await db.initialize();
  const runner = db.createQueryRunner();
  try {
    const [privileges] = await db.query(`SELECT
      has_table_privilege(current_user, 'public.contact_channel_options', 'SELECT')
      AND has_table_privilege(current_user, 'public.contact_channel_options', 'UPDATE') AS allowed`);
    assert.equal(privileges.allowed, true, 'application role needs SELECT/UPDATE for the contact catalog row lock');
    await runner.connect();
    await runner.startTransaction();
    await runner.query('CREATE TEMP TABLE contact_channel_options (code VARCHAR(24) PRIMARY KEY) ON COMMIT DROP');
    await runner.query('SET LOCAL search_path TO pg_temp');
    await runner.query(`CREATE TEMP TABLE task_submissions (
      id INTEGER PRIMARY KEY,
      contact_channel_code VARCHAR(24) REFERENCES contact_channel_options(code) ON UPDATE CASCADE ON DELETE RESTRICT,
      contact_channel_detail VARCHAR(200),
      CONSTRAINT chk_task_submissions_contact_channel_detail CHECK (
        contact_channel_detail IS NULL OR (
          contact_channel_code IS NOT DISTINCT FROM 'OTHER'
          AND char_length(btrim(contact_channel_detail)) BETWEEN 1 AND 200
        )
      )) ON COMMIT DROP`);
    await runner.query("INSERT INTO contact_channel_options VALUES ('OTHER'), ('PHONE')");
    await runner.query("INSERT INTO task_submissions VALUES (1,'OTHER',NULL),(2,'PHONE',NULL),(3,NULL,NULL)");
    const migration = new Migration();
    const isolatedRunner = { query: sql => runner.query(sql.replaceAll('enforce_task_submission_contact_channel_detail()', 'pg_temp.enforce_task_submission_contact_channel_detail()').replaceAll('guard_contact_channel_detail_rule_change()', 'pg_temp.guard_contact_channel_detail_rule_change()')) };
    const rejected = async (sql, expected) => {
      await runner.query('SAVEPOINT expected_rejection');
      await assert.rejects(runner.query(sql), error => expected.test(error.message));
      await runner.query('ROLLBACK TO SAVEPOINT expected_rejection');
    };
    await migration.up(isolatedRunner);
    await new Guard().up(isolatedRunner);
    assert.equal((await runner.query('SELECT count(*)::int AS count FROM task_submissions WHERE contact_channel_detail IS NULL'))[0].count, 3);
    await rejected("UPDATE task_submissions SET contact_channel_detail='detail' WHERE id=2", /contact channel does not allow/);
    await rejected("UPDATE task_submissions SET contact_channel_detail='detail' WHERE id=3", /contact channel does not allow/);
    await rejected("UPDATE task_submissions SET contact_channel_detail='  ' WHERE id=1", /check constraint/);
    await rejected("UPDATE task_submissions SET contact_channel_detail=repeat('ก',201) WHERE id=1", /too long/);
    await runner.query("UPDATE task_submissions SET contact_channel_detail='อีเมล' WHERE id=1");
    await runner.query("INSERT INTO contact_channel_options VALUES ('FAX',TRUE)");
    await runner.query("INSERT INTO task_submissions VALUES (4,'FAX','ฝ่ายดูแล')");
    await rejected("UPDATE contact_channel_options SET requires_detail=FALSE WHERE code='FAX'", /has reports with details/);
    await rejected("UPDATE task_submissions SET contact_channel_code='PHONE' WHERE id=4", /contact channel does not allow/);
    await rejected("DELETE FROM contact_channel_options WHERE code='FAX'", /foreign key/);
    await runner.query("UPDATE contact_channel_options SET code='FAX_UPDATED' WHERE code='FAX'");
    assert.equal((await runner.query('SELECT contact_channel_code FROM task_submissions WHERE id=4'))[0].contact_channel_code, 'FAX_UPDATED');
    await runner.query('SAVEPOINT rollback_guard');
    await new Guard().down(isolatedRunner);
    await assert.rejects(migration.down(isolatedRunner), /refusing rollback/);
    await runner.query('ROLLBACK TO SAVEPOINT rollback_guard');
    assert.equal((await runner.query('SELECT contact_channel_detail FROM task_submissions WHERE id=4'))[0].contact_channel_detail, 'ฝ่ายดูแล');
    await runner.query('DELETE FROM task_submissions WHERE id=4');
    await runner.query("UPDATE contact_channel_options SET requires_detail=FALSE WHERE code='FAX_UPDATED'");
    await new Guard().down(isolatedRunner);
    await migration.down(isolatedRunner);
    await migration.up(isolatedRunner);
    assert.equal((await runner.query('SELECT contact_channel_detail FROM task_submissions WHERE id=1'))[0].contact_channel_detail, 'อีเมล');
    await new Guard().up(isolatedRunner);
    await proveConcurrency();
    await proveDetailRollbackConcurrency();
    console.log('PASS contact catalog: flags, legacy NULL, detail CHECK/trigger, new channel, FK cascade/restrict, guarded down/up');
  } finally {
    try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
    finally { try { await runner.release(); } finally { await db.destroy(); } }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
