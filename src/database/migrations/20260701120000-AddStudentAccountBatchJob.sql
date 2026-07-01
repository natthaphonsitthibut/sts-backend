-- Async large-batch student-account generation job + per-candidate items.
-- Additive, reversible. The job never stores plaintext credentials; printable
-- credentials are produced on demand via the existing reissue (rotate) path,
-- so items keep only non-secret fields (username, snapshot detail, status).
-- Mirror of STUDENT_ACCOUNT_BATCH_TABLES_SQL in bootstrap-sql.ts (parity).

CREATE TABLE IF NOT EXISTS student_account_batch_job (
  id UUID PRIMARY KEY,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scope_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_candidates INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $sabj_status$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_student_account_batch_job_status'
  ) THEN
    ALTER TABLE student_account_batch_job
      ADD CONSTRAINT chk_student_account_batch_job_status
      CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELED'));
  END IF;
END $sabj_status$;

CREATE INDEX IF NOT EXISTS idx_student_account_batch_job_status
  ON student_account_batch_job (status);
CREATE INDEX IF NOT EXISTS idx_student_account_batch_job_created_by
  ON student_account_batch_job (created_by, created_at DESC);

DROP TRIGGER IF EXISTS trg_student_account_batch_job_set_updated_at ON student_account_batch_job;
CREATE TRIGGER trg_student_account_batch_job_set_updated_at
  BEFORE UPDATE ON student_account_batch_job
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS student_account_batch_job_item (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES student_account_batch_job(id) ON DELETE CASCADE,
  person_uuid UUID NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username VARCHAR(64),
  detail JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  error_code VARCHAR(64),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $sabji_status$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_student_account_batch_job_item_status'
  ) THEN
    ALTER TABLE student_account_batch_job_item
      ADD CONSTRAINT chk_student_account_batch_job_item_status
      CHECK (status IN ('PENDING', 'CREATED', 'SKIPPED', 'FAILED'));
  END IF;
END $sabji_status$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_account_batch_job_item_person
  ON student_account_batch_job_item (job_id, person_uuid);
CREATE INDEX IF NOT EXISTS idx_student_account_batch_job_item_status
  ON student_account_batch_job_item (job_id, status);
