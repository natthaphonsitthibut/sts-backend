/**
 * Removes the accounts smoke runs leave behind.
 *
 * A smoke that dies before its cleanup step leaves a disabled account named
 * after itself. They are harmless — none can sign in — but they pad the user list
 * and make "how many accounts does this system have" a question nobody can answer
 * from the table.
 *
 * An account is only deleted when *nothing* references it. Most audit columns are
 * `ON DELETE SET NULL`, so deleting a referenced row would quietly erase who
 * created a real record, and `audit_log` refuses the write outright because it is
 * append-only by trigger. Those accounts stay and are reported with the tables
 * that hold them, so the trail keeps naming who did what.
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

    const deletable = [];
    const kept = [];
    for (const account of candidates) {
      const held = [];
      for (const { table_name: table, column_name: column } of referencing) {
        const { rows } = await client.query(
          `SELECT 1 FROM "${table}" WHERE "${column}" = $1 LIMIT 1`,
          [account.id],
        );
        if (rows.length > 0) held.push(`${table}.${column}`);
      }
      if (held.length === 0) deletable.push(account);
      else kept.push({ id: account.id, username: account.username, referencedBy: held });
    }

    if (APPLY) {
      for (const account of deletable) {
        await client.query(`DELETE FROM users WHERE id = $1`, [account.id]);
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
