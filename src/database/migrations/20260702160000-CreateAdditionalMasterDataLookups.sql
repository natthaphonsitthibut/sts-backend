-- EXPAND: additional editable master-data lookup tables.
-- `student_status` already exists, so this creates only the remaining P1 tables.
CREATE TABLE IF NOT EXISTS school_affiliations (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_school_affiliations_code CHECK (length(trim(code)) > 0),
  CONSTRAINT chk_school_affiliations_name CHECK (length(trim(name)) > 0)
);
DROP TRIGGER IF EXISTS trg_school_affiliations_set_updated_at ON school_affiliations;
CREATE TRIGGER trg_school_affiliations_set_updated_at
  BEFORE UPDATE ON school_affiliations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS disability_types (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  legal_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_disability_types_code CHECK (length(trim(code)) > 0),
  CONSTRAINT chk_disability_types_name CHECK (length(trim(name)) > 0)
);
DROP TRIGGER IF EXISTS trg_disability_types_set_updated_at ON disability_types;
CREATE TRIGGER trg_disability_types_set_updated_at
  BEFORE UPDATE ON disability_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS absence_reason_categories (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_absence_reason_categories_code CHECK (length(trim(code)) > 0),
  CONSTRAINT chk_absence_reason_categories_name CHECK (length(trim(name)) > 0)
);
DROP TRIGGER IF EXISTS trg_absence_reason_categories_set_updated_at ON absence_reason_categories;
CREATE TRIGGER trg_absence_reason_categories_set_updated_at
  BEFORE UPDATE ON absence_reason_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS absence_reasons (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id BIGINT NOT NULL REFERENCES absence_reason_categories(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_absence_reasons_code CHECK (length(trim(code)) > 0),
  CONSTRAINT chk_absence_reasons_name CHECK (length(trim(name)) > 0)
);
DROP TRIGGER IF EXISTS trg_absence_reasons_set_updated_at ON absence_reasons;
CREATE TRIGGER trg_absence_reasons_set_updated_at
  BEFORE UPDATE ON absence_reasons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_absence_reasons_category_id
  ON absence_reasons (category_id);

CREATE TABLE IF NOT EXISTS non_follow_up_reasons (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_non_follow_up_reasons_code CHECK (length(trim(code)) > 0),
  CONSTRAINT chk_non_follow_up_reasons_name CHECK (length(trim(name)) > 0)
);
DROP TRIGGER IF EXISTS trg_non_follow_up_reasons_set_updated_at ON non_follow_up_reasons;
CREATE TRIGGER trg_non_follow_up_reasons_set_updated_at
  BEFORE UPDATE ON non_follow_up_reasons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO school_affiliations (code, name)
VALUES
  ('สพฐ', 'สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน'),
  ('สช', 'สำนักงานคณะกรรมการส่งเสริมการศึกษาเอกชน'),
  ('อปท', 'องค์กรปกครองส่วนท้องถิ่น'),
  ('กทม', 'กรุงเทพมหานคร'),
  ('มกท', 'เมืองพัทยา')
ON CONFLICT (code) DO NOTHING;

INSERT INTO disability_types (code, name, legal_category)
VALUES
  ('NONE', 'ไม่มีความพิการ', NULL),
  ('VISUAL', 'ความบกพร่องทางการเห็น', 'ความพิการทางการเห็น'),
  ('HEARING', 'ความบกพร่องทางการได้ยินหรือสื่อความหมาย', 'ความพิการทางการได้ยินหรือสื่อความหมาย'),
  ('INTELLECTUAL', 'ความบกพร่องทางสติปัญญา', 'ความพิการทางสติปัญญา'),
  ('PHYSICAL_HEALTH', 'ความบกพร่องทางร่างกายหรือสุขภาพ', 'ความพิการทางร่างกายหรือการเคลื่อนไหว'),
  ('LEARNING', 'ความบกพร่องทางการเรียนรู้', 'ความพิการทางการเรียนรู้'),
  ('SPEECH_LANGUAGE', 'ความบกพร่องทางการพูดและภาษา', 'ความพิการทางการพูดและภาษา'),
  ('BEHAVIOR_EMOTION', 'ความบกพร่องทางพฤติกรรมหรืออารมณ์', 'ความพิการทางพฤติกรรมหรืออารมณ์'),
  ('AUTISM', 'ออทิสติก', 'ออทิสติก'),
  ('MULTIPLE', 'ความพิการซ้อน', 'ความพิการซ้อน')
ON CONFLICT (code) DO NOTHING;
