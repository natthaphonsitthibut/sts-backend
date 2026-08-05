import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase B1.1 (EXPAND) — add an opaque surrogate UUID to the student tables.
 *
 * Purpose: the national ID (`PersonID_Onec`) is currently the PK and leaks into
 * every URL/API/log/join (PDPA liability + IDOR for minors). This adds a durable
 * `student_uuid` that will become the public identifier; `PersonID_Onec` stays
 * the PK for now and is swapped to a UNIQUE attribute only in B1.4 (CONTRACT).
 *
 * Additive + reversible + idempotent. The volatile `gen_random_uuid()` default
 * makes Postgres assign a distinct value to every existing row during the
 * rewrite, and keeps minting one for future inserts.
 *
 * student_term and student_dropouts are disjoint populations today, so each gets
 * its own surrogate; unifying them into one identity space is a later concern (B2).
 *
 * ⚠️ PRODUCTION-SCALE ROLLOUT (millions of rows): `ADD COLUMN ... NOT NULL
 * DEFAULT gen_random_uuid()` rewrites the table under a strong lock and the
 * UNIQUE constraint builds its index non-concurrently. That is fine for this
 * seed DB (5k/500) but NOT for national data. For the live national rollout use:
 *   1) ADD COLUMN student_uuid UUID (nullable, no default)
 *   2) batched UPDATE backfill (gen_random_uuid()) + set DEFAULT for new rows
 *   3) CREATE UNIQUE INDEX CONCURRENTLY uq_..._student_uuid ON ... (student_uuid)
 *   4) ALTER TABLE ... ADD CONSTRAINT ... UNIQUE USING INDEX ...
 *   5) enforce NOT NULL via a validated CHECK then a short final lock
 */
export class AddStudentSurrogateUuid20260621230000 implements MigrationInterface {
  name = 'AddStudentSurrogateUuid20260621230000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['student_term', 'student_dropouts']) {
      const constraint = `uq_${table}_student_uuid`;
      await queryRunner.query(`
        ALTER TABLE ${table}
          ADD COLUMN IF NOT EXISTS student_uuid UUID NOT NULL DEFAULT gen_random_uuid()
      `);
      // ADD CONSTRAINT has no IF NOT EXISTS — guard it so the migration is re-runnable.
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = '${constraint}'
          ) THEN
            ALTER TABLE ${table}
              ADD CONSTRAINT ${constraint} UNIQUE (student_uuid);
          END IF;
        END $$;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['student_dropouts', 'student_term']) {
      await queryRunner.query(`
        ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS uq_${table}_student_uuid
      `);
      await queryRunner.query(`
        ALTER TABLE ${table} DROP COLUMN IF EXISTS student_uuid
      `);
    }
  }
}
