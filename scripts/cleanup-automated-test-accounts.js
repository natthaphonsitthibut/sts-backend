/**
 * Removes the accounts smoke runs leave behind.
 *
 * A smoke that dies before its cleanup step leaves a disabled account named
 * after itself. They are harmless — none can sign in — but they pad the user list
 * and make "how many accounts does this system have" a question nobody can answer
 * from the table.
 *
 * An account is deleted only when the rows pointing at it are themselves traces of
 * the same test run:
 *
 *   - `audit_log` entries it wrote. The table is append-only by trigger and its
 *     foreign key is `ON DELETE SET NULL`, so the delete would be refused; the
 *     trigger is disabled for the statement, exactly as the smoke scripts do for
 *     their own fixtures, and re-enabled straight after.
 *   - rows in the permission backup tables, which exist to restore an account this
 *     is deleting anyway.
 *   - `users.updated_by` pointing at another account in the same batch.
 *
 * Anything else means real data names the account, and the account stays: most
 * audit columns are `ON DELETE SET NULL`, so deleting it would quietly erase who
 * created a real record.
 *
 * Usage: DB_NAME=sts node scripts/cleanup-automated-test-accounts.js [--apply]
 * Without --apply it only reports.
 */
require('dotenv/config');
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');

const CANDIDATE_SQL = `
  SELECT id, username, status, data_origin_code
  FROM users
  WHERE status <> 'ACTIVE'
    AND (
      data_origin_code = 'AUTOMATED_TEST'
      OR username LIKE '%smoke%'
      OR username LIKE '%probe%'
    )
  ORDER BY id
`;

async function main() {
  const database = process.env.DB_NAME;
  if (!database) throw new Error('DB_NAME is required');
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
  });
  await client.connect();
  try {
    const { rows: candidates } = await client.query(CANDIDATE_SQL);
    if (candidates.length === 0) {
      console.log(JSON.stringify({ database, candidates: 0, deleted: 0, kept: [] }));
      return;
    }

    // Every column in the schema that points at users(id) — asking the catalogue
    // rather than listing them keeps this correct when a new table appears.
    const { rows: referencing } = await client.query(`
      SELECT source.relname AS table_name, source_column.attname AS column_name
      FROM pg_constraint constraint_row
      JOIN pg_class source ON source.oid = constraint_row.conrelid
      JOIN pg_class target ON target.oid = constraint_row.confrelid
      JOIN unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, ord) ON TRUE
      JOIN pg_attribute source_column
        ON source_column.attrelid = source.oid AND source_column.attnum = key.attnum
      WHERE constraint_row.contype = 'f' AND target.relname = 'users'
      ORDER BY source.relname, source_column.attname
    `);

    // Tables whose rows are traces of the same test run, so clearing them loses
    // nothing a person would look for later.
    const OWN_TRACE_TABLES = new Set([
      'audit_log',
      'case_tracking_user_permission_backup_20260720',
      'permission_default_reset_backups',
    ]);
    const candidateIds = new Set(candidates.map((account) => account.id));

    const deletable = [];
    const kept = [];
    for (const account of candidates) {
      const blocking = [];
      const traces = [];
      for (const { table_name: table, column_name: column } of referencing) {
        const { rows } = await client.query(
          `SELECT 1 FROM "${table}" WHERE "${column}" = $1 LIMIT 1`,
          [account.id],
        );
        if (rows.length === 0) continue;
        // A pointer from another account in the same batch disappears with it.
        const sameBatch =
          table === 'users' &&
          (
            await client.query(
              `SELECT id FROM users WHERE "${column}" = $1 AND id <> $1`,
              [account.id],
            )
          ).rows.every((row) => candidateIds.has(row.id));
        if (OWN_TRACE_TABLES.has(table) || sameBatch) traces.push({ table, column });
        else blocking.push(`${table}.${column}`);
      }
      if (blocking.length === 0) deletable.push({ ...account, traces });
      else kept.push({ id: account.id, username: account.username, referencedBy: blocking });
    }

    if (APPLY && deletable.length > 0) {
      await client.query(`ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable`);
      try {
        for (const account of deletable) {
          for (const { table, column } of account.traces) {
            if (table === 'users') {
              await client.query(`UPDATE users SET "${column}" = NULL WHERE "${column}" = $1`, [
                account.id,
              ]);
            } else {
              await client.query(`DELETE FROM "${table}" WHERE "${column}" = $1`, [account.id]);
            }
          }
          await client.query(`DELETE FROM users WHERE id = $1`, [account.id]);
        }
      } finally {
        await client.query(`ALTER TABLE audit_log ENABLE TRIGGER trg_audit_log_immutable`);
      }
    }

    console.log(
      JSON.stringify(
        {
          database,
          applied: APPLY,
          candidates: candidates.length,
          [APPLY ? 'deleted' : 'deletable']: deletable.map((account) => account.username),
          keptBecauseReferenced: kept,
        },
        null,
        1,
      ),
    );
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
