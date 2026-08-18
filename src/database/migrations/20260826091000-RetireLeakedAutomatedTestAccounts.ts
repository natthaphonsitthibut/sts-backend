import type { MigrationInterface, QueryRunner } from 'typeorm';

type CandidateAccount = { id: number; username: string };
type UserReference = { table_name: string; column_name: string };

const IMMUTABLE_HISTORY_TRIGGERS = [
  ['audit_log', 'trg_audit_log_immutable'],
  ['pii_access_events', 'trg_pii_access_events_immutable'],
  ['pii_export_events', 'trg_pii_export_events_immutable'],
] as const;

const PRESERVED_HISTORY_TABLES: ReadonlySet<string> = new Set(
  IMMUTABLE_HISTORY_TRIGGERS.map(([table]) => table),
);
const TEST_TRACE_TABLES: ReadonlySet<string> = new Set([
  'case_tracking_user_permission_backup_20260720',
  'permission_default_reset_backups',
]);

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Removes smoke accounts only when no operational row still names them. */
export class RetireLeakedAutomatedTestAccounts20260826091000 implements MigrationInterface {
  name = 'RetireLeakedAutomatedTestAccounts20260826091000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Disable first: even an account retained for referential history must stop
    // authenticating and disappear from operational account pickers.
    await queryRunner.query(`
      UPDATE users
      SET
        status = 'DISABLED',
        password = 'NOT_A_LOGIN_CREDENTIAL',
        permissions = '[]'::jsonb,
        must_change_password = FALSE,
        temporary_password_issued_at = NULL,
        temporary_password_expires_at = NULL,
        data_origin_code = 'AUTOMATED_TEST'
      WHERE data_origin_code = 'AUTOMATED_TEST'
         OR LOWER(BTRIM(CONCAT_WS(' ', "FirstName", "LastName"))) = 'smoke student account'
    `);

    const candidates = (await queryRunner.query(`
      SELECT id, username
      FROM users
      WHERE status = 'DISABLED'
        AND data_origin_code = 'AUTOMATED_TEST'
      ORDER BY id
    `)) as CandidateAccount[];
    if (candidates.length === 0) return;

    const references = (await queryRunner.query(`
      SELECT source.relname AS table_name, source_column.attname AS column_name
      FROM pg_constraint constraint_row
      JOIN pg_class source ON source.oid = constraint_row.conrelid
      JOIN pg_namespace source_schema ON source_schema.oid = source.relnamespace
      JOIN pg_class target ON target.oid = constraint_row.confrelid
      JOIN pg_namespace target_schema ON target_schema.oid = target.relnamespace
      JOIN unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, ord) ON TRUE
      JOIN pg_attribute source_column
        ON source_column.attrelid = source.oid
       AND source_column.attnum = key.attnum
      WHERE constraint_row.contype = 'f'
        AND target.relname = 'users'
        AND target_schema.nspname = 'public'
        AND source_schema.nspname = 'public'
      ORDER BY source.relname, source_column.attname
    `)) as UserReference[];
    const candidateIds = candidates.map((account) => account.id);
    const blockedIds = new Set<string>();

    // Check each FK once for the whole candidate set. The former account × FK
    // loop issued thousands of queries on a fixture-heavy database and could
    // outlive the deploy window even though the final delete set was small.
    for (const reference of references) {
      if (
        PRESERVED_HISTORY_TABLES.has(reference.table_name) ||
        TEST_TRACE_TABLES.has(reference.table_name)
      ) {
        continue;
      }
      const table = quoteIdentifier(reference.table_name);
      const column = quoteIdentifier(reference.column_name);
      const candidateFilter =
        reference.table_name === 'users' ? 'AND NOT (id = ANY($1::int[]))' : '';
      const rows = (await queryRunner.query(
        `SELECT DISTINCT ${column}::text AS referenced_id
         FROM ${table}
         WHERE ${column} = ANY($1::int[])
           ${candidateFilter}`,
        [candidateIds],
      )) as Array<{ referenced_id: string }>;
      for (const row of rows) blockedIds.add(String(row.referenced_id));
    }
    const deletableIds = candidateIds.filter((id) => !blockedIds.has(String(id)));
    if (deletableIds.length === 0) return;

    for (const reference of references) {
      if (!TEST_TRACE_TABLES.has(reference.table_name)) continue;
      await queryRunner.query(
        `DELETE FROM ${quoteIdentifier(reference.table_name)}
         WHERE ${quoteIdentifier(reference.column_name)} = ANY($1::int[])`,
        [deletableIds],
      );
    }
    for (const reference of references) {
      if (reference.table_name !== 'users') continue;
      await queryRunner.query(
        `UPDATE users SET ${quoteIdentifier(reference.column_name)} = NULL
         WHERE ${quoteIdentifier(reference.column_name)} = ANY($1::int[])`,
        [deletableIds],
      );
    }

    // Preserve immutable audit/PII rows; their ON DELETE SET NULL foreign keys
    // clear only the actor pointer while the history event itself remains.
    for (const [table, trigger] of IMMUTABLE_HISTORY_TRIGGERS) {
      await queryRunner.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    }
    // TypeORM runs migrations in a transaction. If DELETE fails, PostgreSQL
    // rolls the trigger changes back too; issuing ENABLE in a JS finally block
    // would only mask the real failure with "transaction is aborted".
    await queryRunner.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [deletableIds]);
    for (const [table, trigger] of [...IMMUTABLE_HISTORY_TRIGGERS].reverse()) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
    }
  }

  /** Deleted test identities and invalidated credentials are non-reversible. */
  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    return Promise.resolve();
  }
}
