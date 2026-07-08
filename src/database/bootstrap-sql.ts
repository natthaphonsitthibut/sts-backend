import { SYSTEM_ROLE_DEFINITIONS } from '../auth/permissions.constants';
import { SYSTEM_SETTING_CATALOG } from '../settings/settings-catalog';

interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

interface SystemSettingDefinition {
  key: string;
  value: string;
  description: string;
}

export const SYSTEM_SETTING_DEFINITIONS: SystemSettingDefinition[] = SYSTEM_SETTING_CATALOG.map(
  (entry) => ({
    key: entry.key,
    value: entry.defaultValue,
    description: entry.description,
  }),
);

/**
 * Deterministic postal-code backfill for the demo roster locations. The match
 * includes province + district + sub-district so production rows outside the
 * verified seed locations stay NULL instead of receiving a guessed value.
 */
export const STUDENT_TERM_POSTAL_CODE_BACKFILL_SQL = `
  UPDATE student_term AS student
  SET "PostalCode_Onec" = postal.postal_code
  FROM (
    VALUES
      ('กรุงเทพมหานคร', 'ดอนเมือง', 'ดอนเมือง', '10210'),
      ('กรุงเทพมหานคร', 'ดอนเมือง', 'สนามบิน', '10210'),
      ('กรุงเทพมหานคร', 'ดอนเมือง', 'สีกัน', '10210'),
      ('กรุงเทพมหานคร', 'พระนคร', 'พระบรมมหาราชวัง', '10200'),
      ('กรุงเทพมหานคร', 'พระนคร', 'วังบูรพาภิรมย์', '10200'),
      ('กรุงเทพมหานคร', 'พระนคร', 'วัดราชบพิธ', '10200'),
      ('กรุงเทพมหานคร', 'พระนคร', 'สำราญราษฎร์', '10200'),
      ('ขอนแก่น', 'เมืองขอนแก่น', 'บ้านทุ่ม', '40000'),
      ('ขอนแก่น', 'เมืองขอนแก่น', 'พระลับ', '40000'),
      ('ขอนแก่น', 'เมืองขอนแก่น', 'สาวะถี', '40000'),
      ('ขอนแก่น', 'เมืองขอนแก่น', 'เมืองเก่า', '40000'),
      ('ขอนแก่น', 'เมืองขอนแก่น', 'ในเมือง', '40000'),
      ('ตรัง', 'เมืองตรัง', 'ทับเที่ยง', '92000'),
      ('ตรัง', 'เมืองตรัง', 'นาตาล่วง', '92000'),
      ('ตรัง', 'เมืองตรัง', 'นาพละ', '92000'),
      ('ตรัง', 'เมืองตรัง', 'บ้านควน', '92000'),
      ('นครปฐม', 'เมืองนครปฐม', 'บางแขม', '73000'),
      ('นครปฐม', 'เมืองนครปฐม', 'พระปฐมเจดีย์', '73000'),
      ('นครปฐม', 'เมืองนครปฐม', 'พระประโทน', '73000'),
      ('นครปฐม', 'เมืองนครปฐม', 'สามควายเผือก', '73000'),
      ('นครราชสีมา', 'เมืองนครราชสีมา', 'มะเริง', '30000'),
      ('นครราชสีมา', 'เมืองนครราชสีมา', 'หนองจะบก', '30000'),
      ('นครราชสีมา', 'เมืองนครราชสีมา', 'โคกสูง', '30000'),
      ('นครราชสีมา', 'เมืองนครราชสีมา', 'โพธิ์กลาง', '30000'),
      ('นครราชสีมา', 'เมืองนครราชสีมา', 'ในเมือง', '30000'),
      ('อุดรธานี', 'เมืองอุดรธานี', 'นิคมสงเคราะห์', '41000'),
      ('อุดรธานี', 'เมืองอุดรธานี', 'บ้านขาว', '41000'),
      ('อุดรธานี', 'เมืองอุดรธานี', 'บ้านจั่น', '41000'),
      ('อุดรธานี', 'เมืองอุดรธานี', 'หนองบัว', '41000'),
      ('อุดรธานี', 'เมืองอุดรธานี', 'หมากแข้ง', '41000'),
      ('อุบลราชธานี', 'เมืองอุบลราชธานี', 'ขามใหญ่', '34000'),
      ('อุบลราชธานี', 'เมืองอุบลราชธานี', 'ปทุม', '34000'),
      ('อุบลราชธานี', 'เมืองอุบลราชธานี', 'หนองขอน', '34000'),
      ('อุบลราชธานี', 'เมืองอุบลราชธานี', 'หัวเรือ', '34000'),
      ('อุบลราชธานี', 'เมืองอุบลราชธานี', 'ในเมือง', '34000'),
      ('เชียงราย', 'เมืองเชียงราย', 'นางแล', '57000'),
      ('เชียงราย', 'เมืองเชียงราย', 'บ้านดู่', '57000'),
      ('เชียงราย', 'เมืองเชียงราย', 'รอบเวียง', '57000'),
      ('เชียงราย', 'เมืองเชียงราย', 'เวียง', '57000'),
      ('เชียงราย', 'เมืองเชียงราย', 'แม่กรณ์', '57000'),
      ('เชียงใหม่', 'เมืองเชียงใหม่', 'ช้างมอย', '50000'),
      ('เชียงใหม่', 'เมืองเชียงใหม่', 'พระสิงห์', '50000'),
      ('เชียงใหม่', 'เมืองเชียงใหม่', 'ศรีภูมิ', '50000'),
      ('เชียงใหม่', 'เมืองเชียงใหม่', 'สุเทพ', '50000'),
      ('เชียงใหม่', 'เมืองเชียงใหม่', 'หายยา', '50000')
  ) AS postal(province, district, sub_district, postal_code)
  WHERE student."PostalCode_Onec" IS NULL
    AND student."ProvinceNameThai_Onec" = postal.province
    AND student."DistrictNameThai_Onec" = postal.district
    AND student."SubDistrictNameThai_Onec" = postal.sub_district;
`;

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

const SYSTEM_ROLE_BASELINE_SQL = SYSTEM_ROLE_DEFINITIONS.map(
  (role) => `
  INSERT INTO roles (
    name, label, rank, default_permissions, scope_mode, scope_policy, is_assignable, is_system
  )
  VALUES ('${escapeSqlLiteral(role.name)}', '${escapeSqlLiteral(role.label)}', ${role.rank}, '${escapeSqlLiteral(JSON.stringify(role.default_permissions))}'::jsonb, '${escapeSqlLiteral(role.scope_mode)}', '${role.scope_policy}', ${role.is_assignable ? 'TRUE' : 'FALSE'}, ${role.is_system ? 'TRUE' : 'FALSE'})
  ON CONFLICT (name) DO NOTHING;`,
).join('\n');

const SYSTEM_SETTING_BASELINE_SQL = SYSTEM_SETTING_DEFINITIONS.map(
  (setting) => `
  INSERT INTO system_settings (setting_key, setting_value, description)
  VALUES ('${escapeSqlLiteral(setting.key)}', '${escapeSqlLiteral(setting.value)}', '${escapeSqlLiteral(setting.description)}')
  ON CONFLICT (setting_key) DO NOTHING;`,
).join('\n');

/**
 * Standard audit columns for NEW tables (audit-columns standard, Phase 1).
 * Embed inside a CREATE TABLE column list, then attach the updated_at trigger
 * with {@link auditUpdatedAtTriggerSql}.
 * - timestamps are TIMESTAMPTZ (UTC-correct); `created_at` defaults to now() and
 *   `updated_at` is bumped by the shared `set_updated_at()` trigger.
 * - `*_by` are nullable FKs to users(id) filled from the authenticated actor
 *   (see common/audit/audit-actor.util.ts). Nullable + ON DELETE SET NULL so
 *   external / magic-link actors and deleted users don't break history.
 * - `deleted_at`/`deleted_by` are for soft delete (NULL = live row).
 * Tables using this MUST be created after `users` (FK dependency).
 */
export const AUDIT_COLUMNS_SQL = `created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    deleted_at TIMESTAMPTZ,
    deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL`;

/**
 * Shared trigger function that keeps `updated_at` accurate on every UPDATE.
 * Postgres has no built-in "on update" timestamp, so audited tables attach this
 * via {@link auditUpdatedAtTriggerSql}. Idempotent (CREATE OR REPLACE).
 */
export const SET_UPDATED_AT_FUNCTION_SQL = `CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS trigger AS $$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;`;

/** BEFORE UPDATE trigger that bumps updated_at for one audited table. */
export function auditUpdatedAtTriggerSql(table: string): string {
  return `DROP TRIGGER IF EXISTS trg_${table}_set_updated_at ON ${table};
  CREATE TRIGGER trg_${table}_set_updated_at
    BEFORE UPDATE ON ${table}
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();`;
}

/**
 * Tables retrofitted with the standard audit columns (Phase 2a). Used by both
 * the baseline (fresh installs) and the Phase 2a migration (existing DBs) so the
 * two never drift. `created_by`/`updated_by` start NULL and are filled by the
 * service layer; `created_at`/`updated_at` are DB-managed.
 */
export const AUDIT_RETROFIT_TABLES = [
  'users',
  'roles',
  'cases',
  'tasks',
  'task_links',
  'task_submissions',
  'case_reviews',
  'attendance',
  'system_settings',
  'schools',
] as const;

/**
 * Idempotently adds the standard audit columns + updated_at trigger to every
 * table in {@link AUDIT_RETROFIT_TABLES}, normalizes any pre-existing plain
 * `timestamp` columns to `timestamptz`, backfills nulls, and enforces
 * NOT NULL + DEFAULT now() on the timestamps. Safe to run repeatedly.
 */
