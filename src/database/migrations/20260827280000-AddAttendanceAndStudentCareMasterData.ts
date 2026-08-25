import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const AUDIT_COLUMNS = `
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
`;

const CATALOG_TABLES = [
  'absence_reason_categories',
  'absence_reasons',
  'disadvantage_types',
  'disability_types',
] as const;

async function secureTables(queryRunner: QueryRunner, tables: readonly string[]): Promise<void> {
  for (const table of tables) {
    await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  }
  await queryRunner.query(`
    DO $secure_master_data$
    DECLARE role_name TEXT;
    BEGIN
      FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE ${tables.join(', ')} FROM %I',
            role_name
          );
        END IF;
      END LOOP;
    END
    $secure_master_data$
  `);
}

/**
 * Adds the national catalogs that already have concrete attendance/student-care
 * consumers. Sensitive source integers are reconciled only when their mapping
 * is explicit; unknown positive values abort instead of being guessed.
 */
export class AddAttendanceAndStudentCareMasterData20260827280000 implements MigrationInterface {
  name = 'AddAttendanceAndStudentCareMasterData20260827280000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $prerequisites$
      BEGIN
        IF to_regclass('public.attendance_exceptions') IS NULL THEN
          RAISE EXCEPTION 'attendance_exceptions prerequisite is missing';
        END IF;
        IF to_regclass('public.student_term') IS NULL THEN
          RAISE EXCEPTION 'student_term prerequisite is missing';
        END IF;
      END
      $prerequisites$
    `);

    await queryRunner.query(`
      CREATE TABLE master_data_reconcile_backup_20260824 (
        entity_name TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        original_row JSONB NOT NULL,
        PRIMARY KEY (entity_name, entity_key)
      )
    `);
    await queryRunner.query(`
      INSERT INTO master_data_reconcile_backup_20260824 (entity_name, entity_key, original_row)
      SELECT 'student_status', code::text, to_jsonb(status)
      FROM student_status status
    `);
    await queryRunner.query(`
      INSERT INTO master_data_reconcile_backup_20260824 (entity_name, entity_key, original_row)
      SELECT 'student_status_category', code, to_jsonb(category)
      FROM student_status_categories category
    `);
    await queryRunner.query(`
      INSERT INTO master_data_reconcile_backup_20260824 (entity_name, entity_key, original_row)
      SELECT 'role_permission', name, jsonb_build_object('permissions', default_permissions)
      FROM roles WHERE name = 'ADMIN'
    `);
    await queryRunner.query(`
      INSERT INTO master_data_reconcile_backup_20260824 (entity_name, entity_key, original_row)
      SELECT 'user_permission', id::text, jsonb_build_object('permissions', permissions)
      FROM users
      WHERE role = 'ADMIN' AND data_scope->>'global' = 'true'
    `);

    await secureTables(queryRunner, ['master_data_reconcile_backup_20260824']);

    await queryRunner.query(`
      DO $student_status_contract$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM student_status
          WHERE (code = 10 AND category <> 'ACTIVE')
             OR (code = 20 AND category <> 'GRADUATED')
             OR (code = 30 AND category <> 'WITHDRAWN')
             OR (code = 40 AND category <> 'TRANSFERRED')
             OR (code = 50 AND category <> 'DECEASED')
             OR (code = 90 AND category <> 'UNMAPPED')
        ) THEN
          RAISE EXCEPTION 'student status source-key mapping contradicts the locked contract';
        END IF;
      END
      $student_status_contract$
    `);
    await queryRunner.query(`
      INSERT INTO student_status_categories (code, label_th, sort_order, is_active) VALUES
        ('STUDYING', 'กำลังศึกษา', 10, TRUE),
        ('SUSPENDED', 'พักการเรียน', 20, TRUE),
        ('GRADUATED', 'สำเร็จการศึกษา', 30, TRUE),
        ('TRANSFERRED', 'ย้ายสถานศึกษา', 40, TRUE),
        ('WITHDRAWN', 'ลาออก', 50, TRUE),
        ('DISCHARGED', 'พ้นสภาพ/จำหน่าย', 60, TRUE),
        ('DECEASED', 'เสียชีวิต', 70, TRUE),
        ('UNMATCHED', 'ยังไม่ได้จับคู่', 90, FALSE)
      ON CONFLICT (code) DO UPDATE SET
        label_th = EXCLUDED.label_th,
        sort_order = EXCLUDED.sort_order,
        is_active = EXCLUDED.is_active
    `);
    await queryRunner.query(`
      UPDATE student_status SET category = CASE category
        WHEN 'ACTIVE' THEN 'STUDYING'
        WHEN 'UNMAPPED' THEN 'UNMATCHED'
        ELSE category
      END
    `);
    await queryRunner.query(`
      UPDATE student_status SET
        label_th = CASE code
          WHEN 10 THEN 'กำลังศึกษา'
          WHEN 20 THEN 'สำเร็จการศึกษา'
          WHEN 30 THEN 'ลาออก'
          WHEN 40 THEN 'ย้ายสถานศึกษา'
          WHEN 50 THEN 'เสียชีวิต'
          WHEN 90 THEN 'ยังไม่ได้จับคู่'
          ELSE label_th
        END,
        category = CASE code
          WHEN 10 THEN 'STUDYING'
          WHEN 20 THEN 'GRADUATED'
          WHEN 30 THEN 'WITHDRAWN'
          WHEN 40 THEN 'TRANSFERRED'
          WHEN 50 THEN 'DECEASED'
          WHEN 90 THEN 'UNMATCHED'
          ELSE category
        END,
        source_system = CASE WHEN source_system = 'DEMO' THEN 'INTERNAL' ELSE source_system END,
        is_enabled = CASE WHEN code = 90 THEN FALSE ELSE is_enabled END
      WHERE code IN (10, 20, 30, 40, 50, 90)
    `);
    await queryRunner.query(`
      INSERT INTO student_status (
        code, label_th, category, badge_variant, is_active_for_login, is_terminal,
        requires_followup, is_enabled, sort_order, source_system
      ) VALUES
        (15, 'พักการเรียน', 'SUSPENDED', 'warning', FALSE, FALSE, TRUE, TRUE, 20, 'INTERNAL'),
        (35, 'พ้นสภาพ/จำหน่าย', 'DISCHARGED', 'secondary', FALSE, TRUE, TRUE, TRUE, 60, 'INTERNAL')
      ON CONFLICT (code) DO NOTHING
    `);
    await queryRunner.query(`
      DELETE FROM student_status_categories
      WHERE code IN ('ACTIVE', 'UNMAPPED')
    `);

    await queryRunner.query(`
      CREATE TABLE absence_reason_categories (
        code VARCHAR(40) PRIMARY KEY,
        label_th VARCHAR(200) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS},
        CONSTRAINT chk_absence_reason_categories_code CHECK (btrim(code) <> ''),
        CONSTRAINT chk_absence_reason_categories_label CHECK (btrim(label_th) <> ''),
        CONSTRAINT chk_absence_reason_categories_sort CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('absence_reason_categories'));
    await queryRunner.query(`
      INSERT INTO absence_reason_categories (code, label_th, sort_order) VALUES
        ('PERSONAL_FAMILY', 'สาเหตุส่วนตัว / ครอบครัว', 10),
        ('ECONOMIC', 'สาเหตุทางเศรษฐกิจ', 20),
        ('LEARNING_SCHOOL', 'สาเหตุทางการเรียน / โรงเรียน', 30),
        ('MENTAL_BEHAVIOR', 'สาเหตุทางจิตใจ / พฤติกรรม', 40),
        ('SOCIAL_ENVIRONMENT', 'สาเหตุทางสังคม / สิ่งแวดล้อม', 50)
    `);

    await queryRunner.query(`
      CREATE TABLE absence_reasons (
        code VARCHAR(40) PRIMARY KEY,
        category_code VARCHAR(40),
        label_th VARCHAR(200) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS},
        CONSTRAINT fk_absence_reasons_category FOREIGN KEY (category_code)
          REFERENCES absence_reason_categories(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_absence_reasons_code CHECK (btrim(code) <> ''),
        CONSTRAINT chk_absence_reasons_label CHECK (btrim(label_th) <> ''),
        CONSTRAINT chk_absence_reasons_sort CHECK (sort_order >= 0),
        CONSTRAINT chk_absence_reasons_unknown_category CHECK (
          (code = 'UNKNOWN' AND category_code IS NULL)
          OR (code <> 'UNKNOWN' AND category_code IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('absence_reasons'));
    await queryRunner.query(`
      INSERT INTO absence_reasons (code, category_code, label_th, sort_order) VALUES
        ('UNKNOWN', NULL, 'ยังไม่ทราบสาเหตุ', 0),
        ('MINOR_ILLNESS', 'PERSONAL_FAMILY', 'ป่วยไม่รุนแรง เช่น ไข้ ปวดหัว ท้องเสีย', 10),
        ('NO_CAREGIVER', 'PERSONAL_FAMILY', 'ไม่มีผู้ดูแล / ผู้ปกครองไม่ส่งมาเรียน', 20),
        ('FAMILY_PROBLEM', 'PERSONAL_FAMILY', 'ปัญหาครอบครัว เช่น ผู้ปกครองแยกทางหรือทะเลาะกัน', 30),
        ('PART_TIME_WORK', 'ECONOMIC', 'ต้องทำงานพิเศษหารายได้', 40),
        ('NO_LEARNING_EQUIPMENT', 'ECONOMIC', 'ไม่มีอุปกรณ์การเรียน / เครื่องแบบ', 50),
        ('AFRAID_OF_TEACHER', 'LEARNING_SCHOOL', 'ถูกครูตำหนิ / กลัวครู', 60),
        ('BULLIED', 'LEARNING_SCHOOL', 'ถูกเพื่อนกลั่นแกล้ง / บูลลี่', 70),
        ('SLEEP_LATE', 'MENTAL_BEHAVIOR', 'นอนดึก / ตื่นสาย', 80),
        ('EMOTIONAL_PROBLEM', 'MENTAL_BEHAVIOR', 'ปัญหาทางอารมณ์ เช่น เครียด ซึมเศร้า เบื่อหน่าย', 90),
        ('ADVERSE_WEATHER', 'SOCIAL_ENVIRONMENT', 'สภาพอากาศไม่เอื้ออำนวย เช่น ฝนตก น้ำท่วม', 100),
        ('UNAUTHORIZED_EXTERNAL_ACTIVITY', 'SOCIAL_ENVIRONMENT', 'เข้าร่วมกิจกรรมภายนอกโรงเรียนโดยไม่ได้รับอนุญาต', 110)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_absence_reasons_category_sort
      ON absence_reasons (category_code, sort_order, code)
    `);

    await queryRunner.query(`
      ALTER TABLE attendance_exceptions ADD COLUMN absence_reason_code VARCHAR(40)
    `);
    await queryRunner.query(`
      UPDATE attendance_exceptions
      SET absence_reason_code = 'UNKNOWN'
      WHERE attendance_status_code = 2
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_exceptions
        ADD CONSTRAINT fk_attendance_exceptions_absence_reason
          FOREIGN KEY (absence_reason_code) REFERENCES absence_reasons(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_attendance_exceptions_absence_reason CHECK (
          (attendance_status_code = 2 AND absence_reason_code IS NOT NULL)
          OR (attendance_status_code IN (3, 4) AND absence_reason_code IS NULL)
        )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_attendance_exceptions_absence_reason
      ON attendance_exceptions (absence_reason_code)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_attendance_exceptions_reason_session
      ON attendance_exceptions (absence_reason_code, session_id)
      WHERE attendance_status_code = 2
    `);

    for (const [table, label] of [
      ['disadvantage_types', 'disadvantage'],
      ['disability_types', 'disability'],
    ] as const) {
      await queryRunner.query(`
        CREATE TABLE ${table} (
          code VARCHAR(40) PRIMARY KEY,
          source_onec_code SMALLINT UNIQUE,
          label_th VARCHAR(200) NOT NULL,
          sort_order SMALLINT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          ${AUDIT_COLUMNS},
          CONSTRAINT chk_${label}_types_code CHECK (btrim(code) <> ''),
          CONSTRAINT chk_${label}_types_source CHECK (
            source_onec_code IS NULL OR source_onec_code > 0
          ),
          CONSTRAINT chk_${label}_types_label CHECK (btrim(label_th) <> ''),
          CONSTRAINT chk_${label}_types_sort CHECK (sort_order >= 0)
        )
      `);
      await queryRunner.query(auditUpdatedAtTriggerSql(table));
    }

    await queryRunner.query(`
      INSERT INTO disadvantage_types (code, source_onec_code, label_th, sort_order) VALUES
        ('FORCED_LABOR', 1, 'เด็กถูกบังคับให้ขายแรงงาน', 10),
        ('SEXUAL_EXPLOITATION', 2, 'เด็กที่อยู่ในธุรกิจทางเพศ', 20),
        ('ABANDONED', 3, 'เด็กถูกทอดทิ้ง', 30),
        ('JUVENILE_JUSTICE', 4, 'เด็กในสถานพินิจและคุ้มครองเด็กและเยาวชน', 40),
        ('HOMELESS', 5, 'เด็กเร่ร่อน', 50),
        ('HIV_AFFECTED', 6, 'ผลกระทบจากเอดส์', 60),
        ('ETHNIC_MINORITY', 7, 'ชนกลุ่มน้อย', 70),
        ('ABUSED', 8, 'เด็กที่ถูกทำร้ายทารุณ', 80),
        ('POVERTY', 9, 'เด็กยากจน', 90),
        ('SUBSTANCE_ABUSE', 10, 'เด็กมีปัญหาเกี่ยวกับยาเสพติด', 100),
        ('NONE', 99, 'ไม่ด้อยโอกาส', 990)
    `);
    await queryRunner.query(`
      INSERT INTO disability_types (code, source_onec_code, label_th, sort_order) VALUES
        ('VISUAL', 1, 'ความพิการทางการมองเห็น', 10),
        ('HEARING', 2, 'ความพิการทางการได้ยิน', 20),
        ('INTELLECTUAL', 3, 'ความพิการทางสติปัญญา', 30),
        ('PHYSICAL_HEALTH', 4, 'ความพิการทางร่างกาย/สุขภาพ', 40),
        ('LEARNING', 5, 'ความพิการทางการเรียนรู้', 50),
        ('SPEECH_LANGUAGE', 6, 'ความพิการทางการพูด/ภาษา', 60),
        ('BEHAVIOR_EMOTION', 7, 'ความพิการทางพฤติกรรมและอารมณ์', 70),
        ('AUTISM', 8, 'ความพิการทางออทิสติก', 80),
        ('MULTIPLE', 9, 'ความพิการซ้อน', 90),
        ('NONE', 99, 'ไม่มีความพิการ', 990)
    `);

    await queryRunner.query(`
      DO $legacy_welfare_contract$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM student_term enrollment
          LEFT JOIN disadvantage_types option
            ON option.source_onec_code = enrollment."DisadvantageEducationID_Onec"
          WHERE COALESCE(enrollment."DisadvantageEducationID_Onec", 0) > 0
            AND option.code IS NULL
        ) THEN
          RAISE EXCEPTION 'unknown positive DisadvantageEducationID_Onec cannot be inferred';
        END IF;
        IF EXISTS (
          SELECT 1 FROM student_term enrollment
          LEFT JOIN disability_types option
            ON option.source_onec_code = enrollment."DisabilityID_Onec"
          WHERE COALESCE(enrollment."DisabilityID_Onec", 0) > 0
            AND option.code IS NULL
        ) THEN
          RAISE EXCEPTION 'unknown positive DisabilityID_Onec cannot be inferred';
        END IF;
      END
      $legacy_welfare_contract$
    `);

    await queryRunner.query(`
      CREATE TABLE student_term_disadvantages (
        student_uuid UUID NOT NULL,
        disadvantage_type_code VARCHAR(40) NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        recorded_by_user_id INTEGER,
        PRIMARY KEY (student_uuid, disadvantage_type_code),
        CONSTRAINT fk_student_term_disadvantages_student FOREIGN KEY (student_uuid)
          REFERENCES student_term(student_uuid) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_term_disadvantages_type FOREIGN KEY (disadvantage_type_code)
          REFERENCES disadvantage_types(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_term_disadvantages_user FOREIGN KEY (recorded_by_user_id)
          REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_student_term_disadvantages_type
      ON student_term_disadvantages (disadvantage_type_code, student_uuid)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_student_term_disadvantages_recorder
      ON student_term_disadvantages (recorded_by_user_id)
      WHERE recorded_by_user_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE student_disabilities (
        student_uuid UUID NOT NULL,
        disability_type_code VARCHAR(40) NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        recorded_by_user_id INTEGER,
        PRIMARY KEY (student_uuid, disability_type_code),
        CONSTRAINT fk_student_disabilities_student FOREIGN KEY (student_uuid)
          REFERENCES student_term(student_uuid) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_disabilities_type FOREIGN KEY (disability_type_code)
          REFERENCES disability_types(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_disabilities_user FOREIGN KEY (recorded_by_user_id)
          REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_student_disabilities_type
      ON student_disabilities (disability_type_code, student_uuid)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_student_disabilities_recorder
      ON student_disabilities (recorded_by_user_id)
      WHERE recorded_by_user_id IS NOT NULL
    `);
    await queryRunner.query(`
      INSERT INTO master_data_reconcile_backup_20260824 (entity_name, entity_key, original_row)
      SELECT 'student_term_disadvantage', enrollment.student_uuid::text || ':' || option.code,
        jsonb_build_object('source_onec_code', option.source_onec_code)
      FROM student_term enrollment
      JOIN disadvantage_types option
        ON option.source_onec_code = enrollment."DisadvantageEducationID_Onec"
      WHERE enrollment."DisadvantageEducationID_Onec" > 0 AND option.code <> 'NONE'
    `);
    await queryRunner.query(`
      INSERT INTO master_data_reconcile_backup_20260824 (entity_name, entity_key, original_row)
      SELECT 'student_disability', enrollment.student_uuid::text || ':' || option.code,
        jsonb_build_object('source_onec_code', option.source_onec_code)
      FROM student_term enrollment
      JOIN disability_types option ON option.source_onec_code = enrollment."DisabilityID_Onec"
      WHERE enrollment."DisabilityID_Onec" > 0 AND option.code <> 'NONE'
    `);
    await queryRunner.query(`
      INSERT INTO student_term_disadvantages (student_uuid, disadvantage_type_code)
      SELECT enrollment.student_uuid, option.code
      FROM student_term enrollment
      JOIN disadvantage_types option
        ON option.source_onec_code = enrollment."DisadvantageEducationID_Onec"
      WHERE enrollment."DisadvantageEducationID_Onec" > 0 AND option.code <> 'NONE'
    `);
    await queryRunner.query(`
      INSERT INTO student_disabilities (student_uuid, disability_type_code)
      SELECT enrollment.student_uuid, option.code
      FROM student_term enrollment
      JOIN disability_types option ON option.source_onec_code = enrollment."DisabilityID_Onec"
      WHERE enrollment."DisabilityID_Onec" > 0 AND option.code <> 'NONE'
    `);

    await secureTables(queryRunner, [
      ...CATALOG_TABLES,
      'student_term_disadvantages',
      'student_disabilities',
    ]);

    await queryRunner.query(`
      INSERT INTO assistance_measure_options (code, label_th, sort_order, requires_detail)
      VALUES
        ('HOUSING_MEALS', 'จัดที่พัก/อาหารกลางวัน', 25, FALSE),
        ('INDIVIDUAL_LEARNING_PLAN', 'จัดแผนการเรียนเฉพาะบุคคล', 35, FALSE)
      ON CONFLICT (code) DO UPDATE SET
        label_th = EXCLUDED.label_th,
        sort_order = EXCLUDED.sort_order,
        requires_detail = EXCLUDED.requires_detail,
        is_active = TRUE,
        deleted_at = NULL
    `);

    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = default_permissions || '["master-data"]'::jsonb
      WHERE name = 'ADMIN'
        AND NOT (COALESCE(default_permissions, '[]'::jsonb) ? 'master-data')
    `);
    await queryRunner.query(`
      UPDATE users
      SET permissions = permissions || '["master-data"]'::jsonb
      WHERE role = 'ADMIN'
        AND data_scope->>'global' = 'true'
        AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'master-data')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $rollback_guard$
      BEGIN
        IF EXISTS (
             SELECT 1 FROM student_term_disadvantages relation
             LEFT JOIN master_data_reconcile_backup_20260824 backup
               ON backup.entity_name = 'student_term_disadvantage'
              AND backup.entity_key = relation.student_uuid::text || ':' || relation.disadvantage_type_code
             WHERE backup.entity_key IS NULL
           )
           OR EXISTS (
             SELECT 1 FROM student_disabilities relation
             LEFT JOIN master_data_reconcile_backup_20260824 backup
               ON backup.entity_name = 'student_disability'
              AND backup.entity_key = relation.student_uuid::text || ':' || relation.disability_type_code
             WHERE backup.entity_key IS NULL
           )
           OR EXISTS (
             SELECT 1 FROM attendance_exceptions
             WHERE absence_reason_code IS NOT NULL AND absence_reason_code <> 'UNKNOWN'
           )
           OR EXISTS (
             SELECT 1 FROM student_status status
             LEFT JOIN master_data_reconcile_backup_20260824 backup
               ON backup.entity_name = 'student_status' AND backup.entity_key = status.code::text
             WHERE backup.entity_key IS NULL AND status.code NOT IN (15, 35)
           )
        THEN
          RAISE EXCEPTION 'refusing rollback: post-migration master-data usage would be lost';
        END IF;
      END
      $rollback_guard$
    `);

    await queryRunner.query(`
      UPDATE roles target SET default_permissions = backup.original_row->'permissions'
      FROM master_data_reconcile_backup_20260824 backup
      WHERE backup.entity_name = 'role_permission' AND backup.entity_key = target.name
    `);
    await queryRunner.query(`
      UPDATE users target SET permissions = backup.original_row->'permissions'
      FROM master_data_reconcile_backup_20260824 backup
      WHERE backup.entity_name = 'user_permission' AND backup.entity_key = target.id::text
    `);
    await queryRunner.query(`
      DELETE FROM assistance_measure_options
      WHERE code IN ('HOUSING_MEALS', 'INDIVIDUAL_LEARNING_PLAN')
        AND NOT EXISTS (
          SELECT 1 FROM task_assistance_measures link
          WHERE link.assistance_measure_code = assistance_measure_options.code
        )
    `);

    await queryRunner.query(`DROP TABLE student_disabilities`);
    await queryRunner.query(`DROP TABLE student_term_disadvantages`);
    await queryRunner.query(`DROP INDEX idx_attendance_exceptions_reason_session`);
    await queryRunner.query(`DROP INDEX idx_attendance_exceptions_absence_reason`);
    await queryRunner.query(`
      ALTER TABLE attendance_exceptions
        DROP CONSTRAINT chk_attendance_exceptions_absence_reason,
        DROP CONSTRAINT fk_attendance_exceptions_absence_reason,
        DROP COLUMN absence_reason_code
    `);
    await queryRunner.query(`DROP TABLE disability_types`);
    await queryRunner.query(`DROP TABLE disadvantage_types`);
    await queryRunner.query(`DROP TABLE absence_reasons`);
    await queryRunner.query(`DROP TABLE absence_reason_categories`);

    await queryRunner.query(`DELETE FROM student_status WHERE code IN (15, 35)`);
    await queryRunner.query(`
      INSERT INTO student_status_categories (code, label_th, sort_order, is_active)
      SELECT
        original_row->>'code',
        original_row->>'label_th',
        (original_row->>'sort_order')::smallint,
        (original_row->>'is_active')::boolean
      FROM master_data_reconcile_backup_20260824
      WHERE entity_name = 'student_status_category'
      ON CONFLICT (code) DO UPDATE SET
        label_th = EXCLUDED.label_th,
        sort_order = EXCLUDED.sort_order,
        is_active = EXCLUDED.is_active
    `);
    await queryRunner.query(`
      UPDATE student_status target SET
        label_th = backup.original_row->>'label_th',
        category = backup.original_row->>'category',
        badge_variant = backup.original_row->>'badge_variant',
        is_active_for_login = (backup.original_row->>'is_active_for_login')::boolean,
        is_terminal = (backup.original_row->>'is_terminal')::boolean,
        requires_followup = (backup.original_row->>'requires_followup')::boolean,
        is_enabled = (backup.original_row->>'is_enabled')::boolean,
        sort_order = (backup.original_row->>'sort_order')::smallint,
        source_system = backup.original_row->>'source_system'
      FROM master_data_reconcile_backup_20260824 backup
      WHERE backup.entity_name = 'student_status'
        AND backup.entity_key = target.code::text
    `);
    await queryRunner.query(`
      DELETE FROM student_status_categories
      WHERE code IN ('STUDYING', 'SUSPENDED', 'DISCHARGED', 'UNMATCHED')
    `);
    await queryRunner.query(`DROP TABLE master_data_reconcile_backup_20260824`);
  }
}
