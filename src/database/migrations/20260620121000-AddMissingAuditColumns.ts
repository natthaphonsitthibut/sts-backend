import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase A (A4) — retrofit the standard audit columns onto the tables that Phase
 * 2a left out. After this, every CRUD/data table tracks created_at/updated_at
 * (timestamptz) + created_by/updated_by (FK users) + the shared updated_at
 * trigger — so "who changed this student / catalog row and when" is answerable,
 * which Phase 2a only delivered for the 10 transactional tables.
 *
 * Mirrors `AUDIT_RETROFIT_SQL` (bootstrap-sql.ts) exactly: same idempotent
 * DO-block (ADD COLUMN IF NOT EXISTS, normalize any legacy plain `timestamp`
 * to timestamptz, backfill, DEFAULT now() + NOT NULL, attach trigger). The
 * shared `set_updated_at()` function already exists (migration 20260613120000).
 *
 * external_users is included so its pre-existing `created_at` (stored as
 * `timestamp without time zone`) is normalized to timestamptz here too — closing
 * one of the four tz-inconsistent columns (A5) in passing.
 *
 * created_by/updated_by start NULL (no actor backfill); the service layer fills
 * them going forward. Additive + reversible. NO service files touched this round.
 */
export class AddMissingAuditColumns20260620121000 implements MigrationInterface {
  name = 'AddMissingAuditColumns20260620121000';

  private static readonly TABLES = [
    'student_term',
    'student_dropouts',
    'risk_factors',
    'dropout_reasons',
    'assistance_measures',
    'related_agencies',
    'educational_areas',
    'grade_levels',
    'schedules',
    'external_users',
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablesArray = AddMissingAuditColumns20260620121000.TABLES.map((t) => `'${t}'`).join(', ');
    await queryRunner.query(`
      DO $audit$
      DECLARE
        t text;
        audit_tables text[] := ARRAY[${tablesArray}];
      BEGIN
        FOREACH t IN ARRAY audit_tables LOOP
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_at timestamptz', t);
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at timestamptz', t);
          IF EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = t AND column_name = 'created_at'
                       AND data_type = 'timestamp without time zone') THEN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE ''UTC''', t);
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = t AND column_name = 'updated_at'
                       AND data_type = 'timestamp without time zone') THEN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE ''UTC''', t);
          END IF;
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id) ON DELETE SET NULL', t);
          EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES users(id) ON DELETE SET NULL', t);
          EXECUTE format('UPDATE %I SET created_at = COALESCE(created_at, now()) WHERE created_at IS NULL', t);
          EXECUTE format('UPDATE %I SET updated_at = COALESCE(updated_at, created_at, now()) WHERE updated_at IS NULL', t);
          EXECUTE format('ALTER TABLE %I ALTER COLUMN created_at SET DEFAULT now()', t);
          EXECUTE format('ALTER TABLE %I ALTER COLUMN updated_at SET DEFAULT now()', t);
          EXECUTE format('ALTER TABLE %I ALTER COLUMN created_at SET NOT NULL', t);
          EXECUTE format('ALTER TABLE %I ALTER COLUMN updated_at SET NOT NULL', t);
          EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_set_updated_at ON %I', t, t);
          EXECUTE format('CREATE TRIGGER trg_%I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
        END LOOP;
      END $audit$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Mirror Phase 2a's down: drop the trigger + the *_by columns we added.
    // created_at/updated_at are intentionally left in place — dropping them
    // would lose timestamps; removing the trigger reverts the behavior.
    for (const table of AddMissingAuditColumns20260620121000.TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS trg_${table}_set_updated_at ON ${table}`);
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS updated_by`,
      );
    }
  }
}