export const AUDIT_RETROFIT_SQL = `
  DO $audit$
  DECLARE
    t text;
    audit_tables text[] := ARRAY[${AUDIT_RETROFIT_TABLES.map((name) => `'${name}'`).join(', ')}];
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
`;

/**
 * Async large-batch student-account generation job + per-candidate items.
 * Shared by the fresh-install baseline and the AddStudentAccountBatchJob
 * migration so the two never drift. Depends on `users` (FK) and the
 * `set_updated_at()` trigger function existing first. The job never stores
 * plaintext credentials — printable credentials are produced on demand via the
 * existing reissue (rotate) path, so items keep only non-secret fields.
 */
export const STUDENT_ACCOUNT_BATCH_TABLES_SQL = `
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
`;

/** Persistent, scope-addressable review queue for invalid student import rows. */
export const STUDENT_IMPORT_QUARANTINE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS student_import_quarantine_statuses (
    code VARCHAR(16) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_student_import_quarantine_statuses_code
      CHECK (code IN ('PENDING', 'RESOLVED', 'REJECTED')),
    CONSTRAINT chk_student_import_quarantine_statuses_badge_variant
      CHECK (badge_variant IN ('default', 'secondary', 'destructive', 'success', 'warning')),
    CONSTRAINT chk_student_import_quarantine_statuses_sort_order CHECK (sort_order >= 0),
    CONSTRAINT chk_student_import_quarantine_statuses_label_th CHECK (length(trim(label_th)) > 0)
  );
  ${auditUpdatedAtTriggerSql('student_import_quarantine_statuses')}
  INSERT INTO student_import_quarantine_statuses (code, label_th, badge_variant, sort_order)
  VALUES
    ('PENDING', 'รอตรวจสอบ', 'warning', 10),
    ('RESOLVED', 'แก้ไขแล้ว', 'success', 20),
    ('REJECTED', 'ปฏิเสธแล้ว', 'secondary', 30)
  ON CONFLICT (code) DO UPDATE
  SET label_th = EXCLUDED.label_th,
      badge_variant = EXCLUDED.badge_variant,
      sort_order = EXCLUDED.sort_order;

  CREATE TABLE IF NOT EXISTS student_import_quarantine_reason_codes (
    code VARCHAR(64) PRIMARY KEY,
    label_th VARCHAR(160) NOT NULL,
    sort_order SMALLINT NOT NULL,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_student_import_quarantine_reason_codes_sort_order CHECK (sort_order >= 0),
    CONSTRAINT chk_student_import_quarantine_reason_codes_label_th CHECK (length(trim(label_th)) > 0)
  );
  ${auditUpdatedAtTriggerSql('student_import_quarantine_reason_codes')}
  INSERT INTO student_import_quarantine_reason_codes (code, label_th, sort_order)
  VALUES
    ('IDENTIFIER_CONFLICT', 'เลขนี้ตรงกับหลายโปรไฟล์ในระบบ', 10),
    ('UNMAPPED_STUDENT_STATUS', 'สถานะนักเรียนยังไม่จับคู่', 20),
    ('MISSING_NATURAL_KEY_FIELD', 'ข้อมูลภาคเรียนบังคับไม่ครบหรือไม่ถูกต้อง', 30),
    ('BLANK_REQUIRED_IDENTITY', 'ไม่มีรหัสประจำตัว', 40),
    ('DUPLICATE_ROW_IN_FILE', 'แถวซ้ำในไฟล์', 50),
    ('MULTIPLE_ACTIVE_ENROLLMENTS', 'พบการลงทะเบียนที่ยังใช้งานหลายรายการ', 60),
    ('NAME_CONFLICT_FOR_IDENTIFIER', 'ชื่อไม่ตรงกับรหัสประจำตัวเดิม', 70),
    ('INVALID_NATIONAL_ID_CHECKSUM', 'เลขประจำตัวประชาชนไม่ผ่านการตรวจสอบ', 80),
    ('SCHOOL_NOT_FOUND', 'ไม่พบโรงเรียนในข้อมูลหลัก', 90),
    ('GRADE_NOT_FOUND', 'ไม่พบชั้นเรียนในข้อมูลหลัก', 100),
    ('ROOM_NOT_FOUND', 'ไม่พบห้องเรียนในข้อมูลหลัก', 110),
    ('STATUS_CAUSE_UNMAPPED', 'สาเหตุสถานะนักเรียนยังไม่จับคู่', 120)
  ON CONFLICT (code) DO UPDATE
  SET label_th = EXCLUDED.label_th,
      sort_order = EXCLUDED.sort_order;

  CREATE TABLE IF NOT EXISTS student_import_quarantine_resolution_states (
    code VARCHAR(32) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_student_import_quarantine_resolution_states_code
      CHECK (code IN ('ACTION_REQUIRED', 'DECISION_REQUIRED', 'RETRY_ELIGIBLE', 'BLOCKED')),
    CONSTRAINT chk_student_import_quarantine_resolution_states_badge_variant
      CHECK (badge_variant IN ('default', 'secondary', 'destructive', 'success', 'warning')),
    CONSTRAINT chk_student_import_quarantine_resolution_states_sort_order CHECK (sort_order >= 0),
    CONSTRAINT chk_student_import_quarantine_resolution_states_label_th CHECK (length(trim(label_th)) > 0)
  );
  ${auditUpdatedAtTriggerSql('student_import_quarantine_resolution_states')}
  INSERT INTO student_import_quarantine_resolution_states (
    code, label_th, badge_variant, sort_order
  )
  VALUES
    ('ACTION_REQUIRED', 'ต้องแก้ข้อมูล', 'warning', 10),
    ('DECISION_REQUIRED', 'ต้องตัดสินใจ', 'default', 20),
    ('RETRY_ELIGIBLE', 'ผ่านการตรวจเบื้องต้น', 'success', 30),
    ('BLOCKED', 'ต้องตรวจสอบเพิ่มเติม', 'secondary', 40)
  ON CONFLICT (code) DO UPDATE
  SET label_th = EXCLUDED.label_th,
      badge_variant = EXCLUDED.badge_variant,
      sort_order = EXCLUDED.sort_order;

  CREATE TABLE IF NOT EXISTS student_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target VARCHAR(32) NOT NULL,
    source_sha256 CHAR(64) NOT NULL,
    scope_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
    imported_rows INTEGER NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
    quarantined_rows INTEGER NOT NULL DEFAULT 0 CHECK (quarantined_rows >= 0),
    completed_at TIMESTAMPTZ,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_student_import_batches_target
      CHECK (target IN ('student_term', 'student_dropouts')),
    CONSTRAINT chk_student_import_batches_source_sha256
      CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_student_import_batches_status
      CHECK (status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED'))
  );
  ${auditUpdatedAtTriggerSql('student_import_batches')}
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
    row_fingerprint CHAR(64) NOT NULL,
    reason_code VARCHAR(64) NOT NULL,
    mapped_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    resolved_person_uuid UUID REFERENCES student_person(person_uuid)
      ON DELETE SET NULL ON UPDATE CASCADE,
    resolved_at TIMESTAMPTZ,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    resolution_note TEXT,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_student_import_quarantine_row_fingerprint
      CHECK (row_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT fk_student_import_quarantine_rows_reason_code
      FOREIGN KEY (reason_code) REFERENCES student_import_quarantine_reason_codes(code)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_student_import_quarantine_rows_status
      FOREIGN KEY (status) REFERENCES student_import_quarantine_statuses(code)
      ON DELETE RESTRICT ON UPDATE CASCADE
  );
  ${auditUpdatedAtTriggerSql('student_import_quarantine_rows')}
  CREATE UNIQUE INDEX IF NOT EXISTS uq_student_import_quarantine_pending_row
    ON student_import_quarantine_rows (row_fingerprint, reason_code)
    WHERE status = 'PENDING' AND deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_student_import_quarantine_batch_status
    ON student_import_quarantine_rows (batch_id, status);
  CREATE INDEX IF NOT EXISTS idx_student_import_quarantine_school_status
    ON student_import_quarantine_rows (school_id, status, created_at DESC);
`;

export const CASE_WORKFLOW_STATUS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS case_workflow_statuses (
    code VARCHAR(32) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    summary_tone VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_case_workflow_statuses_label_th CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_case_workflow_statuses_badge_variant
      CHECK (badge_variant IN ('default', 'secondary', 'destructive', 'success', 'warning')),
    CONSTRAINT chk_case_workflow_statuses_summary_tone
      CHECK (summary_tone IN ('default', 'success', 'warning', 'danger', 'info')),
    CONSTRAINT chk_case_workflow_statuses_sort_order CHECK (sort_order >= 0)
  );
  ${auditUpdatedAtTriggerSql('case_workflow_statuses')}
  INSERT INTO case_workflow_statuses (
    code, label_th, badge_variant, summary_tone, sort_order
  ) VALUES
    ('OPEN', 'รอสร้างลิงก์', 'secondary', 'default', 10),
    ('PENDING_REVIEW', 'รอตรวจผล', 'default', 'info', 20),
    ('IN_PROGRESS', 'กำลังติดตาม', 'warning', 'warning', 30),
    ('AWAITING_HELP', 'รอช่วยเหลือ', 'destructive', 'danger', 40),
    ('RESOLVED', 'ปิดเคสแล้ว', 'success', 'success', 50)
  ON CONFLICT (code) DO NOTHING;
  ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_cases_status;
  DO $case_workflow_status_fk$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_cases_workflow_status'
    ) THEN
      ALTER TABLE cases
        ADD CONSTRAINT fk_cases_workflow_status
        FOREIGN KEY (status) REFERENCES case_workflow_statuses(code)
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
  END $case_workflow_status_fk$;
`;

