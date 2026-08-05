/**
 * Frozen schema snapshot for the first TypeORM migration.
 *
 * Never import the live bootstrap catalog here: a historical migration must
 * create the same schema years later that it created on its release date.
 * Subsequent migrations own every change after 2026-03-28.
 */
const FROZEN_ROLE_ROWS = [
  [
    'ADMIN',
    'ผู้ดูแลระบบ',
    9,
    [
      'home',
      'dashboard',
      'students',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'manage-role-groups',
      'login-links',
      'settings',
      'import-data',
    ],
    'global',
    true,
  ],
  [
    'ADMIN_PROVINCE',
    'แอดมินระดับจังหวัด',
    8,
    [
      'home',
      'dashboard',
      'students',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
    ],
    'province',
    true,
  ],
  [
    'ADMIN_DISTRICT',
    'แอดมินระดับอำเภอ',
    7,
    [
      'home',
      'dashboard',
      'students',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
    ],
    'district',
    true,
  ],
  [
    'ADMIN_SUBDISTRICT',
    'แอดมินระดับตำบล',
    6,
    [
      'home',
      'dashboard',
      'students',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
    ],
    'sub_district',
    true,
  ],
  [
    'ADMIN_SCHOOL',
    'แอดมินระดับโรงเรียน',
    5,
    [
      'home',
      'dashboard',
      'students',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
    ],
    'school',
    true,
  ],
  [
    'DIRECTOR',
    'ผู้อำนวยการ',
    4,
    [
      'home',
      'dashboard',
      'students',
      'create',
      'attendance',
      'attendance-dashboard',
      'manage-users-list',
      'login-links',
      'settings',
    ],
    'flexible',
    true,
  ],
  [
    'EXECUTIVE',
    'ผู้บริหาร',
    3,
    ['home', 'dashboard', 'students', 'attendance-dashboard'],
    'flexible',
    true,
  ],
  ['TEACHER', 'คุณครู', 2, ['home', 'students', 'attendance'], 'flexible', true],
  ['STUDENT', 'นักเรียน', 1, ['home', 'student-self'], 'flexible', true],
] as const;

const FROZEN_SETTING_ROWS = [
  ['ABSENT_THRESHOLD_DAYS', '3', 'จำนวนวันขาดเรียนติดต่อกันก่อนที่จะแจ้งเตือนหรือเปิดเคสอัตโนมัติ'],
  [
    'ALERT_TRIGGER_TYPE',
    'SCHEDULED',
    'รูปแบบการทำงาน (SCHEDULED = ตามตารางกะเวลา, IMMEDIATE = แจ้งเตือนทันที)',
  ],
  [
    'ALERT_SCHEDULE_TIME',
    '18:00',
    'เวลาที่จะรันบอทตรวจสอบข้อมูล (HH:MM) เมื่อเลือกรูปแบบ SCHEDULED',
  ],
] as const;

function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

const FROZEN_ROLE_SQL = FROZEN_ROLE_ROWS.map(
  ([name, label, rank, permissions, scopeMode, isSystem]) => `
    INSERT INTO roles (name, label, rank, default_permissions, scope_mode, is_system)
    VALUES ('${sqlLiteral(name)}', '${sqlLiteral(label)}', ${rank}, '${sqlLiteral(JSON.stringify(permissions))}'::jsonb, '${scopeMode}', ${isSystem ? 'TRUE' : 'FALSE'})
    ON CONFLICT (name) DO NOTHING;`,
).join('\n');

const FROZEN_SETTING_SQL = FROZEN_SETTING_ROWS.map(
  ([key, value, description]) => `
    INSERT INTO system_settings (setting_key, setting_value, description)
    VALUES ('${sqlLiteral(key)}', '${sqlLiteral(value)}', '${sqlLiteral(description)}')
    ON CONFLICT (setting_key) DO NOTHING;`,
).join('\n');

