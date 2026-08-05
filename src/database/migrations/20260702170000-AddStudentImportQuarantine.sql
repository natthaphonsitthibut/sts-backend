-- Persistent student-import review queue. Additive and reversible.
CREATE TABLE IF NOT EXISTS student_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target VARCHAR(32) NOT NULL CHECK (target IN ('student_term', 'student_dropouts')),
  source_sha256 CHAR(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  scope_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  imported_rows INTEGER NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
  quarantined_rows INTEGER NOT NULL DEFAULT 0 CHECK (quarantined_rows >= 0),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
DROP TRIGGER IF EXISTS trg_student_import_batches_set_updated_at ON student_import_batches;
CREATE TRIGGER trg_student_import_batches_set_updated_at BEFORE UPDATE ON student_import_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_student_import_batches_source
  ON student_import_batches (target, source_sha256, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_import_batches_created_by
  ON student_import_batches (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS student_import_quarantine_rows (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES student_import_batches(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  school_id INTEGER REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  source_row_number INTEGER NOT NULL CHECK (source_row_number >= 2),
  row_fingerprint CHAR(64) NOT NULL CHECK (row_fingerprint ~ '^[0-9a-f]{64}$'),
  reason_code VARCHAR(64) NOT NULL CHECK (reason_code IN
    ('MISSING_NATURAL_KEY_FIELD', 'UNMAPPED_STUDENT_STATUS', 'DUPLICATE_ROW_IN_FILE',
     'MULTIPLE_ACTIVE_ENROLLMENTS', 'IDENTIFIER_CONFLICT', 'NAME_CONFLICT_FOR_IDENTIFIER',
     'INVALID_NATIONAL_ID_CHECKSUM', 'SCHOOL_NOT_FOUND', 'GRADE_NOT_FOUND', 'ROOM_NOT_FOUND',
     'STATUS_CAUSE_UNMAPPED', 'BLANK_REQUIRED_IDENTITY')),
  mapped_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RESOLVED', 'REJECTED')),
  resolved_person_uuid UUID REFERENCES student_person(person_uuid)
    ON DELETE SET NULL ON UPDATE CASCADE,
  resolved_at TIMESTAMPTZ,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
DROP TRIGGER IF EXISTS trg_student_import_quarantine_rows_set_updated_at
  ON student_import_quarantine_rows;
CREATE TRIGGER trg_student_import_quarantine_rows_set_updated_at
  BEFORE UPDATE ON student_import_quarantine_rows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_import_quarantine_pending_row
  ON student_import_quarantine_rows (row_fingerprint, reason_code)
  WHERE status = 'PENDING' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_student_import_quarantine_batch_status
  ON student_import_quarantine_rows (batch_id, status);
CREATE INDEX IF NOT EXISTS idx_student_import_quarantine_school_status
  ON student_import_quarantine_rows (school_id, status, created_at DESC);