export const OPERATIONAL_STATUS_CATALOG_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS user_account_statuses (
    code VARCHAR(16) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_user_account_statuses_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_user_account_statuses_badge CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
  );
  ${auditUpdatedAtTriggerSql('user_account_statuses')}
  INSERT INTO user_account_statuses (code, label_th, badge_variant, sort_order) VALUES
    ('ACTIVE', 'ใช้งาน', 'success', 10),
    ('DISABLED', 'ปิดใช้งาน', 'destructive', 20)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS task_workflow_statuses (
    code VARCHAR(32) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_task_workflow_statuses_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_task_workflow_statuses_badge CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
  );
  ${auditUpdatedAtTriggerSql('task_workflow_statuses')}
  INSERT INTO task_workflow_statuses (code, label_th, badge_variant, sort_order) VALUES
    ('OPEN', 'เปิดอยู่', 'secondary', 10),
    ('ACTIVE', 'ใช้งาน', 'success', 20),
    ('IN_PROGRESS', 'กำลังดำเนินการ', 'warning', 30),
    ('PENDING_REVIEW', 'รอตรวจผล', 'default', 40),
    ('COMPLETED', 'เสร็จสิ้น', 'success', 50)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS task_link_statuses (
    code VARCHAR(16) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_task_link_statuses_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_task_link_statuses_badge CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
  );
  ${auditUpdatedAtTriggerSql('task_link_statuses')}
  INSERT INTO task_link_statuses (code, label_th, badge_variant, sort_order) VALUES
    ('ACTIVE', 'ใช้งาน', 'success', 10),
    ('DELEGATED', 'ส่งต่อแล้ว', 'secondary', 20),
    ('COMPLETED', 'เสร็จสิ้น', 'success', 30)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS attendance_record_statuses (
    code SMALLINT PRIMARY KEY,
    internal_code VARCHAR(16) NOT NULL UNIQUE,
    short_label_th VARCHAR(40) NOT NULL,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_attendance_record_statuses_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_attendance_record_statuses_badge CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
  );
  ${auditUpdatedAtTriggerSql('attendance_record_statuses')}
  INSERT INTO attendance_record_statuses (
    code, internal_code, short_label_th, label_th, badge_variant, sort_order
  ) VALUES
    (1, 'P_PRESENT', 'มา', 'มาเรียน', 'success', 10),
    (2, 'P_ABSENT', 'ขาด', 'ขาดเรียน', 'destructive', 20),
    (3, 'P_LATE', 'สาย', 'มาสาย', 'warning', 30)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS school_term_statuses (
    code VARCHAR(16) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_school_term_statuses_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_school_term_statuses_badge CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
  );
  ${auditUpdatedAtTriggerSql('school_term_statuses')}
  INSERT INTO school_term_statuses (code, label_th, badge_variant, sort_order) VALUES
    ('DRAFT', 'ร่าง', 'warning', 10),
    ('ACTIVE', 'เปิดใช้งาน', 'success', 20),
    ('CLOSED', 'ปิดภาคเรียน', 'secondary', 30)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS school_calendar_day_types (
    code VARCHAR(16) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_school_calendar_day_types_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_school_calendar_day_types_badge CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
  );
  ${auditUpdatedAtTriggerSql('school_calendar_day_types')}
  INSERT INTO school_calendar_day_types (code, label_th, badge_variant, sort_order) VALUES
    ('SCHOOL_DAY', 'วันเรียน', 'success', 10),
    ('HOLIDAY', 'วันหยุด', 'secondary', 20),
    ('CANCELLED', 'ยกเลิกการเรียน', 'warning', 30)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS attendance_session_statuses (
    code VARCHAR(16) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_attendance_session_statuses_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_attendance_session_statuses_badge CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
  );
  ${auditUpdatedAtTriggerSql('attendance_session_statuses')}
  INSERT INTO attendance_session_statuses (code, label_th, badge_variant, sort_order) VALUES
    ('OPEN', 'เปิดเช็คชื่อ', 'warning', 10),
    ('SUBMITTED', 'ส่งแล้ว', 'success', 20),
    ('REOPENED', 'เปิดแก้ไข', 'warning', 30),
    ('VOIDED', 'ยกเลิก', 'destructive', 40)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS student_account_batch_job_statuses (
    code VARCHAR(16) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_student_account_batch_job_statuses_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_student_account_batch_job_statuses_badge CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
  );
  ${auditUpdatedAtTriggerSql('student_account_batch_job_statuses')}
  INSERT INTO student_account_batch_job_statuses (code, label_th, badge_variant, sort_order) VALUES
    ('PENDING', 'รอเริ่ม', 'secondary', 10),
    ('RUNNING', 'กำลังทำงาน', 'default', 20),
    ('COMPLETED', 'เสร็จสิ้น', 'success', 30),
    ('FAILED', 'ล้มเหลว', 'destructive', 40),
    ('INTERRUPTED', 'หยุดชะงัก', 'warning', 50),
    ('CANCELED', 'ยกเลิกแล้ว', 'secondary', 60)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS student_account_batch_item_statuses (
    code VARCHAR(16) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_student_account_batch_item_statuses_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_student_account_batch_item_statuses_badge CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
  );
  ${auditUpdatedAtTriggerSql('student_account_batch_item_statuses')}
  INSERT INTO student_account_batch_item_statuses (code, label_th, badge_variant, sort_order) VALUES
    ('PENDING', 'รอดำเนินการ', 'secondary', 10),
    ('CREATED', 'สร้างแล้ว', 'success', 20),
    ('SKIPPED', 'ข้าม', 'warning', 30),
    ('FAILED', 'ล้มเหลว', 'destructive', 40)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS case_referral_statuses (
    code VARCHAR(16) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_case_referral_statuses_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_case_referral_statuses_badge CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
  );
  ${auditUpdatedAtTriggerSql('case_referral_statuses')}
  INSERT INTO case_referral_statuses (code, label_th, badge_variant, sort_order) VALUES
    ('SENT', 'ส่งต่อแล้ว', 'default', 10),
    ('ACKNOWLEDGED', 'รับทราบแล้ว', 'secondary', 20),
    ('ACCEPTED', 'รับดำเนินการ', 'success', 30),
    ('DECLINED', 'ปฏิเสธรับเรื่อง', 'destructive', 40),
    ('RETURNED', 'ส่งกลับ', 'warning', 50)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS student_import_batch_statuses (
    code VARCHAR(16) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_student_import_batch_statuses_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_student_import_batch_statuses_badge CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
  );
  ${auditUpdatedAtTriggerSql('student_import_batch_statuses')}
  INSERT INTO student_import_batch_statuses (code, label_th, badge_variant, sort_order) VALUES
    ('RUNNING', 'กำลังนำเข้า', 'default', 10),
    ('COMPLETED', 'สำเร็จ', 'success', 20),
    ('PARTIAL', 'สำเร็จบางส่วน', 'warning', 30),
    ('FAILED', 'ล้มเหลว', 'destructive', 40)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS application_display_states (
    domain_code VARCHAR(48) NOT NULL,
    code VARCHAR(32) NOT NULL,
    label_th VARCHAR(100) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL,
    summary_tone VARCHAR(16),
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    PRIMARY KEY (domain_code, code),
    CONSTRAINT chk_application_display_states_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_application_display_states_badge CHECK (badge_variant IN ('default','secondary','destructive','success','warning')),
    CONSTRAINT chk_application_display_states_summary CHECK (summary_tone IS NULL OR summary_tone IN ('default','success','warning','danger','info'))
  );
  ${auditUpdatedAtTriggerSql('application_display_states')}
  INSERT INTO application_display_states (
    domain_code, code, label_th, badge_variant, summary_tone, sort_order
  ) VALUES
    ('USER_ACCOUNT_LIFECYCLE', 'PENDING_FIRST_LOGIN', 'รอเปลี่ยนรหัส', 'default', 'info', 10),
    ('USER_ACCOUNT_LIFECYCLE', 'ACTIVE', 'ใช้งาน', 'success', 'success', 20),
    ('USER_ACCOUNT_LIFECYCLE', 'TEMP_PASSWORD_EXPIRED', 'รหัสหมดอายุ', 'warning', 'warning', 30),
    ('USER_ACCOUNT_LIFECYCLE', 'DISABLED', 'ปิดใช้งาน', 'destructive', 'danger', 40),
    ('TASK_LINK_STATE', 'ACTIVE', 'ใช้งาน', 'success', NULL, 10),
    ('TASK_LINK_STATE', 'LOCKED', 'ปิดใช้งาน', 'destructive', NULL, 20),
    ('TASK_LINK_STATE', 'EXPIRED', 'หมดอายุ', 'warning', NULL, 30),
    ('TASK_LINK_STATE', 'COMPLETED', 'เสร็จสิ้น', 'success', NULL, 40),
    ('TASK_LINK_STATE', 'DELEGATED', 'ส่งต่อแล้ว', 'secondary', NULL, 50),
    ('LOGIN_LINK_USAGE', 'USED', 'เข้าใช้แล้ว', 'success', NULL, 10),
    ('LOGIN_LINK_USAGE', 'UNUSED', 'ยังไม่เข้าใช้', 'secondary', NULL, 20),
    ('ATTENDANCE_RECONCILIATION', 'COMPLETED', 'ครบ', 'success', NULL, 10),
    ('ATTENDANCE_RECONCILIATION', 'MISSING', 'ยังไม่เช็ค', 'destructive', NULL, 20),
    ('ATTENDANCE_RECONCILIATION', 'INCOMPLETE', 'ไม่ครบ', 'warning', NULL, 30),
    ('RECORD_ACTIVITY', 'ACTIVE', 'เปิดใช้งาน', 'success', NULL, 10),
    ('RECORD_ACTIVITY', 'INACTIVE', 'ปิดใช้งาน', 'secondary', NULL, 20),
    ('STUDENT_STATUS_FLAG', 'LOGIN_ALLOWED', 'นโยบาย: เข้าสู่ระบบได้', 'success', NULL, 10),
    ('STUDENT_STATUS_FLAG', 'TERMINAL', 'สิ้นสุด', 'secondary', NULL, 20),
    ('STUDENT_STATUS_FLAG', 'FOLLOWUP_REQUIRED', 'ควรพิจารณาติดตาม', 'warning', NULL, 30),
    ('STUDENT_STATUS_FLAG', 'DISABLED', 'ปิดใช้งาน', 'destructive', NULL, 40),
    ('ROLE_ORIGIN', 'SYSTEM', 'ระบบ', 'secondary', NULL, 10),
    ('ATTENDANCE_ANOMALY', 'HOLIDAY_ATTENDANCE', 'เช็คชื่อในวันหยุด', 'warning', NULL, 10),
    ('ATTENDANCE_ANOMALY', 'CANCELLED_ATTENDANCE', 'เช็คชื่อในวันที่ยกเลิกเรียน', 'warning', NULL, 20),
    ('ATTENDANCE_ANOMALY', 'OUT_OF_TERM', 'เช็คชื่อนอกช่วงภาคเรียน', 'destructive', NULL, 30),
    ('ATTENDANCE_ANOMALY', 'MISSING_CALENDAR_DAY', 'ไม่มีวันในปฏิทิน', 'secondary', NULL, 40)
  ON CONFLICT (domain_code, code) DO NOTHING;

  ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_status;
  ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_status;
  ALTER TABLE school_terms DROP CONSTRAINT IF EXISTS chk_school_terms_status;
  ALTER TABLE school_calendar_days DROP CONSTRAINT IF EXISTS chk_school_calendar_days_type;
  ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS chk_attendance_sessions_status;
  ALTER TABLE student_account_batch_job DROP CONSTRAINT IF EXISTS chk_student_account_batch_job_status;
  ALTER TABLE student_account_batch_job_item DROP CONSTRAINT IF EXISTS chk_student_account_batch_job_item_status;
  ALTER TABLE case_referrals DROP CONSTRAINT IF EXISTS chk_case_referrals_status;
  ALTER TABLE student_import_batches DROP CONSTRAINT IF EXISTS chk_student_import_batches_status;

  DO $operational_status_fks$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_account_status') THEN
      ALTER TABLE users ADD CONSTRAINT fk_users_account_status FOREIGN KEY (status)
        REFERENCES user_account_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_workflow_status') THEN
      ALTER TABLE tasks ADD CONSTRAINT fk_tasks_workflow_status FOREIGN KEY (status)
        REFERENCES task_workflow_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_task_links_status') THEN
      ALTER TABLE task_links ADD CONSTRAINT fk_task_links_status FOREIGN KEY (status)
        REFERENCES task_link_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_record_status') THEN
      ALTER TABLE attendance ADD CONSTRAINT fk_attendance_record_status FOREIGN KEY ("AttendanceStatus")
        REFERENCES attendance_record_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_school_terms_status') THEN
      ALTER TABLE school_terms ADD CONSTRAINT fk_school_terms_status FOREIGN KEY (status)
        REFERENCES school_term_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_school_calendar_days_type') THEN
      ALTER TABLE school_calendar_days ADD CONSTRAINT fk_school_calendar_days_type FOREIGN KEY (day_type)
        REFERENCES school_calendar_day_types(code) ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_sessions_status') THEN
      ALTER TABLE attendance_sessions ADD CONSTRAINT fk_attendance_sessions_status FOREIGN KEY (status)
        REFERENCES attendance_session_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_account_batch_job_status') THEN
      ALTER TABLE student_account_batch_job ADD CONSTRAINT fk_student_account_batch_job_status FOREIGN KEY (status)
        REFERENCES student_account_batch_job_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_account_batch_item_status') THEN
      ALTER TABLE student_account_batch_job_item ADD CONSTRAINT fk_student_account_batch_item_status FOREIGN KEY (status)
        REFERENCES student_account_batch_item_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_case_referrals_status') THEN
      ALTER TABLE case_referrals ADD CONSTRAINT fk_case_referrals_status FOREIGN KEY (status)
        REFERENCES case_referral_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_import_batches_status') THEN
      ALTER TABLE student_import_batches ADD CONSTRAINT fk_student_import_batches_status FOREIGN KEY (status)
        REFERENCES student_import_batch_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
  END $operational_status_fks$;
