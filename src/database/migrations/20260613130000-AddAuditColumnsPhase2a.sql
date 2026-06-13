-- Migration: AddAuditColumnsPhase2a20260613130000
-- Phase 2a — retrofit standard audit columns onto existing CRUD tables:
-- created_at/updated_at (timestamptz) + created_by/updated_by (FK users) +
-- updated_at trigger; normalize legacy timestamp -> timestamptz; backfill;
-- rename legacy task_links.created_by_user_id -> created_by.
-- Soft-delete (deleted_at/by) is deferred to Phase 2b.
-- Exported SQL for manual/DBA application.

-- == up ==
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'task_links' AND column_name = 'created_by_user_id') THEN
    ALTER TABLE task_links RENAME COLUMN created_by_user_id TO created_by;
  END IF;
END $$;

DO $audit$
DECLARE
  t text;
  audit_tables text[] := ARRAY[
    'users','roles','cases','tasks','task_links','task_submissions',
    'case_reviews','attendance','system_settings','schools'
  ];
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

-- == down ==
-- (reverts trigger + generic actor columns; keeps timestamps; renames created_by back)
