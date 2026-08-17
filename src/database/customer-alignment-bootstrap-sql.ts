const AUDIT_COLUMNS_SQL = `created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL`;

/**
 * Fresh-schema final state for the customer-alignment feature chain.
 *
 * This intentionally creates structure only. Historical classroom, membership,
 * enrollment-reference, and permission backfills remain migration concerns.
 * The base bootstrap must create users, schools, grade_levels, subjects,
 * school_terms, student_term, timetable_slots, tasks, and import tables first.
 */
export const CUSTOMER_ALIGNMENT_FEATURE_TABLES_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS trigger AS $set_updated_at$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
  $set_updated_at$ LANGUAGE plpgsql;

  DO $import_target$
  BEGIN
    ALTER TABLE student_import_batches
      DROP CONSTRAINT IF EXISTS chk_student_import_batches_target;
    ALTER TABLE student_import_batches
      ADD CONSTRAINT chk_student_import_batches_target
      CHECK (target IN (
        'student_term',
        'student_exit_events',
        'school_teacher_membership',
        'school_classroom',
        'classroom_teacher_assignment'
      ));
  END;
  $import_target$;

  INSERT INTO student_import_quarantine_reason_codes (code, label_th, sort_order)
  VALUES
    ('BLANK_TEACHER_USERNAME', 'ไม่มีชื่อผู้ใช้ครู', 130),
    ('DUPLICATE_TEACHER_ROW', 'บัญชีครูซ้ำในไฟล์', 140),
    ('TEACHER_ACCOUNT_NOT_FOUND', 'ไม่พบบัญชีครูในระบบ', 150),
    ('INVALID_TEACHER_PERMISSION', 'บัญชีไม่มีสิทธิ์ปฏิบัติงานครู', 160),
    ('INVALID_TEACHER_START_DATE', 'วันที่เริ่มปฏิบัติงานไม่ถูกต้อง', 170),
    ('MISSING_IMPORT_FIELD', 'ข้อมูลบังคับของรายการนำเข้าไม่ครบ', 180),
    ('CLASSROOM_IDENTITY_CONFLICT', 'รหัสหรือเลขห้องชนกับห้องเรียนเดิม', 190),
    ('TEACHER_MEMBERSHIP_NOT_FOUND', 'ไม่พบครูในรายชื่อครูของโรงเรียน', 200),
    ('SUBJECT_NOT_FOUND', 'ไม่พบวิชาในข้อมูลหลัก', 210),
    ('INVALID_ASSIGNMENT_KIND', 'ประเภทการมอบหมายครูไม่ถูกต้อง', 220),
    ('INVALID_IMPORT_DATE', 'ช่วงวันที่ของรายการนำเข้าไม่ถูกต้อง', 230),
    ('ASSIGNMENT_CONFLICT', 'การมอบหมายครูชนกับรายการที่ใช้งานอยู่', 240)
  ON CONFLICT (code) DO UPDATE
  SET label_th = EXCLUDED.label_th,
      sort_order = EXCLUDED.sort_order;

  DO $school_term_scope$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'uq_school_terms_id_school'
        AND conrelid = 'school_terms'::regclass
    ) THEN
      ALTER TABLE school_terms
        ADD CONSTRAINT uq_school_terms_id_school UNIQUE (id, school_id);
    END IF;
  END;
  $school_term_scope$;

  CREATE TABLE IF NOT EXISTS school_classrooms (
    id BIGSERIAL PRIMARY KEY,
    school_term_id BIGINT NOT NULL,
    school_id INTEGER NOT NULL,
    grade_level_id INTEGER NOT NULL,
    legacy_room_number INTEGER NOT NULL,
    room_code VARCHAR(32) NOT NULL,
    room_name VARCHAR(120),
    classroom_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    card_cover_color VARCHAR(7) NOT NULL DEFAULT '#4F86E8',
    cover_image_storage_key VARCHAR(255),
    cover_image_position_x SMALLINT NOT NULL DEFAULT 50,
    cover_image_position_y SMALLINT NOT NULL DEFAULT 50,
    cover_image_scale NUMERIC(4,2) NOT NULL DEFAULT 1.00,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT uq_school_classrooms_identity
      UNIQUE (id, school_term_id, school_id, grade_level_id, legacy_room_number),
    CONSTRAINT uq_school_classrooms_id_school UNIQUE (id, school_id),
    CONSTRAINT fk_school_classrooms_term_school
      FOREIGN KEY (school_term_id, school_id)
      REFERENCES school_terms(id, school_id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_school_classrooms_school
      FOREIGN KEY (school_id) REFERENCES schools(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_school_classrooms_grade
      FOREIGN KEY (grade_level_id) REFERENCES grade_levels(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_school_classrooms_room_code
      CHECK (
        room_code ~ '^[1-9][0-9]*$'
        AND (
          length(room_code) < 10
          OR (length(room_code) = 10 AND room_code <= '2147483647')
        )
      ),
    CONSTRAINT chk_school_classrooms_legacy_room
      CHECK (legacy_room_number::text = room_code),
    CONSTRAINT chk_school_classrooms_status
      CHECK (classroom_status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT chk_school_classrooms_card_cover_color
      CHECK (card_cover_color ~ '^#[0-9A-F]{6}$'),
    CONSTRAINT chk_school_classrooms_cover_image_position_x
      CHECK (cover_image_position_x BETWEEN 0 AND 100),
    CONSTRAINT chk_school_classrooms_cover_image_position_y
      CHECK (cover_image_position_y BETWEEN 0 AND 100),
    CONSTRAINT chk_school_classrooms_cover_image_scale
      CHECK (cover_image_scale BETWEEN 1.00 AND 3.00)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_school_classrooms_term_grade_code
    ON school_classrooms (school_term_id, grade_level_id, lower(room_code))
    WHERE deleted_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_school_classrooms_term_grade_legacy_room
    ON school_classrooms (school_term_id, grade_level_id, legacy_room_number)
    WHERE deleted_at IS NULL AND legacy_room_number IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_school_classrooms_scope
    ON school_classrooms (school_id, classroom_status, school_term_id, grade_level_id)
    WHERE deleted_at IS NULL;

  CREATE TABLE IF NOT EXISTS user_classroom_favorites (
    user_id INTEGER NOT NULL,
    classroom_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_classroom_favorites PRIMARY KEY (user_id, classroom_id),
    CONSTRAINT fk_user_classroom_favorites_user
      FOREIGN KEY (user_id) REFERENCES users(id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_user_classroom_favorites_classroom
      FOREIGN KEY (classroom_id) REFERENCES school_classrooms(id)
      ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_user_classroom_favorites_order
    ON user_classroom_favorites (user_id, created_at DESC, classroom_id);

  CREATE TABLE IF NOT EXISTS classroom_student_comments (
    id BIGSERIAL PRIMARY KEY,
    classroom_id BIGINT NOT NULL,
    person_uuid UUID NOT NULL,
    comment_text TEXT NOT NULL,
    authored_by_user_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_classroom_student_comments_classroom
      FOREIGN KEY (classroom_id) REFERENCES school_classrooms(id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_classroom_student_comments_person
      FOREIGN KEY (person_uuid) REFERENCES student_person(person_uuid)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_classroom_student_comments_author
      FOREIGN KEY (authored_by_user_id) REFERENCES users(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_classroom_student_comments_text
      CHECK (
        comment_text = BTRIM(comment_text)
        AND CHAR_LENGTH(comment_text) BETWEEN 1 AND 2000
      )
  );
  CREATE INDEX IF NOT EXISTS idx_classroom_student_comments_latest
    ON classroom_student_comments (
      classroom_id,
      person_uuid,
      created_at DESC,
      id DESC
    );

  CREATE TABLE IF NOT EXISTS school_teacher_memberships (
    id BIGSERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL,
    teacher_user_id INTEGER NOT NULL,
    membership_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    started_on DATE NOT NULL DEFAULT CURRENT_DATE,
    ended_on DATE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT uq_school_teacher_memberships_id_school UNIQUE (id, school_id),
    CONSTRAINT fk_school_teacher_memberships_school
      FOREIGN KEY (school_id) REFERENCES schools(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_school_teacher_memberships_user
      FOREIGN KEY (teacher_user_id) REFERENCES users(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_school_teacher_memberships_status
      CHECK (membership_status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT chk_school_teacher_memberships_dates
      CHECK (ended_on IS NULL OR ended_on >= started_on)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_school_teacher_memberships_active
    ON school_teacher_memberships (school_id, teacher_user_id)
    WHERE membership_status = 'ACTIVE' AND deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_school_teacher_memberships_scope
    ON school_teacher_memberships (school_id, membership_status, teacher_user_id)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_school_teacher_memberships_teacher
    ON school_teacher_memberships (teacher_user_id, membership_status)
    WHERE deleted_at IS NULL;

  CREATE TABLE IF NOT EXISTS classroom_teacher_assignments (
    id BIGSERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL,
    classroom_id BIGINT NOT NULL,
    teacher_membership_id BIGINT NOT NULL,
    subject_id INTEGER,
    assignment_kind VARCHAR(16) NOT NULL,
    assignment_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    effective_on DATE,
    effective_until DATE,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT fk_classroom_teacher_assignments_classroom
      FOREIGN KEY (classroom_id, school_id)
      REFERENCES school_classrooms(id, school_id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_classroom_teacher_assignments_membership
      FOREIGN KEY (teacher_membership_id, school_id)
      REFERENCES school_teacher_memberships(id, school_id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_classroom_teacher_assignments_subject
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_classroom_teacher_assignments_kind
      CHECK (assignment_kind IN ('HOMEROOM', 'SUBJECT')),
    CONSTRAINT chk_classroom_teacher_assignments_subject
      CHECK (
        (assignment_kind = 'HOMEROOM' AND subject_id IS NULL)
        OR (assignment_kind = 'SUBJECT' AND subject_id IS NOT NULL)
      ),
    CONSTRAINT chk_classroom_teacher_assignments_status
      CHECK (assignment_status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT chk_classroom_teacher_assignments_dates
      CHECK (
        effective_until IS NULL
        OR effective_on IS NULL
        OR effective_until >= effective_on
      )
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_classroom_teacher_assignments_homeroom
    ON classroom_teacher_assignments (classroom_id)
    WHERE assignment_kind = 'HOMEROOM'
      AND assignment_status = 'ACTIVE'
      AND deleted_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_classroom_teacher_assignments_subject
    ON classroom_teacher_assignments (classroom_id, teacher_membership_id, subject_id)
    WHERE assignment_kind = 'SUBJECT'
      AND assignment_status = 'ACTIVE'
      AND deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_classroom_teacher_assignments_classroom
    ON classroom_teacher_assignments (classroom_id, assignment_status)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_classroom_teacher_assignments_teacher
    ON classroom_teacher_assignments (teacher_membership_id, assignment_status)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_classroom_teacher_assignments_subject
    ON classroom_teacher_assignments (subject_id, assignment_status)
    WHERE deleted_at IS NULL AND subject_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS school_structure_backfill_issues (
    id BIGSERIAL PRIMARY KEY,
    student_uuid UUID NOT NULL,
    reason_code VARCHAR(32) NOT NULL,
    legacy_school_id INTEGER,
    legacy_academic_year INTEGER,
    legacy_semester INTEGER,
    legacy_grade_level_id INTEGER,
    legacy_room_number INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_school_structure_backfill_issue_enrollment
      FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT uq_school_structure_backfill_issue UNIQUE (student_uuid, reason_code),
    CONSTRAINT chk_school_structure_backfill_issue_reason
      CHECK (reason_code IN ('TERM_NOT_FOUND', 'GRADE_NOT_FOUND', 'INVALID_ROOM'))
  );
  CREATE INDEX IF NOT EXISTS idx_school_structure_backfill_issues_reason
    ON school_structure_backfill_issues (reason_code, created_at);

  DO $student_term_structure$
  BEGIN
    ALTER TABLE student_term ADD COLUMN IF NOT EXISTS school_term_id BIGINT;
    ALTER TABLE student_term ADD COLUMN IF NOT EXISTS classroom_id BIGINT;
    ALTER TABLE student_term ADD COLUMN IF NOT EXISTS student_number VARCHAR(50);

    DO $student_number_constraints$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_student_term_student_number_format'
      ) THEN
        ALTER TABLE student_term
        ADD CONSTRAINT chk_student_term_student_number_format
        CHECK (
          student_number IS NULL
          OR (
            student_number = BTRIM(student_number)
            AND CHAR_LENGTH(student_number) BETWEEN 1 AND 50
          )
        );
      END IF;
    END
    $student_number_constraints$;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_student_term_school_term_student_number
      ON student_term (
        "SchoolID_Onec",
        "AcademicYear_Onec",
        "Semester_Onec",
        student_number
      )
      WHERE student_number IS NOT NULL AND deleted_at IS NULL;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'fk_student_term_school_term_school'
        AND conrelid = 'student_term'::regclass
    ) THEN
      ALTER TABLE student_term
        ADD CONSTRAINT fk_student_term_school_term_school
        FOREIGN KEY (school_term_id, "SchoolID_Onec")
        REFERENCES school_terms(id, school_id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'fk_student_term_classroom_identity'
        AND conrelid = 'student_term'::regclass
    ) THEN
      ALTER TABLE student_term
        ADD CONSTRAINT fk_student_term_classroom_identity
        FOREIGN KEY (
          classroom_id,
          school_term_id,
          "SchoolID_Onec",
          "GradeLevelID_Onec",
          "RoomID_Onec"
        )
        REFERENCES school_classrooms(
          id,
          school_term_id,
          school_id,
          grade_level_id,
          legacy_room_number
        )
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
  END;
  $student_term_structure$;
  CREATE INDEX IF NOT EXISTS idx_student_term_school_term
    ON student_term (school_term_id, classroom_id)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_student_term_classroom
    ON student_term (classroom_id, person_uuid)
    WHERE deleted_at IS NULL AND classroom_id IS NOT NULL;

  ALTER TABLE timetable_slots ADD COLUMN IF NOT EXISTS classroom_id BIGINT;
  ALTER TABLE timetable_slots ALTER COLUMN classroom_id SET NOT NULL;
  DO $timetable_classroom_fk$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'fk_timetable_slots_classroom_identity'
        AND conrelid = 'timetable_slots'::regclass
    ) THEN
      ALTER TABLE timetable_slots
        ADD CONSTRAINT fk_timetable_slots_classroom_identity
        FOREIGN KEY (classroom_id, school_term_id, school_id, grade_level_id, room_no)
        REFERENCES school_classrooms(
          id,
          school_term_id,
          school_id,
          grade_level_id,
          legacy_room_number
        )
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
  END;
  $timetable_classroom_fk$;
  CREATE INDEX IF NOT EXISTS idx_timetable_slots_classroom
    ON timetable_slots (classroom_id, day_of_week, period)
    WHERE deleted_at IS NULL;

  CREATE OR REPLACE FUNCTION resolve_student_term_structure_refs()
  RETURNS trigger AS $student_structure$
  BEGIN
    SELECT term.id
    INTO NEW.school_term_id
    FROM school_terms term
    WHERE term.school_id = NEW."SchoolID_Onec"
      AND term.academic_year = NEW."AcademicYear_Onec"
      AND term.semester = NEW."Semester_Onec"
      AND term.deleted_at IS NULL
    LIMIT 1;
    IF NEW.school_term_id IS NULL THEN
      RAISE EXCEPTION 'school term is not configured for this enrollment'
        USING ERRCODE = '23503';
    END IF;
    SELECT classroom.id
    INTO NEW.classroom_id
    FROM school_classrooms classroom
    WHERE classroom.school_term_id = NEW.school_term_id
      AND classroom.school_id = NEW."SchoolID_Onec"
      AND classroom.grade_level_id = NEW."GradeLevelID_Onec"
      AND classroom.legacy_room_number = NEW."RoomID_Onec"
      AND classroom.classroom_status = 'ACTIVE'
      AND classroom.deleted_at IS NULL
    LIMIT 1;
    IF NEW.classroom_id IS NULL THEN
      RAISE EXCEPTION 'classroom is not configured for this enrollment'
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END;
  $student_structure$ LANGUAGE plpgsql;

  CREATE OR REPLACE FUNCTION resolve_timetable_slot_classroom()
  RETURNS trigger AS $slot_structure$
  BEGIN
    SELECT classroom.id
    INTO NEW.classroom_id
    FROM school_classrooms classroom
    WHERE classroom.school_term_id = NEW.school_term_id
      AND classroom.school_id = NEW.school_id
      AND classroom.grade_level_id = NEW.grade_level_id
      AND classroom.legacy_room_number = NEW.room_no
      AND classroom.classroom_status = 'ACTIVE'
      AND classroom.deleted_at IS NULL
    LIMIT 1;
    IF NEW.classroom_id IS NULL THEN
      RAISE EXCEPTION 'classroom is not configured for this timetable slot'
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END;
  $slot_structure$ LANGUAGE plpgsql;

  DO $structure_triggers$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_student_term_resolve_structure_refs'
        AND tgrelid = 'student_term'::regclass AND NOT tgisinternal
    ) THEN
      CREATE TRIGGER trg_student_term_resolve_structure_refs
        BEFORE INSERT OR UPDATE OF
          "SchoolID_Onec", "AcademicYear_Onec", "Semester_Onec",
          "GradeLevelID_Onec", "RoomID_Onec"
        ON student_term
        FOR EACH ROW EXECUTE FUNCTION resolve_student_term_structure_refs();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_timetable_slots_resolve_classroom'
        AND tgrelid = 'timetable_slots'::regclass AND NOT tgisinternal
    ) THEN
      CREATE TRIGGER trg_timetable_slots_resolve_classroom
        BEFORE INSERT OR UPDATE OF school_term_id, school_id, grade_level_id, room_no
        ON timetable_slots
        FOR EACH ROW EXECUTE FUNCTION resolve_timetable_slot_classroom();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_school_classrooms_set_updated_at'
        AND tgrelid = 'school_classrooms'::regclass AND NOT tgisinternal
    ) THEN
      CREATE TRIGGER trg_school_classrooms_set_updated_at
        BEFORE UPDATE ON school_classrooms
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_school_teacher_memberships_set_updated_at'
        AND tgrelid = 'school_teacher_memberships'::regclass AND NOT tgisinternal
    ) THEN
      CREATE TRIGGER trg_school_teacher_memberships_set_updated_at
        BEFORE UPDATE ON school_teacher_memberships
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_classroom_teacher_assignments_set_updated_at'
        AND tgrelid = 'classroom_teacher_assignments'::regclass AND NOT tgisinternal
    ) THEN
      CREATE TRIGGER trg_classroom_teacher_assignments_set_updated_at
        BEFORE UPDATE ON classroom_teacher_assignments
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  END;
  $structure_triggers$;

  DO $teacher_access_scope_keys$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'uq_school_classrooms_id_term_school'
        AND conrelid = 'school_classrooms'::regclass
    ) THEN
      ALTER TABLE school_classrooms
        ADD CONSTRAINT uq_school_classrooms_id_term_school
        UNIQUE (id, school_term_id, school_id);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'uq_classroom_teacher_assignments_id_scope'
        AND conrelid = 'classroom_teacher_assignments'::regclass
    ) THEN
      ALTER TABLE classroom_teacher_assignments
        ADD CONSTRAINT uq_classroom_teacher_assignments_id_scope
        UNIQUE (id, teacher_membership_id, school_id, classroom_id);
    END IF;
  END;
  $teacher_access_scope_keys$;

  INSERT INTO system_settings (setting_key, setting_value, description)
  VALUES
    (
      'TEACHER_ACCESS_DEFAULT_EXPIRY_POLICY',
      'TERM_END',
      'นโยบายวันหมดอายุเริ่มต้นของลิงก์ครูเมื่อผู้ดูแลไม่ระบุวันหมดอายุเอง'
    ),
    (
      'TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY',
      'EMAIL_OTP',
      'นโยบายยืนยันตัวตนเพิ่มสำหรับลิงก์ครู'
    )
  ON CONFLICT (setting_key) DO NOTHING;

  CREATE TABLE IF NOT EXISTS teacher_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_membership_id BIGINT NOT NULL,
    school_id INTEGER NOT NULL,
    school_term_id BIGINT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    token_encrypted TEXT,
    step_up_policy VARCHAR(24) NOT NULL DEFAULT 'NONE',
    issued_by INTEGER NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by INTEGER,
    revocation_reason VARCHAR(500),
    rotated_at TIMESTAMPTZ,
    rotation_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_teacher_access_grants_token_hash UNIQUE (token_hash),
    CONSTRAINT uq_teacher_access_grants_id_scope
      UNIQUE (id, teacher_membership_id, school_id, school_term_id),
    CONSTRAINT fk_teacher_access_grants_membership_school
      FOREIGN KEY (teacher_membership_id, school_id)
      REFERENCES school_teacher_memberships(id, school_id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_teacher_access_grants_term_school
      FOREIGN KEY (school_term_id, school_id)
      REFERENCES school_terms(id, school_id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_teacher_access_grants_issued_by
      FOREIGN KEY (issued_by) REFERENCES users(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_teacher_access_grants_revoked_by
      FOREIGN KEY (revoked_by) REFERENCES users(id)
      ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_teacher_access_grants_token_hash
      CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_teacher_access_grants_step_up
      CHECK (step_up_policy IN ('NONE', 'EMAIL_OTP', 'ARAID')),
    CONSTRAINT chk_teacher_access_grants_validity
      CHECK (expires_at > issued_at),
    CONSTRAINT chk_teacher_access_grants_revocation
      CHECK (
        (revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
        OR (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
      ),
    CONSTRAINT chk_teacher_access_grants_rotation_count CHECK (rotation_count >= 0)
  );
  CREATE INDEX IF NOT EXISTS idx_teacher_access_grants_school_term
    ON teacher_access_grants (school_id, school_term_id, issued_at DESC);
  CREATE INDEX IF NOT EXISTS idx_teacher_access_grants_teacher
    ON teacher_access_grants (teacher_membership_id, issued_at DESC);
  CREATE INDEX IF NOT EXISTS idx_teacher_access_grants_active
    ON teacher_access_grants (expires_at, last_used_at)
    WHERE revoked_at IS NULL;

  CREATE TABLE IF NOT EXISTS teacher_access_grant_capabilities (
    grant_id UUID NOT NULL,
    capability VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_teacher_access_grant_capabilities PRIMARY KEY (grant_id, capability),
    CONSTRAINT fk_teacher_access_grant_capabilities_grant
      FOREIGN KEY (grant_id) REFERENCES teacher_access_grants(id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_teacher_access_grant_capability
      CHECK (capability IN ('HOMEROOM_ATTENDANCE', 'SUBJECT_ATTENDANCE', 'TEACHER_OBSERVATION'))
  );

  CREATE TABLE IF NOT EXISTS teacher_access_grant_assignments (
    grant_id UUID NOT NULL,
    assignment_id BIGINT NOT NULL,
    teacher_membership_id BIGINT NOT NULL,
    school_id INTEGER NOT NULL,
    school_term_id BIGINT NOT NULL,
    classroom_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_teacher_access_grant_assignments PRIMARY KEY (grant_id, assignment_id),
    CONSTRAINT fk_teacher_access_grant_assignments_grant_scope
      FOREIGN KEY (grant_id, teacher_membership_id, school_id, school_term_id)
      REFERENCES teacher_access_grants(id, teacher_membership_id, school_id, school_term_id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_teacher_access_grant_assignments_assignment_scope
      FOREIGN KEY (assignment_id, teacher_membership_id, school_id, classroom_id)
      REFERENCES classroom_teacher_assignments(id, teacher_membership_id, school_id, classroom_id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_teacher_access_grant_assignments_classroom_term
      FOREIGN KEY (classroom_id, school_term_id, school_id)
      REFERENCES school_classrooms(id, school_term_id, school_id)
      ON DELETE RESTRICT ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_teacher_access_grant_assignments_assignment
    ON teacher_access_grant_assignments (assignment_id, grant_id);

  DO $student_enrollment_school_key$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'uq_student_term_uuid_school'
        AND conrelid = 'student_term'::regclass
    ) THEN
      ALTER TABLE student_term
        ADD CONSTRAINT uq_student_term_uuid_school
        UNIQUE (student_uuid, "SchoolID_Onec");
    END IF;
  END;
  $student_enrollment_school_key$;

  CREATE TABLE IF NOT EXISTS observation_dimensions (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    label_th VARCHAR(100) NOT NULL,
    requires_comment BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order SMALLINT NOT NULL,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT chk_observation_dimensions_code
      CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
    CONSTRAINT chk_observation_dimensions_label
      CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_observation_dimensions_sort_order CHECK (sort_order >= 0)
  );

  INSERT INTO observation_dimensions (code, label_th, requires_comment, sort_order)
  VALUES
    ('ATTENDANCE', 'การเข้าเรียน', FALSE, 10),
    ('LEARNING', 'การเรียน', FALSE, 20),
    ('BEHAVIOR', 'พฤติกรรม', FALSE, 30),
    ('EMOTIONAL', 'อารมณ์', FALSE, 40),
    ('SOCIAL', 'สังคม', FALSE, 50),
    ('FAMILY', 'ครอบครัว', FALSE, 60),
    ('OTHER', 'อื่น ๆ', TRUE, 70)
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS observation_behavior_tags (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(48) NOT NULL UNIQUE,
    label_th VARCHAR(120) NOT NULL,
    observation_dimension_id BIGINT,
    requires_comment BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order SMALLINT NOT NULL,
    ${AUDIT_COLUMNS_SQL},
    CONSTRAINT fk_observation_behavior_tags_dimension
      FOREIGN KEY (observation_dimension_id) REFERENCES observation_dimensions(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_observation_behavior_tags_code
      CHECK (code ~ '^[A-Z][A-Z0-9_]{1,47}$'),
    CONSTRAINT chk_observation_behavior_tags_label
      CHECK (length(trim(label_th)) > 0),
    CONSTRAINT chk_observation_behavior_tags_sort_order CHECK (sort_order >= 0)
  );

  INSERT INTO observation_behavior_tags (
    code, label_th, observation_dimension_id, requires_comment, sort_order
  )
  SELECT seed.code, seed.label_th, dimension.id, seed.requires_comment, seed.sort_order
  FROM (
    VALUES
      ('MISSING_ASSIGNMENTS', 'ไม่ส่งงาน', 'LEARNING', FALSE, 10),
      ('SLEEPING_IN_CLASS', 'หลับในห้อง', 'LEARNING', FALSE, 20),
      ('DISTRACTED', 'ไม่มีสมาธิ', 'BEHAVIOR', FALSE, 30),
      ('SOCIAL_WITHDRAWAL', 'แยกตัว', 'SOCIAL', FALSE, 40),
      ('PEER_CONFLICT', 'ทะเลาะกับเพื่อน', 'SOCIAL', FALSE, 50),
      ('MISSING_EQUIPMENT', 'อุปกรณ์ไม่พร้อม', 'LEARNING', FALSE, 60),
      ('OTHER', 'อื่น ๆ', NULL, TRUE, 70)
  ) AS seed(code, label_th, dimension_code, requires_comment, sort_order)
  LEFT JOIN observation_dimensions dimension ON dimension.code = seed.dimension_code
  ON CONFLICT (code) DO NOTHING;

  CREATE TABLE IF NOT EXISTS student_observations (
    id BIGSERIAL PRIMARY KEY,
    student_uuid UUID NOT NULL,
    school_id INTEGER NOT NULL,
    author_kind VARCHAR(24) NOT NULL,
    author_user_id INTEGER NOT NULL,
    author_teacher_membership_id BIGINT,
    source_teacher_access_grant_id UUID,
    source_assignment_id BIGINT,
    source_task_link_id UUID,
    source_timetable_slot_id BIGINT,
    observer_display_name VARCHAR(200),
    observation_dimension_id BIGINT NOT NULL,
    concern_level VARCHAR(16) NOT NULL DEFAULT 'NOTE',
    comment TEXT,
    comment_required BOOLEAN NOT NULL DEFAULT FALSE,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revision_number INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT fk_student_observations_enrollment_school
      FOREIGN KEY (student_uuid, school_id)
      REFERENCES student_term(student_uuid, "SchoolID_Onec")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_student_observations_school
      FOREIGN KEY (school_id) REFERENCES schools(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_student_observations_author
      FOREIGN KEY (author_user_id) REFERENCES users(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_student_observations_author_membership
      FOREIGN KEY (author_teacher_membership_id, school_id)
      REFERENCES school_teacher_memberships(id, school_id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_student_observations_teacher_grant
      FOREIGN KEY (source_teacher_access_grant_id) REFERENCES teacher_access_grants(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_student_observations_assignment
      FOREIGN KEY (source_assignment_id) REFERENCES classroom_teacher_assignments(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_student_observations_task_link
      FOREIGN KEY (source_task_link_id) REFERENCES task_links(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_student_observations_timetable_slot
      FOREIGN KEY (source_timetable_slot_id) REFERENCES timetable_slots(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_student_observations_dimension
      FOREIGN KEY (observation_dimension_id) REFERENCES observation_dimensions(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_student_observations_author_kind
      CHECK (author_kind IN ('USER', 'TEACHER_ACCESS')),
    CONSTRAINT chk_student_observations_author_context
      CHECK (
        (author_kind = 'USER' AND source_teacher_access_grant_id IS NULL)
        OR (
          author_kind = 'TEACHER_ACCESS'
          AND source_teacher_access_grant_id IS NOT NULL
          AND author_teacher_membership_id IS NOT NULL
          AND source_assignment_id IS NOT NULL
        )
      ),
    CONSTRAINT chk_student_observations_observer_display_name
      CHECK (
        observer_display_name IS NULL
        OR length(trim(observer_display_name)) BETWEEN 1 AND 200
      ),
    CONSTRAINT chk_student_observations_task_link_context
      CHECK (
        (
          source_task_link_id IS NULL
          AND source_timetable_slot_id IS NULL
          AND observer_display_name IS NULL
        )
        OR (
          author_kind = 'USER'
          AND source_task_link_id IS NOT NULL
          AND source_teacher_access_grant_id IS NULL
          AND author_teacher_membership_id IS NULL
          AND source_assignment_id IS NULL
          AND observer_display_name IS NOT NULL
        )
      ),
    CONSTRAINT chk_student_observations_concern_level
      CHECK (concern_level IN ('NOTE', 'WATCH', 'CONCERN')),
    CONSTRAINT chk_student_observations_comment_length
      CHECK (comment IS NULL OR length(trim(comment)) BETWEEN 1 AND 2000),
    CONSTRAINT chk_student_observations_required_comment
      CHECK (
        (concern_level <> 'CONCERN' AND comment_required = FALSE)
        OR (comment IS NOT NULL AND length(trim(comment)) > 0)
      ),
    CONSTRAINT chk_student_observations_revision CHECK (revision_number > 0)
  );
  CREATE INDEX IF NOT EXISTS idx_student_observations_student_timeline
    ON student_observations (student_uuid, observed_at DESC, id DESC)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_student_observations_school_concern
    ON student_observations (school_id, concern_level, observed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_student_observations_assignment
    ON student_observations (source_assignment_id, observed_at DESC)
    WHERE source_assignment_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_student_observations_task_link
    ON student_observations (source_task_link_id, observed_at DESC)
    WHERE source_task_link_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS student_observation_tags (
    observation_id BIGINT NOT NULL,
    behavior_tag_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_student_observation_tags PRIMARY KEY (observation_id, behavior_tag_id),
    CONSTRAINT fk_student_observation_tags_observation
      FOREIGN KEY (observation_id) REFERENCES student_observations(id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_student_observation_tags_tag
      FOREIGN KEY (behavior_tag_id) REFERENCES observation_behavior_tags(id)
      ON DELETE RESTRICT ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_student_observation_tags_tag
    ON student_observation_tags (behavior_tag_id, observation_id);

  CREATE TABLE IF NOT EXISTS student_observation_revisions (
    id BIGSERIAL PRIMARY KEY,
    observation_id BIGINT NOT NULL,
    revision_number INTEGER NOT NULL,
    observation_dimension_id BIGINT NOT NULL,
    concern_level VARCHAR(16) NOT NULL,
    comment TEXT,
    comment_required BOOLEAN NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    behavior_tag_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    changed_by_user_id INTEGER NOT NULL,
    source_teacher_access_grant_id UUID,
    change_reason VARCHAR(500),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_student_observation_revisions_number UNIQUE (observation_id, revision_number),
    CONSTRAINT fk_student_observation_revisions_observation
      FOREIGN KEY (observation_id) REFERENCES student_observations(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_student_observation_revisions_dimension
      FOREIGN KEY (observation_dimension_id) REFERENCES observation_dimensions(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_student_observation_revisions_actor
      FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_student_observation_revisions_grant
      FOREIGN KEY (source_teacher_access_grant_id) REFERENCES teacher_access_grants(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_student_observation_revisions_number CHECK (revision_number > 0),
    CONSTRAINT chk_student_observation_revisions_concern
      CHECK (concern_level IN ('NOTE', 'WATCH', 'CONCERN')),
    CONSTRAINT chk_student_observation_revisions_comment
      CHECK (comment IS NULL OR length(trim(comment)) BETWEEN 1 AND 2000),
    CONSTRAINT chk_student_observation_revisions_required_comment
      CHECK (
        (concern_level <> 'CONCERN' AND comment_required = FALSE)
        OR (comment IS NOT NULL AND length(trim(comment)) > 0)
      ),
    CONSTRAINT chk_student_observation_revisions_tag_ids
      CHECK (jsonb_typeof(behavior_tag_ids) = 'array'),
    CONSTRAINT chk_student_observation_revisions_reason
      CHECK (change_reason IS NULL OR length(trim(change_reason)) BETWEEN 1 AND 500)
  );
  CREATE INDEX IF NOT EXISTS idx_student_observation_revisions_history
    ON student_observation_revisions (observation_id, revision_number DESC);

  DO $observation_catalog_triggers$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_observation_dimensions_set_updated_at'
        AND tgrelid = 'observation_dimensions'::regclass AND NOT tgisinternal
    ) THEN
      CREATE TRIGGER trg_observation_dimensions_set_updated_at
        BEFORE UPDATE ON observation_dimensions
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_observation_behavior_tags_set_updated_at'
        AND tgrelid = 'observation_behavior_tags'::regclass AND NOT tgisinternal
    ) THEN
      CREATE TRIGGER trg_observation_behavior_tags_set_updated_at
        BEFORE UPDATE ON observation_behavior_tags
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  END;
  $observation_catalog_triggers$;

  CREATE TABLE IF NOT EXISTS student_observation_risk_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_uuid UUID NOT NULL,
    school_id INTEGER NOT NULL,
    calculated_attendance_risk VARCHAR(16) NOT NULL,
    teacher_concern_signal VARCHAR(16) NOT NULL,
    human_risk_decision VARCHAR(24) NOT NULL,
    decision_reason VARCHAR(1000) NOT NULL,
    decided_by INTEGER NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revision_number INTEGER NOT NULL,
    CONSTRAINT uq_observation_risk_reviews_revision UNIQUE (student_uuid, revision_number),
    CONSTRAINT fk_observation_risk_reviews_enrollment_school
      FOREIGN KEY (student_uuid, school_id)
      REFERENCES student_term(student_uuid, "SchoolID_Onec")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_observation_risk_reviews_school
      FOREIGN KEY (school_id) REFERENCES schools(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_observation_risk_reviews_actor
      FOREIGN KEY (decided_by) REFERENCES users(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_observation_risk_reviews_calculated_risk
      CHECK (calculated_attendance_risk IN ('UNKNOWN', 'NORMAL', 'WATCH', 'LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT chk_observation_risk_reviews_teacher_signal
      CHECK (teacher_concern_signal IN ('NONE', 'WATCH', 'CONCERN')),
    CONSTRAINT chk_observation_risk_reviews_decision
      CHECK (human_risk_decision IN ('CONFIRM_RISK', 'WATCH', 'NO_ACTION')),
    CONSTRAINT chk_observation_risk_reviews_reason
      CHECK (length(trim(decision_reason)) BETWEEN 1 AND 1000),
    CONSTRAINT chk_observation_risk_reviews_revision CHECK (revision_number > 0)
  );
  CREATE INDEX IF NOT EXISTS idx_observation_risk_reviews_student_latest
    ON student_observation_risk_reviews (student_uuid, revision_number DESC);
  CREATE INDEX IF NOT EXISTS idx_observation_risk_reviews_school_time
    ON student_observation_risk_reviews (school_id, decided_at DESC);

  CREATE TABLE IF NOT EXISTS student_observation_risk_review_sources (
    risk_review_id UUID NOT NULL,
    observation_id BIGINT NOT NULL,
    observation_revision INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_observation_risk_review_sources PRIMARY KEY (risk_review_id, observation_id),
    CONSTRAINT fk_observation_risk_review_sources_review
      FOREIGN KEY (risk_review_id) REFERENCES student_observation_risk_reviews(id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_observation_risk_review_sources_observation_revision
      FOREIGN KEY (observation_id, observation_revision)
      REFERENCES student_observation_revisions(observation_id, revision_number)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_observation_risk_review_sources_revision CHECK (observation_revision > 0)
  );
  CREATE INDEX IF NOT EXISTS idx_observation_risk_review_sources_observation
    ON student_observation_risk_review_sources (observation_id, observation_revision);

  CREATE TABLE IF NOT EXISTS student_observation_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_uuid UUID NOT NULL,
    school_id INTEGER NOT NULL,
    requested_by_user_id INTEGER NOT NULL,
    input_fingerprint CHAR(64) NOT NULL,
    provider_code VARCHAR(64) NOT NULL,
    model_code VARCHAR(128) NOT NULL,
    prompt_version VARCHAR(64) NOT NULL,
    summary_text TEXT NOT NULL,
    themes JSONB NOT NULL DEFAULT '[]'::jsonb,
    trends JSONB NOT NULL DEFAULT '[]'::jsonb,
    agreements JSONB NOT NULL DEFAULT '[]'::jsonb,
    conflicting_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_observation_count INTEGER NOT NULL,
    is_stale BOOLEAN NOT NULL DEFAULT FALSE,
    review_state VARCHAR(24) NOT NULL DEFAULT 'PENDING_REVIEW',
    reviewed_by_user_id INTEGER,
    reviewer_display_name VARCHAR(200),
    review_note VARCHAR(1000),
    reviewed_at TIMESTAMPTZ,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_observation_summaries_enrollment_school
      FOREIGN KEY (student_uuid, school_id)
      REFERENCES student_term(student_uuid, "SchoolID_Onec")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_observation_summaries_school
      FOREIGN KEY (school_id) REFERENCES schools(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_observation_summaries_requester
      FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_observation_summaries_reviewer
      FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
      ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT uq_observation_summaries_input
      UNIQUE (student_uuid, input_fingerprint, provider_code, model_code, prompt_version),
    CONSTRAINT chk_observation_summaries_fingerprint
      CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_observation_summaries_versions
      CHECK (
        length(trim(provider_code)) BETWEEN 1 AND 64
        AND length(trim(model_code)) BETWEEN 1 AND 128
        AND length(trim(prompt_version)) BETWEEN 1 AND 64
      ),
    CONSTRAINT chk_observation_summaries_text
      CHECK (length(trim(summary_text)) BETWEEN 1 AND 10000),
    CONSTRAINT chk_observation_summaries_arrays
      CHECK (
        jsonb_typeof(themes) = 'array'
        AND jsonb_typeof(trends) = 'array'
        AND jsonb_typeof(agreements) = 'array'
        AND jsonb_typeof(conflicting_evidence) = 'array'
      ),
    CONSTRAINT chk_observation_summaries_source_count
      CHECK (source_observation_count BETWEEN 1 AND 100),
    CONSTRAINT chk_observation_summaries_review_state
      CHECK (review_state IN ('PENDING_REVIEW', 'REVIEWED', 'REJECTED')),
    CONSTRAINT chk_observation_summaries_review_metadata
      CHECK (
        (review_state = 'PENDING_REVIEW'
          AND reviewed_by_user_id IS NULL
          AND reviewer_display_name IS NULL
          AND review_note IS NULL
          AND reviewed_at IS NULL)
        OR
        (review_state IN ('REVIEWED', 'REJECTED')
          AND reviewer_display_name IS NOT NULL
          AND length(trim(reviewer_display_name)) > 0
          AND reviewed_at IS NOT NULL)
      ),
    CONSTRAINT chk_observation_summaries_review_note
      CHECK (review_note IS NULL OR length(trim(review_note)) BETWEEN 1 AND 1000),
    CONSTRAINT chk_observation_summaries_rejection_note
      CHECK (review_state <> 'REJECTED' OR review_note IS NOT NULL)
  );
  CREATE INDEX IF NOT EXISTS idx_observation_summaries_student_timeline
    ON student_observation_summaries (student_uuid, generated_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_observation_summaries_school_review
    ON student_observation_summaries (school_id, review_state, generated_at DESC)
    WHERE is_stale = FALSE;

  CREATE TABLE IF NOT EXISTS student_observation_summary_sources (
    summary_id UUID NOT NULL,
    observation_id BIGINT NOT NULL,
    observation_revision INTEGER NOT NULL,
    citation_order SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_observation_summary_sources
      PRIMARY KEY (summary_id, observation_id, observation_revision),
    CONSTRAINT uq_observation_summary_sources_order UNIQUE (summary_id, citation_order),
    CONSTRAINT fk_observation_summary_sources_summary
      FOREIGN KEY (summary_id) REFERENCES student_observation_summaries(id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_observation_summary_sources_revision
      FOREIGN KEY (observation_id, observation_revision)
      REFERENCES student_observation_revisions(observation_id, revision_number)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_observation_summary_sources_revision CHECK (observation_revision > 0),
    CONSTRAINT chk_observation_summary_sources_order CHECK (citation_order >= 0)
  );
  CREATE INDEX IF NOT EXISTS idx_observation_summary_sources_observation
    ON student_observation_summary_sources (observation_id, observation_revision);

  CREATE OR REPLACE FUNCTION mark_student_observation_summaries_stale()
  RETURNS TRIGGER AS $stale$
  BEGIN
    UPDATE student_observation_summaries summary
    SET is_stale = TRUE, updated_at = now()
    FROM student_observations observation
    WHERE observation.id = NEW.observation_id
      AND summary.student_uuid = observation.student_uuid
      AND summary.is_stale = FALSE;
    RETURN NEW;
  END;
  $stale$ LANGUAGE plpgsql;

  DO $summary_stale_trigger$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_student_observation_summary_stale'
        AND tgrelid = 'student_observation_revisions'::regclass AND NOT tgisinternal
    ) THEN
      CREATE TRIGGER trg_student_observation_summary_stale
        AFTER INSERT ON student_observation_revisions
        FOR EACH ROW EXECUTE FUNCTION mark_student_observation_summaries_stale();
    END IF;
  END;
  $summary_stale_trigger$;

  UPDATE roles
  SET default_permissions = default_permissions || '["manage-school-structure"]'::jsonb
  WHERE name IN ('ADMIN', 'DIRECTOR')
    AND NOT (default_permissions ? 'manage-school-structure');

  UPDATE roles
  SET default_permissions = default_permissions || '["import-data"]'::jsonb
  WHERE name IN ('ADMIN', 'DIRECTOR')
    AND NOT (default_permissions ? 'import-data');

  UPDATE roles
  SET default_permissions = default_permissions || '["manage-teacher-access"]'::jsonb
  WHERE name IN ('ADMIN', 'DIRECTOR')
    AND NOT (default_permissions ? 'manage-teacher-access');

  -- Teacher comments live on the รายชื่อนักเรียน page since the permission
  -- catalogue collapsed to one id per page; the separate observation ids are gone.
  UPDATE roles
  SET default_permissions = default_permissions || '["students"]'::jsonb
  WHERE name IN ('ADMIN', 'DIRECTOR')
    AND NOT (default_permissions ? 'students');
`;