`;

export const DATA_RECORD_ORIGINS_SQL = `
  CREATE TABLE IF NOT EXISTS data_record_origins (
    code VARCHAR(32) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    is_visible_by_default BOOLEAN NOT NULL,
    sort_order SMALLINT NOT NULL,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_data_record_origins_label CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_data_record_origins_sort_order CHECK (sort_order >= 0)
  );
  ${auditUpdatedAtTriggerSql('data_record_origins')}
  INSERT INTO data_record_origins (code, label_th, is_visible_by_default, sort_order) VALUES
    ('OPERATIONAL', 'ข้อมูลใช้งานจริง', TRUE, 10),
    ('DEMO', 'ข้อมูลสาธิต', TRUE, 20),
    ('AUTOMATED_TEST', 'ข้อมูลทดสอบอัตโนมัติ', FALSE, 30)
  ON CONFLICT (code) DO NOTHING;
`;

export const STUDENT_CURRENT_ENROLLMENT_VIEW_SQL = `
  CREATE OR REPLACE VIEW student_current_enrollment_resolution AS
  WITH ranked_enrollments AS (
    SELECT
      enrollment.person_uuid,
      enrollment.student_uuid,
      enrollment."AcademicYear_Onec" AS academic_year,
      enrollment."Semester_Onec" AS semester,
      status.category AS status_category,
      status.is_active_for_login,
      status.is_enabled,
      DENSE_RANK() OVER (
        PARTITION BY enrollment.person_uuid
        ORDER BY enrollment."AcademicYear_Onec" DESC NULLS LAST,
                 enrollment."Semester_Onec" DESC NULLS LAST
      ) AS term_rank
    FROM student_term enrollment
    LEFT JOIN student_status status
      ON status.code = COALESCE(
        enrollment.student_status_code,
        enrollment."StudentStatusID_Onec"
      )
     AND status.deleted_at IS NULL
    WHERE enrollment.person_uuid IS NOT NULL
      AND enrollment.deleted_at IS NULL
  ),
  latest_term AS (
    SELECT *
    FROM ranked_enrollments
    WHERE term_rank = 1
  )
  SELECT
    person_uuid,
    MAX(academic_year) AS academic_year,
    MAX(semester) AS semester,
    COUNT(*)::integer AS latest_enrollment_count,
    COUNT(*) FILTER (
      WHERE status_category = 'ACTIVE'
        AND is_active_for_login IS TRUE
        AND is_enabled IS TRUE
    )::integer AS active_enrollment_count,
    COUNT(*) FILTER (
      WHERE status_category IS NULL
         OR status_category = 'UNMAPPED'
         OR is_enabled IS NOT TRUE
    )::integer AS unresolved_status_count,
    CASE
      WHEN COUNT(*) FILTER (
        WHERE status_category IS NULL
           OR status_category = 'UNMAPPED'
           OR is_enabled IS NOT TRUE
      ) > 0 THEN 'STATUS_UNRESOLVED'
      WHEN COUNT(*) FILTER (
        WHERE status_category = 'ACTIVE'
          AND is_active_for_login IS TRUE
          AND is_enabled IS TRUE
      ) = 1 THEN 'ACTIVE'
      WHEN COUNT(*) FILTER (
        WHERE status_category = 'ACTIVE'
          AND is_active_for_login IS TRUE
          AND is_enabled IS TRUE
      ) > 1 THEN 'AMBIGUOUS_ACTIVE'
      ELSE 'INACTIVE'
    END::varchar(32) AS resolution_state,
    (
      ARRAY_AGG(student_uuid ORDER BY student_uuid) FILTER (
        WHERE status_category = 'ACTIVE'
          AND is_active_for_login IS TRUE
          AND is_enabled IS TRUE
      )
    )[1] AS selected_student_uuid
  FROM latest_term
  GROUP BY person_uuid;
