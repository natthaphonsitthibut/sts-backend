-- Migration: AddTaskTreeSoftDelete20260621122000
-- Extend soft-delete to tasks + task_submissions so admin "delete task" can
-- tombstone the whole task tree (task already had task_links columns in
-- 20260620123000). Shape matches AUDIT_COLUMNS_SQL. Additive + reversible.

-- == up ==
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- == down ==
-- ALTER TABLE tasks DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;
-- ALTER TABLE task_submissions DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;
