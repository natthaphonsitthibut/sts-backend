import { SYSTEM_ROLE_DEFINITIONS } from '../auth/permissions.constants';

interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

interface SystemSettingDefinition {
  key: string;
  value: string;
  description: string;
}

export const SYSTEM_SETTING_DEFINITIONS: SystemSettingDefinition[] = [
  {
    key: 'ABSENT_THRESHOLD_DAYS',
    value: '3',
    description: 'จำนวนวันขาดเรียนติดต่อกันก่อนที่จะแจ้งเตือนหรือเปิดเคสอัตโนมัติ',
  },
  {
    key: 'ALERT_TRIGGER_TYPE',
    value: 'SCHEDULED',
    description: 'รูปแบบการทำงาน (SCHEDULED = ตามตารางกะเวลา, IMMEDIATE = แจ้งเตือนทันที)',
  },
  {
    key: 'ALERT_SCHEDULE_TIME',
    value: '18:00',
    description: 'เวลาที่จะรันบอทตรวจสอบข้อมูล (HH:MM) เมื่อเลือกรูปแบบ SCHEDULED',
  },
];

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
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_student_status_category
      CHECK (category IN ('ACTIVE', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED', 'DECEASED', 'UNMAPPED')),
    CONSTRAINT chk_student_status_sort_order CHECK (sort_order >= 0),
    CONSTRAINT chk_student_status_source_system CHECK (length(trim(source_system)) > 0),
    CONSTRAINT chk_student_status_label_th CHECK (length(trim(label_th)) > 0)
  );
  ${auditUpdatedAtTriggerSql('student_status')}

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

  ${STUDENT_ACCOUNT_BATCH_TABLES_SQL}

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
