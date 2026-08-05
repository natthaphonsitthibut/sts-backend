-- Migration: AddMissingAuditColumns20260620121000
-- Phase A (A4) — retrofit standard audit columns onto the tables Phase 2a left out:
--   student_term, student_dropouts, risk_factors, dropout_reasons, assistance_measures,
--   related_agencies, educational_areas, grade_levels, schedules, external_users
-- Mirrors AUDIT_RETROFIT_SQL (bootstrap-sql.ts): add created_at/updated_at (timestamptz,
-- normalizing any legacy plain timestamp), created_by/updated_by (FK users), backfill,
-- DEFAULT now() + NOT NULL, and the shared set_updated_at trigger. Additive + reversible.
-- (external_users.created_at is normalized to timestamptz here too — A5 in passing.)

-- == up ==
DO $audit$
DECLARE
  t text;
  audit_tables text[] := ARRAY['student_term','student_dropouts','risk_factors','dropout_reasons','assistance_measures','related_agencies','educational_areas','grade_levels','schedules','external_users'];
BEGIN
  FOREACH t IN ARRAY audit_tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_at timestamptz', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at timestamptz', t);
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'created_at' AND data_type = 'timestamp without time zone') THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE ''UTC''', t);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'updated_at' AND data_type = 'timestamp without time zone') THEN
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

-- == down ==
-- per table: DROP TRIGGER IF EXISTS trg_<t>_set_updated_at; ALTER TABLE <t> DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS updated_by;
-- created_at/updated_at left in place (dropping would lose timestamps).
