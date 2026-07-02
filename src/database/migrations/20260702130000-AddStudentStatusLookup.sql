-- EXPAND: editable canonical lookup for ONEC enrollment status codes.
-- `requires_followup` is policy metadata only; it never creates a case.
CREATE TABLE IF NOT EXISTS student_status (
  code INTEGER PRIMARY KEY,
  label_th VARCHAR(100) NOT NULL,
  category VARCHAR(32) NOT NULL,
  is_active_for_login BOOLEAN NOT NULL DEFAULT FALSE,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  requires_followup BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order SMALLINT NOT NULL,
  source_system VARCHAR(32) NOT NULL DEFAULT 'ONEC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_student_status_category
    CHECK (category IN ('ACTIVE', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED', 'DECEASED', 'UNMAPPED')),
  CONSTRAINT chk_student_status_sort_order CHECK (sort_order >= 0),
  CONSTRAINT chk_student_status_source_system CHECK (length(trim(source_system)) > 0),
  CONSTRAINT chk_student_status_label_th CHECK (length(trim(label_th)) > 0)
);

DROP TRIGGER IF EXISTS trg_student_status_set_updated_at ON student_status;
CREATE TRIGGER trg_student_status_set_updated_at
  BEFORE UPDATE ON student_status
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO student_status (
  code, label_th, category, is_active_for_login, is_terminal,
  requires_followup, is_enabled, sort_order, source_system
)
VALUES
  (10, 'กำลังศึกษา', 'ACTIVE', TRUE, FALSE, FALSE, TRUE, 10, 'ONEC'),
  (20, 'จบการศึกษา', 'GRADUATED', FALSE, TRUE, FALSE, TRUE, 20, 'ONEC'),
  (30, 'ลาออก/จำหน่าย', 'WITHDRAWN', FALSE, TRUE, TRUE, TRUE, 30, 'ONEC'),
  (40, 'ย้ายสถานศึกษา', 'TRANSFERRED', FALSE, TRUE, FALSE, TRUE, 40, 'ONEC')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE student_term ADD COLUMN IF NOT EXISTS student_status_code INTEGER;
UPDATE student_term AS enrollment
SET student_status_code = status.code
FROM student_status AS status
WHERE enrollment.student_status_code IS NULL
  AND enrollment."StudentStatusID_Onec" = status.code;

ALTER TABLE student_term
  ADD CONSTRAINT fk_student_term_student_status
  FOREIGN KEY (student_status_code) REFERENCES student_status(code)
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS idx_student_term_student_status_code
  ON student_term (student_status_code);
