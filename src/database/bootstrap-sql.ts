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

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

const SYSTEM_ROLE_BASELINE_SQL = SYSTEM_ROLE_DEFINITIONS.map(
  (role) => `
  INSERT INTO roles (name, label, rank, default_permissions, scope_mode, is_system)
  VALUES ('${escapeSqlLiteral(role.name)}', '${escapeSqlLiteral(role.label)}', ${role.rank}, '${escapeSqlLiteral(JSON.stringify(role.default_permissions))}'::jsonb, '${escapeSqlLiteral(role.scope_mode)}', ${role.is_system ? 'TRUE' : 'FALSE'})
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
    student_id TEXT,
    student_school TEXT,
    student_address TEXT,
    student_lat REAL,
    student_lng REAL,
    reason_flagged TEXT,
    status TEXT DEFAULT 'OPEN',
    result_summary TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'PENDING',
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
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS case_reviews (
    id TEXT PRIMARY KEY,
    case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
    review_action TEXT NOT NULL,
    review_note TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS student_term (
    "AcademicYear_Onec" INTEGER,
    "Semester_Onec" INTEGER,
    "DepartmentID_Onec" INTEGER,
    "SchoolID_Onec" INTEGER,
    "PersonID_Onec" TEXT PRIMARY KEY,
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
    "SubDistrictNameThai_Onec" TEXT
  );

  CREATE TABLE IF NOT EXISTS student_dropouts (
    "ProvinceNameThai_Onec" TEXT,
    "DistrictNameThai_Onec" TEXT,
    "SubDistrictNameThai_Onec" TEXT,
    "PersonID_Onec" TEXT PRIMARY KEY,
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
      "RecordedAt"          TIMESTAMP DEFAULT NOW(),
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
    is_system BOOLEAN NOT NULL DEFAULT FALSE
  );

  ALTER TABLE roles ADD COLUMN IF NOT EXISTS rank INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS default_permissions JSONB NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope_mode TEXT NOT NULL DEFAULT 'flexible';
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

  ${SYSTEM_ROLE_BASELINE_SQL}

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    fullname TEXT,
    "PersonID_Onec" TEXT,
    phone TEXT,
    email TEXT,
    affiliation TEXT,
    status TEXT DEFAULT 'ACTIVE',
    permissions JSONB DEFAULT '[]'::jsonb,
    role TEXT DEFAULT 'TEACHER',
    data_scope JSONB DEFAULT '{}'::jsonb,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS external_users (
    "ExternalID" SERIAL PRIMARY KEY,
    "PersonID_Onec" TEXT UNIQUE,
    "FullName" TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  ALTER TABLE users ADD COLUMN IF NOT EXISTS "PersonID_Onec" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "FirstName" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "LastName" TEXT;
  ALTER TABLE users DROP COLUMN IF EXISTS fullname;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "phone" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "email" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "affiliation" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'ACTIVE';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "permissions" JSONB DEFAULT '[]';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "role" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "data_scope" JSONB DEFAULT '{}'::jsonb;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS student_id TEXT;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS rank INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS default_permissions JSONB NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope_mode TEXT NOT NULL DEFAULT 'flexible';
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

  CREATE INDEX IF NOT EXISTS idx_task_links_token ON task_links(token_hash);
  CREATE INDEX IF NOT EXISTS idx_task_links_task_id ON task_links(task_id);
  CREATE INDEX IF NOT EXISTS idx_case_reviews_case_id ON case_reviews(case_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_person_id ON attendance("PersonID_Onec");
  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance("AttendanceDate");

  ALTER TABLE task_links ALTER COLUMN expires_at TYPE TIMESTAMP WITH TIME ZONE;
  ALTER TABLE task_links ALTER COLUMN otp_expires_at TYPE TIMESTAMP WITH TIME ZONE USING otp_expires_at AT TIME ZONE 'UTC';
  ALTER TABLE task_links ALTER COLUMN admin_lock_at TYPE TIMESTAMP WITH TIME ZONE USING admin_lock_at AT TIME ZONE 'UTC';
  ALTER TABLE task_links ALTER COLUMN created_at TYPE TIMESTAMP WITH TIME ZONE USING created_at AT TIME ZONE 'UTC';
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS login_role TEXT;
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS login_permissions JSONB DEFAULT '[]'::jsonb;
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS login_data_scope JSONB DEFAULT '{}'::jsonb;

  ALTER TABLE cases ADD COLUMN IF NOT EXISTS result_summary TEXT;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS target_school_id INTEGER;
  ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS address_changed BOOLEAN DEFAULT FALSE;
  ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS updated_student_address TEXT;
  ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS updated_lat REAL;
  ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS updated_lng REAL;

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

  ${AUDIT_RETROFIT_SQL}
`;

export async function syncSystemRoleDefinitions(executor: SqlExecutor): Promise<void> {
  for (const role of SYSTEM_ROLE_DEFINITIONS) {
    await executor.query(
      `
        INSERT INTO roles (name, label, rank, default_permissions, scope_mode, is_system)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6)
        ON CONFLICT (name) DO NOTHING
      `,
      [
        role.name,
        role.label,
        role.rank,
        JSON.stringify(role.default_permissions),
        role.scope_mode,
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
          is_system = $6
        WHERE name = $1
      `,
      [
        role.name,
        role.label,
        role.rank,
        JSON.stringify(role.default_permissions),
        role.scope_mode,
        role.is_system,
      ],
    );
  }
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