`;

export const NOTIFICATION_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS notification_types (
    code VARCHAR(64) PRIMARY KEY,
    label_th VARCHAR(120) NOT NULL,
    required_permission VARCHAR(64) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_notification_types_label_th CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_notification_types_required_permission
      CHECK (length(trim(required_permission)) > 0)
  );

  INSERT INTO notification_types (code, label_th, required_permission, sort_order)
  VALUES
    ('CASE_CREATED', 'เคสติดตามใหม่', 'review-cases', 10),
    ('CASE_STATUS_CHANGED', 'เคสเปลี่ยนสถานะ', 'review-cases', 20),
    ('TASK_DELEGATED', 'งานถูกส่งต่อ', 'attendance-dashboard', 30),
    ('TASK_SUBMITTED', 'มีรายงานส่งกลับ', 'attendance-dashboard', 40),
    ('IMPORT_COMPLETED', 'นำเข้าข้อมูลเสร็จแล้ว', 'import-data', 50),
    ('IMPORT_FAILED', 'นำเข้าข้อมูลไม่สำเร็จ', 'import-data', 60),
    ('STUDENT_ACCOUNT_BATCH_COMPLETED', 'สร้างบัญชีนักเรียนเสร็จแล้ว', 'manage-student-accounts', 70),
    ('STUDENT_ACCOUNT_BATCH_FAILED', 'สร้างบัญชีนักเรียนไม่สำเร็จ', 'manage-student-accounts', 80),
    ('CASE_RISK_ESCALATED', 'เคสถูกยกระดับความเสี่ยง', 'review-cases', 150),
    ('STUDENT_RISK_WATCH', 'นักเรียนเข้าเกณฑ์เฝ้าระวัง', 'review-cases', 160)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type_code VARCHAR(64) NOT NULL
      REFERENCES notification_types(code) ON DELETE RESTRICT ON UPDATE CASCADE,
    title TEXT NOT NULL,
    body TEXT,
    ref_entity VARCHAR(32),
    ref_id TEXT,
    seen_at TIMESTAMP WITH TIME ZONE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_notifications_title CHECK (length(trim(title)) > 0)
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
    ON notifications (recipient_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
    ON notifications (recipient_user_id, created_at DESC)
    WHERE read_at IS NULL;
`;

