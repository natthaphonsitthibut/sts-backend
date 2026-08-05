-- Migration: AddSetUpdatedAtFunction20260613120000
-- Installs the shared set_updated_at() trigger function for the audit-columns
-- standard (Phase 1). Additive + idempotent; new audited tables attach it with
-- a BEFORE UPDATE trigger. Exported SQL for manual/DBA application.

-- == up ==
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- == down ==
-- DROP FUNCTION IF EXISTS set_updated_at();
