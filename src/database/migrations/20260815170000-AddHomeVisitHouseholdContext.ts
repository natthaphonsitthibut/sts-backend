import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Home-visit step 2 now records the household context the visitor observes:
 * the parents' status, who actually raises the student, and what surrounds the
 * home. Each answer set is a lookup table (not a free-text column and not a
 * hardcoded enum) so the ministry wording can change without a deploy, and the
 * residence environment is a many-to-many because one home can sit next to a
 * drug spot AND have a violence risk at the same time.
 */
export class AddHomeVisitHouseholdContext20260815170000 implements MigrationInterface {
  name = 'AddHomeVisitHouseholdContext20260815170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE parental_status_options (
        code VARCHAR(40) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_parental_status_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_parental_status_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      INSERT INTO parental_status_options (code, label_th, sort_order)
      VALUES
        ('LIVING_TOGETHER', 'อยู่ด้วยกัน', 10),
        ('LIVING_APART', 'แยกกันอยู่', 20),
        ('DIVORCED', 'หย่าร้าง', 30),
        ('FATHER_DECEASED', 'บิดาเสียชีวิต', 40),
        ('MOTHER_DECEASED', 'มารดาเสียชีวิต', 50),
        ('BOTH_DECEASED', 'บิดาและมารดาเสียชีวิต', 60),
        ('UNKNOWN', 'ไม่ทราบข้อมูล', 70)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_parental_status_options_set_updated_at
      BEFORE UPDATE ON parental_status_options
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`
      CREATE TABLE guardian_type_options (
        code VARCHAR(40) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        sort_order SMALLINT NOT NULL,
        requires_detail BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_guardian_type_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_guardian_type_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      INSERT INTO guardian_type_options (code, label_th, sort_order, requires_detail)
      VALUES
        ('FATHER', 'บิดา', 10, FALSE),
        ('MOTHER', 'มารดา', 20, FALSE),
        ('FATHER_AND_MOTHER', 'บิดาและมารดา', 30, FALSE),
        ('PATERNAL_GRANDPARENT', 'ปู่ / ย่า', 40, FALSE),
        ('MATERNAL_GRANDPARENT', 'ตา / ยาย', 50, FALSE),
        ('SIBLING', 'พี่ / น้อง', 60, FALSE),
        ('RELATIVE', 'ญาติ', 70, FALSE),
        ('OTHER', 'อื่น ๆ (ระบุในช่อง)', 80, TRUE),
        ('NO_GUARDIAN', 'ไม่มีผู้ปกครอง', 90, FALSE)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_guardian_type_options_set_updated_at
      BEFORE UPDATE ON guardian_type_options
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`
      CREATE TABLE residence_environment_options (
        code VARCHAR(40) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_exclusive BOOLEAN NOT NULL DEFAULT FALSE,
        requires_detail BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_residence_environment_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_residence_environment_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      INSERT INTO residence_environment_options
        (code, label_th, sort_order, is_exclusive, requires_detail)
      VALUES
        ('NORMAL', 'ปกติ / ไม่มีปัจจัยเสี่ยง', 10, TRUE, FALSE),
        ('NEAR_DRUG_AREA', 'อยู่ใกล้แหล่งสารเสพติด', 20, FALSE, FALSE),
        ('NEAR_GATHERING_AREA', 'อยู่ใกล้แหล่งมั่วสุม', 30, FALSE, FALSE),
        ('VIOLENCE_RISK', 'มีความเสี่ยงด้านความรุนแรง', 40, FALSE, FALSE),
        ('AREA_CRIME', 'มีปัญหาอาชญากรรมในพื้นที่', 50, FALSE, FALSE),
        ('OTHER', 'อื่น ๆ (ระบุในรายละเอียด)', 60, FALSE, TRUE)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_residence_environment_options_set_updated_at
      BEFORE UPDATE ON residence_environment_options
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`
      ALTER TABLE task_submissions
        ADD COLUMN parental_status_code VARCHAR(40),
        ADD COLUMN guardian_type_code VARCHAR(40),
        ADD COLUMN guardian_type_detail VARCHAR(200),
        ADD COLUMN residence_environment_detail TEXT,
        ADD CONSTRAINT fk_task_submissions_parental_status
          FOREIGN KEY (parental_status_code)
          REFERENCES parental_status_options(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT fk_task_submissions_guardian_type
          FOREIGN KEY (guardian_type_code)
          REFERENCES guardian_type_options(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_task_submissions_guardian_type_detail CHECK (
          guardian_type_detail IS NULL
          OR (guardian_type_code IS NOT NULL AND length(btrim(guardian_type_detail)) > 0)
        ),
        ADD CONSTRAINT chk_task_submissions_residence_environment_detail CHECK (
          residence_environment_detail IS NULL
          OR (
            length(btrim(residence_environment_detail)) > 0
            AND length(residence_environment_detail) <= 2000
          )
        )
    `);

    await queryRunner.query(`
      CREATE TABLE task_submission_residence_environments (
        task_submission_id INTEGER NOT NULL
          REFERENCES task_submissions(id) ON DELETE CASCADE ON UPDATE CASCADE,
        residence_environment_code VARCHAR(40) NOT NULL
          REFERENCES residence_environment_options(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        PRIMARY KEY (task_submission_id, residence_environment_code)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_task_submission_residence_environments_code
        ON task_submission_residence_environments (residence_environment_code)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS task_submission_residence_environments`);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT IF EXISTS chk_task_submissions_residence_environment_detail,
        DROP CONSTRAINT IF EXISTS chk_task_submissions_guardian_type_detail,
        DROP CONSTRAINT IF EXISTS fk_task_submissions_guardian_type,
        DROP CONSTRAINT IF EXISTS fk_task_submissions_parental_status,
        DROP COLUMN IF EXISTS residence_environment_detail,
        DROP COLUMN IF EXISTS guardian_type_detail,
        DROP COLUMN IF EXISTS guardian_type_code,
        DROP COLUMN IF EXISTS parental_status_code
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS residence_environment_options`);
    await queryRunner.query(`DROP TABLE IF EXISTS guardian_type_options`);
    await queryRunner.query(`DROP TABLE IF EXISTS parental_status_options`);
  }
}