export const DATABASE_BASELINE_SQL = `
  CREATE TABLE IF NOT EXISTS schools (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    province TEXT,
    district TEXT,
    sub_district TEXT
  );

  CREATE TABLE IF NOT EXISTS grade_levels (
    id SERIAL PRIMARY KEY,
    label TEXT NOT NULL,
    category TEXT
  );

  CREATE TABLE IF NOT EXISTS cases (
    id SERIAL PRIMARY KEY,
    student_name TEXT NOT NULL,
    student_first_name TEXT,
    student_last_name TEXT,
    student_id TEXT,
    school_id INTEGER,
    student_school TEXT,
    student_address TEXT,
    address_line TEXT,
    address_province TEXT,
    address_district TEXT,
    address_sub_district TEXT,
    postal_code TEXT,
    student_lat DOUBLE PRECISION,
    student_lng DOUBLE PRECISION,
    reason_flagged TEXT,
    status TEXT DEFAULT 'OPEN',
    result_summary TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'IN_PROGRESS',
    max_delegation_depth INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    task_type TEXT DEFAULT 'VISIT',
    target_grade TEXT,
    target_room TEXT,
    target_school_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS task_links (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    parent_link_id TEXT REFERENCES task_links(id),
    token_hash TEXT NOT NULL UNIQUE,
    magic_link TEXT,
    delegation_depth INTEGER DEFAULT 0,
    assigned_to_name TEXT,
    assigned_to_phone TEXT,
    assigned_to_email TEXT,
    otp_code TEXT,
    otp_expires_at TIMESTAMP,
    otp_verified INTEGER DEFAULT 0,
    otp_attempts INTEGER NOT NULL DEFAULT 0,
    otp_locked_until TIMESTAMP WITH TIME ZONE,
    subject TEXT,
    status TEXT DEFAULT 'ACTIVE',
    admin_locked INTEGER DEFAULT 0,
    admin_lock_reason TEXT,
    admin_lock_at TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS task_submissions (
    id SERIAL PRIMARY KEY,
    task_link_id TEXT REFERENCES task_links(id),
    visit_lat REAL,
    visit_lng REAL,
    cause_category TEXT,
    cause_detail TEXT,
    photo_paths TEXT,
    recommendation TEXT,
    address_changed BOOLEAN DEFAULT FALSE,
    updated_student_address TEXT,
    updated_lat REAL,
    updated_lng REAL,
    submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS case_reviews (
    id TEXT PRIMARY KEY,
    case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
    review_action TEXT NOT NULL,
    review_note TEXT,
    resolution_outcome VARCHAR(40),
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS student_term (
    "AcademicYear_Onec" INTEGER,
    "Semester_Onec" INTEGER,
    "DepartmentID_Onec" INTEGER,
    "SchoolID_Onec" INTEGER,
    "PersonID_Onec" TEXT PRIMARY KEY,
    "student_uuid" UUID NOT NULL DEFAULT gen_random_uuid()
      CONSTRAINT uq_student_term_student_uuid UNIQUE,
    "PassportNumber_Onec" TEXT,
    "PrefixID_Onec" INTEGER,
    "FirstName_Onec" TEXT,
    "MiddleName_Onec" TEXT,
    "LastName_Onec" TEXT,
    "GenderID_Onec" INTEGER,
    "NationalityID_Onec" INTEGER,
    "DisabilityID_Onec" INTEGER,
    "DisadvantageEducationID_Onec" INTEGER,
    "VillageNumber_Onec" TEXT,
    "Street_Onec" TEXT,
    "Soi_Onec" TEXT,
    "Trok_Onec" TEXT,
    "SubDistrictID_Onec" INTEGER,
    "SchoolAdmissionYear_Onec" INTEGER,
    "GradeLevelID_Onec" INTEGER,
    "RoomID_Onec" INTEGER,
    "GPAX_Onec" REAL,
    "StudentStatusID_Onec" INTEGER,
    "ProvinceNameThai_Onec" TEXT,
    "DistrictNameThai_Onec" TEXT,
    "SubDistrictNameThai_Onec" TEXT,
    "PostalCode_Onec" VARCHAR(5)
  );

  CREATE TABLE IF NOT EXISTS student_dropouts (
    "ProvinceNameThai_Onec" TEXT,
    "DistrictNameThai_Onec" TEXT,
    "SubDistrictNameThai_Onec" TEXT,
    "PersonID_Onec" TEXT PRIMARY KEY,
    "student_uuid" UUID NOT NULL DEFAULT gen_random_uuid()
      CONSTRAINT uq_student_dropouts_student_uuid UNIQUE,
    "Fullname_Onec" TEXT,
    "Gender_Onec" TEXT,
    "NationalityName_Onec" TEXT,
    "BirthDate_Onec" TEXT,
    "HouseNumber_Onec" TEXT,
    "VillageNumber_Onec" TEXT,
    "Street_Onec" TEXT,
    "Soi_Onec" TEXT,
    "Trok_Onec" TEXT,
    "StatusCodeCause_Onec" TEXT,
    "Remark_Onec" TEXT,
    "SchoolName_Onec" TEXT,
    "GradeLevelID_Onec" INTEGER,
    "AcademicYearPresent_Onec" INTEGER,
    "DropoutTransferID_Onec" INTEGER,
    "ACADYEAR" INTEGER,
    "RoomID_Onec" INTEGER,
    "SchoolID_Onec" INTEGER,
    "GenderID_Onec" INTEGER,
    "GPAX_Onec" REAL
  );

  CREATE TABLE IF NOT EXISTS attendance (
      "AttendanceID"        SERIAL PRIMARY KEY,
      "PersonID_Onec"       VARCHAR(20) NOT NULL REFERENCES student_term("PersonID_Onec"),
      "SchoolID_Onec"       INT NOT NULL,
      "GradeLevelID_Onec"   INT NOT NULL,
      "RoomID_Onec"         INT NOT NULL,
      "AcademicYear_Onec"   INT NOT NULL,
      "Semester_Onec"       INT NOT NULL,
      "AttendanceDate"      DATE NOT NULL,
      "Period"              INT NOT NULL,
      "AttendanceStatus"    SMALLINT NOT NULL,
      "RecordedAt"          TIMESTAMPTZ DEFAULT NOW(),
      "RecordedBy"          VARCHAR(100)
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    grade TEXT,
    room TEXT,
    day_of_week INTEGER,
    subject TEXT,
    start_time TEXT,
    end_time TEXT,
    teacher TEXT
  );

  CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    rank INTEGER NOT NULL DEFAULT 0,
    default_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    scope_mode TEXT NOT NULL DEFAULT 'flexible',
    scope_policy TEXT NOT NULL DEFAULT 'ASSIGNABLE',
    is_assignable BOOLEAN NOT NULL DEFAULT TRUE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE
  );

  ALTER TABLE roles ADD COLUMN IF NOT EXISTS rank INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS default_permissions JSONB NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope_mode TEXT NOT NULL DEFAULT 'flexible';
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope_policy TEXT NOT NULL DEFAULT 'ASSIGNABLE';
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_assignable BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

  ${SYSTEM_ROLE_BASELINE_SQL}

  UPDATE roles
  SET is_assignable = FALSE
  WHERE name IN ('ADMIN_PROVINCE', 'ADMIN_DISTRICT', 'ADMIN_SUBDISTRICT', 'ADMIN_SCHOOL');

  ${DATA_RECORD_ORIGINS_SQL}

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    fullname TEXT,
    "PersonID_Onec" TEXT,
    phone TEXT,
    email TEXT,
    affiliation TEXT,
    line_id TEXT,
    address_line TEXT,
    address_village_no TEXT,
    address_street TEXT,
    address_soi TEXT,
    address_trok TEXT,
    address_sub_district TEXT,
    address_district TEXT,
    address_province TEXT,
    address_postal_code TEXT,
    address_latitude DOUBLE PRECISION,
    address_longitude DOUBLE PRECISION,
    status TEXT DEFAULT 'ACTIVE',
    permissions JSONB DEFAULT '[]'::jsonb,
    role TEXT DEFAULT 'TEACHER',
    data_scope JSONB DEFAULT '{}'::jsonb,
    data_origin_code VARCHAR(32) NOT NULL DEFAULT 'OPERATIONAL',
    person_uuid UUID,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    temporary_password_issued_at TIMESTAMP WITH TIME ZONE,
    temporary_password_expires_at TIMESTAMP WITH TIME ZONE,
    deactivated_at TIMESTAMP WITH TIME ZONE,
    deactivated_by INTEGER,
    deactivation_reason_code VARCHAR(32),
    deactivation_note VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS data_origin_code VARCHAR(32) NOT NULL DEFAULT 'OPERATIONAL';
  DO $users_data_origin_fk$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_data_origin'
    ) THEN
      ALTER TABLE users
        ADD CONSTRAINT fk_users_data_origin
        FOREIGN KEY (data_origin_code) REFERENCES data_record_origins(code)
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
  END $users_data_origin_fk$;
  CREATE INDEX IF NOT EXISTS idx_users_data_origin_code ON users (data_origin_code);

  CREATE TABLE IF NOT EXISTS external_users (
    "ExternalID" SERIAL PRIMARY KEY,
    "PersonID_Onec" TEXT UNIQUE,
    "FullName" TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS external_agencies (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    agency_type TEXT NOT NULL,
    province TEXT,
    district TEXT,
    sub_district TEXT,
    phone TEXT,
    contact_person TEXT,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_external_agencies_type
      CHECK (agency_type IN ('HOSPITAL', 'POLICE', 'SOCIAL_WELFARE', 'NGO', 'EDUCATION', 'OTHER'))
  );

  CREATE TABLE IF NOT EXISTS case_referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    agency_id INTEGER REFERENCES external_agencies(id) ON DELETE SET NULL,
    agency_name_snapshot TEXT NOT NULL,
    agency_type_snapshot TEXT NOT NULL,
    referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    referred_by_label TEXT,
    referred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    referral_note TEXT,
    status TEXT NOT NULL DEFAULT 'SENT',
    outcome TEXT,
    responded_at TIMESTAMPTZ,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_case_referrals_status
      CHECK (status IN ('SENT', 'ACKNOWLEDGED', 'ACCEPTED', 'DECLINED', 'RETURNED')),
    CONSTRAINT chk_case_referrals_agency_type
      CHECK (agency_type_snapshot IN ('HOSPITAL', 'POLICE', 'SOCIAL_WELFARE', 'NGO', 'EDUCATION', 'OTHER'))
  );

  ALTER TABLE users ADD COLUMN IF NOT EXISTS "PersonID_Onec" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "FirstName" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "LastName" TEXT;
  ALTER TABLE users DROP COLUMN IF EXISTS fullname;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "phone" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "email" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "affiliation" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS line_id TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS address_village_no TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS address_street TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS address_soi TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS address_trok TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS address_sub_district TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS address_district TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS address_province TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS address_postal_code TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS address_latitude DOUBLE PRECISION;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS address_longitude DOUBLE PRECISION;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'ACTIVE';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "permissions" JSONB DEFAULT '[]';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "role" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "data_scope" JSONB DEFAULT '{}'::jsonb;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS person_uuid UUID;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_password_issued_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_password_expires_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_by INTEGER;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivation_reason_code VARCHAR(32);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivation_note VARCHAR(255);
  ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_address_postal_code;
  ALTER TABLE users
    ADD CONSTRAINT chk_users_address_postal_code
    CHECK (address_postal_code IS NULL OR address_postal_code ~ '^[0-9]{5}$') NOT VALID;
  ALTER TABLE users VALIDATE CONSTRAINT chk_users_address_postal_code;
  ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_address_coordinates;
  ALTER TABLE users
    ADD CONSTRAINT chk_users_address_coordinates
    CHECK (
      (address_latitude IS NULL AND address_longitude IS NULL)
      OR (
        address_latitude BETWEEN -90 AND 90
        AND address_longitude BETWEEN -180 AND 180
      )
    ) NOT VALID;
  ALTER TABLE users VALIDATE CONSTRAINT chk_users_address_coordinates;
  ALTER TABLE student_term ADD COLUMN IF NOT EXISTS "PostalCode_Onec" VARCHAR(5);
  ${STUDENT_TERM_POSTAL_CODE_BACKFILL_SQL}
  DO $student_term_postal_code_constraint$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'chk_student_term_postal_code'
    ) THEN
      ALTER TABLE student_term
      ADD CONSTRAINT chk_student_term_postal_code
      CHECK ("PostalCode_Onec" IS NULL OR "PostalCode_Onec" ~ '^[0-9]{5}$');
    END IF;
  END $student_term_postal_code_constraint$;
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS student_id TEXT;
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS student_first_name TEXT;
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS student_last_name TEXT;
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS address_line TEXT;
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS address_province TEXT;
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS address_district TEXT;
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS address_sub_district TEXT;
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS postal_code TEXT;
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS school_id INTEGER;
  -- Surrogate-key FK to the opaque student UUID (B1.2). Nullable here: a fresh
  -- seed loads from a dump that lacks the column, so it is backfilled from
  -- student_term below. cases.student_uuid stays nullable (loose student_id has
  -- no FK; some rows won't map); the migration enforces NOT NULL on
  -- attendance.student_uuid for the migrated live DB.
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS student_uuid UUID;
  ALTER TABLE attendance ADD COLUMN IF NOT EXISTS student_uuid UUID;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS rank INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS default_permissions JSONB NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope_mode TEXT NOT NULL DEFAULT 'flexible';
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope_policy TEXT NOT NULL DEFAULT 'ASSIGNABLE';
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_assignable BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

  CREATE INDEX IF NOT EXISTS idx_task_links_token ON task_links(token_hash);
  CREATE INDEX IF NOT EXISTS idx_task_links_task_id ON task_links(task_id);
  CREATE INDEX IF NOT EXISTS idx_case_reviews_case_id ON case_reviews(case_id);
  CREATE INDEX IF NOT EXISTS idx_case_reviews_resolution_outcome
    ON case_reviews(resolution_outcome)
    WHERE resolution_outcome IS NOT NULL;
  DO $case_review_outcome$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'chk_case_reviews_resolution_outcome'
    ) THEN
      ALTER TABLE case_reviews
      ADD CONSTRAINT chk_case_reviews_resolution_outcome
      CHECK (
        resolution_outcome IS NULL
        OR resolution_outcome IN (
          'RETURNED_TO_SCHOOL',
          'TRANSFERRED_SCHOOL',
          'ILLNESS',
          'WORKING',
          'UNREACHABLE',
          'REFERRED_EXTERNAL',
          'OTHER'
        )
      );
    END IF;
  END $case_review_outcome$;
  CREATE INDEX IF NOT EXISTS idx_external_agencies_scope ON external_agencies(province, district, sub_district);
  CREATE INDEX IF NOT EXISTS idx_external_agencies_type_active ON external_agencies(agency_type, is_active);
  CREATE INDEX IF NOT EXISTS idx_case_referrals_case ON case_referrals(case_id, referred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_case_referrals_agency ON case_referrals(agency_id);
  CREATE INDEX IF NOT EXISTS idx_cases_school_id ON cases(school_id);
  CREATE INDEX IF NOT EXISTS idx_cases_student_uuid ON cases(student_uuid);
  CREATE INDEX IF NOT EXISTS idx_attendance_person_id ON attendance("PersonID_Onec");
  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance("AttendanceDate");
  CREATE INDEX IF NOT EXISTS idx_attendance_student_uuid ON attendance(student_uuid);
  CREATE INDEX IF NOT EXISTS idx_student_risk_profiles_scope
    ON student_risk_profiles (school_id, grade_level_id, room_id);
  CREATE INDEX IF NOT EXISTS idx_student_risk_profiles_tier
    ON student_risk_profiles (risk_tier);
  CREATE INDEX IF NOT EXISTS idx_student_risk_profiles_sort
    ON student_risk_profiles (risk_severity DESC, risk_score DESC, student_uuid);
  CREATE INDEX IF NOT EXISTS idx_student_risk_profiles_calculated_at
    ON student_risk_profiles (profile_calculated_at);
  CREATE INDEX IF NOT EXISTS idx_student_risk_profiles_term_school
    ON student_risk_profiles (academic_year, semester, school_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_risk_profile_recalc
    ON attendance (student_uuid, "AcademicYear_Onec", "Semester_Onec", "AttendanceDate" DESC);
  CREATE INDEX IF NOT EXISTS idx_cases_risk_profile_open_student
    ON cases (student_uuid, created_at DESC, id DESC)
    WHERE deleted_at IS NULL AND status <> 'RESOLVED';
  CREATE INDEX IF NOT EXISTS idx_school_calendar_days_risk_profile
    ON school_calendar_days (school_term_id, day_type, deleted_at, calendar_date);

  ALTER TABLE task_links ALTER COLUMN expires_at TYPE TIMESTAMP WITH TIME ZONE;
  ALTER TABLE task_links ALTER COLUMN otp_expires_at TYPE TIMESTAMP WITH TIME ZONE USING otp_expires_at AT TIME ZONE 'UTC';
  ALTER TABLE task_links ALTER COLUMN admin_lock_at TYPE TIMESTAMP WITH TIME ZONE USING admin_lock_at AT TIME ZONE 'UTC';
  ALTER TABLE task_links ALTER COLUMN created_at TYPE TIMESTAMP WITH TIME ZONE USING created_at AT TIME ZONE 'UTC';
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS login_role TEXT;
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS login_permissions JSONB DEFAULT '[]'::jsonb;
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS login_data_scope JSONB DEFAULT '{}'::jsonb;
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS first_used_at TIMESTAMP WITH TIME ZONE;

  ALTER TABLE cases ADD COLUMN IF NOT EXISTS result_summary TEXT;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS target_school_id INTEGER;
  ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS address_changed BOOLEAN DEFAULT FALSE;
  ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS updated_student_address TEXT;
  ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS updated_lat REAL;
  ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS updated_lng REAL;
  ${auditUpdatedAtTriggerSql('external_agencies')}
  ${auditUpdatedAtTriggerSql('case_referrals')}

  INSERT INTO external_agencies
    (name, agency_type, province, district, sub_district, phone, contact_person, address)
  SELECT *
  FROM (
    VALUES
      ('โรงพยาบาลส่งเสริมสุขภาพตำบลดุสิต', 'HOSPITAL', 'กรุงเทพมหานคร', 'ดุสิต', 'ดุสิต', '02-000-0001', 'เจ้าหน้าที่รับส่งต่อ', 'ดุสิต กรุงเทพมหานคร'),
      ('สถานีตำรวจนครบาลดุสิต', 'POLICE', 'กรุงเทพมหานคร', 'ดุสิต', 'ดุสิต', '02-000-0002', 'งานป้องกันและปราบปราม', 'ดุสิต กรุงเทพมหานคร'),
      ('สำนักงานพัฒนาสังคมและความมั่นคงของมนุษย์จังหวัดกรุงเทพมหานคร', 'SOCIAL_WELFARE', 'กรุงเทพมหานคร', NULL, NULL, '02-000-0003', 'ศูนย์ประสานงานเด็กและครอบครัว', 'กรุงเทพมหานคร')
  ) AS seed(name, agency_type, province, district, sub_district, phone, contact_person, address)
  WHERE NOT EXISTS (
    SELECT 1 FROM external_agencies existing
    WHERE existing.name = seed.name
      AND existing.agency_type = seed.agency_type
  );

  DO $$
  BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_term_school') THEN
          UPDATE student_term SET "SchoolID_Onec" = NULL
          WHERE "SchoolID_Onec" IS NOT NULL AND "SchoolID_Onec" NOT IN (SELECT id FROM schools);

          ALTER TABLE student_term
          ADD CONSTRAINT fk_student_term_school
          FOREIGN KEY ("SchoolID_Onec") REFERENCES schools(id) ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_dropouts_school') THEN
          UPDATE student_dropouts SET "SchoolID_Onec" = NULL
          WHERE "SchoolID_Onec" IS NOT NULL AND "SchoolID_Onec" NOT IN (SELECT id FROM schools);

          ALTER TABLE student_dropouts
          ADD CONSTRAINT fk_student_dropouts_school
          FOREIGN KEY ("SchoolID_Onec") REFERENCES schools(id) ON DELETE SET NULL;
      END IF;

      ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_cases_postal_code;
      ALTER TABLE cases
        ADD CONSTRAINT chk_cases_postal_code
        CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{5}$');

      -- B1.2 surrogate-key FKs to student_term(student_uuid). Backfill from the
      -- legacy link first since a fresh dump load lacks student_uuid; then add
      -- the FK. attendance is total (every row FK-references student_term);
      -- cases.student_id is loose text so some rows stay NULL.
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_student_uuid') THEN
          UPDATE attendance a
          SET student_uuid = st.student_uuid
          FROM student_term st
          WHERE a."PersonID_Onec" = st."PersonID_Onec"
            AND a.student_uuid IS NULL;

          ALTER TABLE attendance
          ADD CONSTRAINT fk_attendance_student_uuid
          FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cases_student_uuid') THEN
          UPDATE cases c
          SET student_uuid = st.student_uuid
          FROM student_term st
          WHERE c.student_id = st."PersonID_Onec"
            AND c.student_id IS NOT NULL
            AND c.student_uuid IS NULL;

          ALTER TABLE cases
          ADD CONSTRAINT fk_cases_student_uuid
          FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid);
      END IF;
  END
  $$;

  CREATE TABLE IF NOT EXISTS student_risk_profiles (
    student_uuid UUID PRIMARY KEY
      CONSTRAINT fk_student_risk_profiles_student
      REFERENCES student_term(student_uuid) ON DELETE CASCADE ON UPDATE CASCADE,
    school_id INTEGER NOT NULL,
    grade_level_id INTEGER NULL,
    room_id INTEGER NULL,
    academic_year INTEGER NOT NULL,
    semester INTEGER NOT NULL,
    consecutive_absent_days INTEGER NOT NULL DEFAULT 0,
    absent_days INTEGER NOT NULL DEFAULT 0,
    late_count INTEGER NOT NULL DEFAULT 0,
    subject_late_count INTEGER NOT NULL DEFAULT 0,
    school_day_count INTEGER NOT NULL DEFAULT 0,
    weighted_absence_days NUMERIC(8,2) NOT NULL DEFAULT 0,
    weighted_attendance_percent NUMERIC(5,2) NULL,
    risk_tier VARCHAR(16) NOT NULL
      CONSTRAINT chk_student_risk_profiles_tier
      CHECK (risk_tier IN ('HIGH', 'MEDIUM', 'LOW', 'WATCH', 'NORMAL')),
    risk_severity SMALLINT NOT NULL
      CONSTRAINT chk_student_risk_profiles_severity
      CHECK (risk_severity BETWEEN 0 AND 4),
    risk_score NUMERIC(10,4) NOT NULL DEFAULT 0,
    open_case_count INTEGER NOT NULL DEFAULT 0,
    latest_open_case_id INTEGER NULL
      CONSTRAINT fk_student_risk_profiles_latest_case
      REFERENCES cases(id) ON DELETE SET NULL ON UPDATE CASCADE,
    latest_open_task_id TEXT NULL
      CONSTRAINT fk_student_risk_profiles_latest_task
      REFERENCES tasks(id) ON DELETE SET NULL ON UPDATE CASCADE,
    profile_calculated_at TIMESTAMPTZ NOT NULL,
    source_updated_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS field_followers (
    id BIGSERIAL PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone VARCHAR(20) NOT NULL,
    sub_district TEXT NULL,
    district TEXT NULL,
    province TEXT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'APPLIED'
      CONSTRAINT chk_field_followers_status
      CHECK (status IN ('APPLIED', 'VERIFIED', 'ACTIVE', 'SUSPENDED')),
    trust_level VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
    applied_via VARCHAR(20) NOT NULL DEFAULT 'PUBLIC_FORM',
    reviewed_by_user_id INTEGER NULL
      CONSTRAINT fk_field_followers_reviewed_by
      REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    reviewed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  ${SYSTEM_SETTING_BASELINE_SQL}

  UPDATE users
  SET role = NULL
  WHERE role IS NOT NULL AND btrim(role) = '';

  DO $migration$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'user_roles'
    ) THEN
      EXECUTE $sql$
        WITH ranked_roles AS (
          SELECT DISTINCT ON (ur.user_id)
            ur.user_id,
            CASE
              WHEN r.name = 'STAFF' THEN 'TEACHER'
              ELSE r.name
            END AS role_name
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          ORDER BY
            ur.user_id,
            CASE
              WHEN r.name = 'ADMIN' THEN 1
              WHEN r.name = 'ADMIN_PROVINCE' THEN 2
              WHEN r.name = 'ADMIN_DISTRICT' THEN 3
              WHEN r.name = 'ADMIN_SUBDISTRICT' THEN 4
              WHEN r.name = 'ADMIN_SCHOOL' THEN 5
              WHEN r.name = 'DIRECTOR' THEN 6
              WHEN r.name = 'EXECUTIVE' THEN 7
              WHEN r.name IN ('TEACHER', 'STAFF') THEN 8
              WHEN r.name = 'STUDENT' THEN 9
              ELSE 999
            END,
            ur.role_id
        )
        UPDATE users u
        SET role = rr.role_name
        FROM ranked_roles rr
        WHERE u.id = rr.user_id
          AND (u.role IS NULL OR u.role NOT IN (SELECT name FROM roles));
      $sql$;
    END IF;
  END
  $migration$;

  UPDATE users
  SET role = 'TEACHER'
  WHERE role = 'STAFF';

  UPDATE users
  SET role = 'TEACHER'
  WHERE role IS NULL
    OR role NOT IN (SELECT name FROM roles WHERE name <> 'STAFF');

  DELETE FROM roles
  WHERE name = 'STAFF';

  UPDATE users
  SET permissions = '[]'::jsonb
  WHERE permissions IS NULL;

  UPDATE users
  SET data_scope = '{}'::jsonb
  WHERE data_scope IS NULL;

  ALTER TABLE users
  ALTER COLUMN permissions SET DEFAULT '[]'::jsonb;

  ALTER TABLE users
  ALTER COLUMN data_scope SET DEFAULT '{}'::jsonb;

  UPDATE users
  SET status = 'DISABLED'
  WHERE status NOT IN ('ACTIVE', 'DISABLED');

  DO $users_lifecycle_constraints$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_deactivated_by'
    ) THEN
      ALTER TABLE users
      ADD CONSTRAINT fk_users_deactivated_by
      FOREIGN KEY (deactivated_by) REFERENCES users(id)
      ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_deactivation_reason_code'
    ) THEN
      ALTER TABLE users
      ADD CONSTRAINT chk_users_deactivation_reason_code
      CHECK (
        deactivation_reason_code IS NULL
        OR deactivation_reason_code IN ('STAFF_LEFT', 'TRANSFERRED', 'DUPLICATE', 'SECURITY', 'OTHER')
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_status'
    ) THEN
      ALTER TABLE users
      ADD CONSTRAINT chk_users_status
      CHECK (status IN ('ACTIVE', 'DISABLED'));
    END IF;
  END $users_lifecycle_constraints$;

  DO $users_person_fk$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'student_person')
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_person') THEN
      ALTER TABLE users
      ADD CONSTRAINT fk_users_person
      FOREIGN KEY (person_uuid) REFERENCES student_person(person_uuid)
      ON DELETE RESTRICT;
    END IF;
  END $users_person_fk$;

  CREATE INDEX IF NOT EXISTS idx_users_person_uuid ON users (person_uuid);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_users_active_student_person
    ON users (person_uuid)
    WHERE person_uuid IS NOT NULL AND role = 'STUDENT' AND status = 'ACTIVE';

  ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'TEACHER';

  ALTER TABLE users
  ALTER COLUMN role SET NOT NULL;

  DO $constraint$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'fk_users_role_name'
    ) THEN
      ALTER TABLE users
      ADD CONSTRAINT fk_users_role_name
      FOREIGN KEY (role) REFERENCES roles(name)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
    END IF;
  END
  $constraint$;

  DROP TABLE IF EXISTS user_roles;

  CREATE TABLE IF NOT EXISTS risk_factors (
    id SERIAL PRIMARY KEY,
    label TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS dropout_reasons (
    id SERIAL PRIMARY KEY,
    label TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS assistance_measures (
    id SERIAL PRIMARY KEY,
    label TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS related_agencies (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS educational_areas (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  ${SET_UPDATED_AT_FUNCTION_SQL}

  CREATE TABLE IF NOT EXISTS school_affiliations (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    note TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_school_affiliations_code CHECK (length(trim(code)) > 0),
    CONSTRAINT chk_school_affiliations_name CHECK (length(trim(name)) > 0)
  );
  ${auditUpdatedAtTriggerSql('school_affiliations')}

  CREATE TABLE IF NOT EXISTS disability_types (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    note TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    legal_category TEXT,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_disability_types_code CHECK (length(trim(code)) > 0),
    CONSTRAINT chk_disability_types_name CHECK (length(trim(name)) > 0)
  );
  ${auditUpdatedAtTriggerSql('disability_types')}

  CREATE TABLE IF NOT EXISTS absence_reason_categories (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    note TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_absence_reason_categories_code CHECK (length(trim(code)) > 0),
    CONSTRAINT chk_absence_reason_categories_name CHECK (length(trim(name)) > 0)
  );
  ${auditUpdatedAtTriggerSql('absence_reason_categories')}

  CREATE TABLE IF NOT EXISTS absence_reasons (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category_id BIGINT NOT NULL REFERENCES absence_reason_categories(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    note TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_absence_reasons_code CHECK (length(trim(code)) > 0),
    CONSTRAINT chk_absence_reasons_name CHECK (length(trim(name)) > 0)
  );
  ${auditUpdatedAtTriggerSql('absence_reasons')}
  CREATE INDEX IF NOT EXISTS idx_absence_reasons_category_id
    ON absence_reasons (category_id);

  CREATE TABLE IF NOT EXISTS non_follow_up_reasons (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    note TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_non_follow_up_reasons_code CHECK (length(trim(code)) > 0),
    CONSTRAINT chk_non_follow_up_reasons_name CHECK (length(trim(name)) > 0)
  );
  ${auditUpdatedAtTriggerSql('non_follow_up_reasons')}

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

  CREATE TABLE IF NOT EXISTS student_status_categories (
    code VARCHAR(32) PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    sort_order SMALLINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_student_status_categories_label CHECK (length(trim(label_th)) > 0)
  );
  ${auditUpdatedAtTriggerSql('student_status_categories')}
  INSERT INTO student_status_categories (code, label_th, sort_order) VALUES
    ('ACTIVE', 'กำลังศึกษา', 10),
    ('GRADUATED', 'สำเร็จการศึกษา', 20),
    ('WITHDRAWN', 'ลาออก/พ้นสภาพ', 30),
    ('TRANSFERRED', 'ย้ายสถานศึกษา', 40),
    ('DECEASED', 'เสียชีวิต', 50),
    ('UNMAPPED', 'ยังไม่ได้จับคู่', 60)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS student_status (
    code INTEGER PRIMARY KEY,
    label_th VARCHAR(100) NOT NULL,
    category VARCHAR(32) NOT NULL,
    badge_variant VARCHAR(16) NOT NULL DEFAULT 'secondary',
    is_active_for_login BOOLEAN NOT NULL DEFAULT FALSE,
    is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
    requires_followup BOOLEAN NOT NULL DEFAULT FALSE,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order SMALLINT NOT NULL,
    source_system VARCHAR(32) NOT NULL DEFAULT 'ONEC',
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_student_status_sort_order CHECK (sort_order >= 0),
    CONSTRAINT chk_student_status_source_system CHECK (length(trim(source_system)) > 0),
    CONSTRAINT chk_student_status_label_th CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_student_status_badge_variant
      CHECK (badge_variant IN ('default','secondary','destructive','success','warning')),
    CONSTRAINT fk_student_status_category FOREIGN KEY (category)
      REFERENCES student_status_categories(code) ON DELETE RESTRICT ON UPDATE CASCADE
  );
  ${auditUpdatedAtTriggerSql('student_status')}

  INSERT INTO student_status (
    code, label_th, category, badge_variant, is_active_for_login, is_terminal,
    requires_followup, is_enabled, sort_order, source_system
  )
  VALUES
    (10, 'กำลังศึกษา', 'ACTIVE', 'success', TRUE, FALSE, FALSE, TRUE, 10, 'ONEC'),
    (20, 'จบการศึกษา', 'GRADUATED', 'secondary', FALSE, TRUE, FALSE, TRUE, 20, 'ONEC'),
    (30, 'ลาออก/จำหน่าย', 'WITHDRAWN', 'secondary', FALSE, TRUE, TRUE, TRUE, 30, 'ONEC'),
    (40, 'ย้ายสถานศึกษา', 'TRANSFERRED', 'secondary', FALSE, TRUE, FALSE, TRUE, 40, 'ONEC')
  ON CONFLICT (code) DO NOTHING;

  ALTER TABLE student_term ADD COLUMN IF NOT EXISTS student_status_code INTEGER;
  UPDATE student_term AS enrollment
  SET student_status_code = status.code
  FROM student_status AS status
  WHERE enrollment.student_status_code IS NULL
    AND enrollment."StudentStatusID_Onec" = status.code;
  DO $student_status_fk$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_term_student_status'
    ) THEN
      ALTER TABLE student_term
        ADD CONSTRAINT fk_student_term_student_status
        FOREIGN KEY (student_status_code) REFERENCES student_status(code)
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
  END $student_status_fk$;
  CREATE INDEX IF NOT EXISTS idx_student_term_student_status_code
    ON student_term (student_status_code);

  ${STUDENT_CURRENT_ENROLLMENT_VIEW_SQL}

  ${STUDENT_ACCOUNT_BATCH_TABLES_SQL}

  ${STUDENT_IMPORT_QUARANTINE_TABLES_SQL}

  ${CASE_WORKFLOW_STATUS_TABLE_SQL}

  ${OPERATIONAL_STATUS_CATALOG_TABLES_SQL}

  ${NOTIFICATION_TABLES_SQL}

  ${AUDIT_RETROFIT_SQL}
`;