export const MIGRATION_BASELINE_202603_SQL = `
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
    "AttendanceID" SERIAL PRIMARY KEY,
    "PersonID_Onec" VARCHAR(20) NOT NULL REFERENCES student_term("PersonID_Onec"),
    "SchoolID_Onec" INT NOT NULL,
    "GradeLevelID_Onec" INT NOT NULL,
    "RoomID_Onec" INT NOT NULL,
    "AcademicYear_Onec" INT NOT NULL,
    "Semester_Onec" INT NOT NULL,
    "AttendanceDate" DATE NOT NULL,
    "Period" INT NOT NULL,
    "AttendanceStatus" SMALLINT NOT NULL,
    "RecordedAt" TIMESTAMP DEFAULT NOW(),
    "RecordedBy" VARCHAR(100)
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

  ${FROZEN_ROLE_SQL}

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

  ALTER TABLE users ADD COLUMN IF NOT EXISTS "FirstName" TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS "LastName" TEXT;
  ALTER TABLE users DROP COLUMN IF EXISTS fullname;

  CREATE INDEX IF NOT EXISTS idx_task_links_token ON task_links(token_hash);
  CREATE INDEX IF NOT EXISTS idx_task_links_task_id ON task_links(task_id);
  CREATE INDEX IF NOT EXISTS idx_case_reviews_case_id ON case_reviews(case_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_person_id ON attendance("PersonID_Onec");
  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance("AttendanceDate");

  ALTER TABLE task_links ALTER COLUMN expires_at TYPE TIMESTAMP WITH TIME ZONE;
  ALTER TABLE task_links ALTER COLUMN otp_expires_at TYPE TIMESTAMP WITH TIME ZONE USING otp_expires_at AT TIME ZONE 'UTC';
  ALTER TABLE task_links ALTER COLUMN admin_lock_at TYPE TIMESTAMP WITH TIME ZONE USING admin_lock_at AT TIME ZONE 'UTC';
  ALTER TABLE task_links ALTER COLUMN created_at TYPE TIMESTAMP WITH TIME ZONE USING created_at AT TIME ZONE 'UTC';
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS login_role TEXT;
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS login_permissions JSONB DEFAULT '[]'::jsonb;
  ALTER TABLE task_links ADD COLUMN IF NOT EXISTS login_data_scope JSONB DEFAULT '{}'::jsonb;

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_term_school') THEN
      UPDATE student_term SET "SchoolID_Onec" = NULL
      WHERE "SchoolID_Onec" IS NOT NULL AND "SchoolID_Onec" NOT IN (SELECT id FROM schools);
      ALTER TABLE student_term ADD CONSTRAINT fk_student_term_school
        FOREIGN KEY ("SchoolID_Onec") REFERENCES schools(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_dropouts_school') THEN
      UPDATE student_dropouts SET "SchoolID_Onec" = NULL
      WHERE "SchoolID_Onec" IS NOT NULL AND "SchoolID_Onec" NOT IN (SELECT id FROM schools);
      ALTER TABLE student_dropouts ADD CONSTRAINT fk_student_dropouts_school
        FOREIGN KEY ("SchoolID_Onec") REFERENCES schools(id) ON DELETE SET NULL;
    END IF;
  END $$;

  CREATE TABLE IF NOT EXISTS system_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  ${FROZEN_SETTING_SQL}

  UPDATE users SET role = NULL WHERE role IS NOT NULL AND btrim(role) = '';
  UPDATE users SET role = 'TEACHER' WHERE role = 'STAFF';
  UPDATE users SET role = 'TEACHER'
  WHERE role IS NULL OR role NOT IN (SELECT name FROM roles WHERE name <> 'STAFF');
  DELETE FROM roles WHERE name = 'STAFF';
  UPDATE users SET permissions = '[]'::jsonb WHERE permissions IS NULL;
  UPDATE users SET data_scope = '{}'::jsonb WHERE data_scope IS NULL;
  ALTER TABLE users ALTER COLUMN permissions SET DEFAULT '[]'::jsonb;
  ALTER TABLE users ALTER COLUMN data_scope SET DEFAULT '{}'::jsonb;
  ALTER TABLE users ALTER COLUMN role SET DEFAULT 'TEACHER';
  ALTER TABLE users ALTER COLUMN role SET NOT NULL;

  DO $constraint$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_role_name') THEN
      ALTER TABLE users ADD CONSTRAINT fk_users_role_name
        FOREIGN KEY (role) REFERENCES roles(name)
        ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
  END $constraint$;

  DROP TABLE IF EXISTS user_roles;

  CREATE TABLE IF NOT EXISTS risk_factors (id SERIAL PRIMARY KEY, label TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS dropout_reasons (id SERIAL PRIMARY KEY, label TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS assistance_measures (id SERIAL PRIMARY KEY, label TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS related_agencies (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS educational_areas (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE);
`;
