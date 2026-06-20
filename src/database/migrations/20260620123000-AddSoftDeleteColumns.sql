-- Migration: AddSoftDeleteColumns20260620123000
-- Add standard soft-delete audit columns to selected tables.
-- Shape matches AUDIT_COLUMNS_SQL:
--   deleted_at TIMESTAMPTZ
--   deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL
-- Additive + reversible. No query/service behavior in this round.

-- == up ==
ALTER TABLE cases ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE student_term ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE student_dropouts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE task_links ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- == down == (see the .ts migration's down(); commented so running this file
-- manually does not immediately drop what it just created)
-- ALTER TABLE cases DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;
-- ALTER TABLE student_term DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;
-- ALTER TABLE student_dropouts DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;
-- ALTER TABLE task_links DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;