export async function syncSystemRoleDefinitions(executor: SqlExecutor): Promise<void> {
  for (const role of SYSTEM_ROLE_DEFINITIONS) {
    await executor.query(
      `
        INSERT INTO roles (
          name, label, rank, default_permissions, scope_mode, scope_policy, is_assignable, is_system
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
        ON CONFLICT (name) DO NOTHING
      `,
      [
        role.name,
        role.label,
        role.rank,
        JSON.stringify(role.default_permissions),
        role.scope_mode,
        role.scope_policy,
        role.is_assignable,
        role.is_system,
      ],
    );

    await executor.query(
      `
        UPDATE roles
        SET
          label = $2,
          rank = $3,
          default_permissions = $4::jsonb,
          scope_mode = $5,
          scope_policy = $6,
          is_assignable = $7,
          is_system = $8
        WHERE name = $1
      `,
      [
        role.name,
        role.label,
        role.rank,
        JSON.stringify(role.default_permissions),
        role.scope_mode,
        role.scope_policy,
        role.is_assignable,
        role.is_system,
      ],
    );
  }
  await executor.query(`
    UPDATE roles
    SET is_assignable = FALSE
    WHERE name IN ('ADMIN_PROVINCE', 'ADMIN_DISTRICT', 'ADMIN_SUBDISTRICT', 'ADMIN_SCHOOL')
  `);
}

export async function syncSystemSettings(executor: SqlExecutor): Promise<void> {
  for (const setting of SYSTEM_SETTING_DEFINITIONS) {
    await executor.query(
      `
        INSERT INTO system_settings (setting_key, setting_value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (setting_key) DO NOTHING
      `,
      [setting.key, setting.value, setting.description],
    );

    await executor.query(
      `
        UPDATE system_settings
        SET
          setting_value = CASE
            WHEN setting_value IS NULL OR btrim(setting_value) = '' THEN $2
            ELSE setting_value
          END,
          description = CASE
            WHEN description IS NULL OR btrim(description) = '' THEN $3
            ELSE description
          END
        WHERE setting_key = $1
      `,
      [setting.key, setting.value, setting.description],
    );
  }
}

export async function runDatabaseBootstrap(executor: SqlExecutor): Promise<void> {
  await executor.query(DATABASE_BASELINE_SQL);
  await syncSystemRoleDefinitions(executor);
  await syncSystemSettings(executor);
}
