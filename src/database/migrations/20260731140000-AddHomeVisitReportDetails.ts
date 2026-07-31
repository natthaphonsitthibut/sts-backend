import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHomeVisitReportDetails20260731140000 implements MigrationInterface {
  name = 'AddHomeVisitReportDetails20260731140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE home_visit_exception_options (
        code VARCHAR(40) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        requires_updated_address BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_home_visit_exception_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_home_visit_exception_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      INSERT INTO home_visit_exception_options (
        code, label_th, requires_updated_address, sort_order
      ) VALUES
        ('ADDRESS_CHANGED', 'เปลี่ยนที่อยู่', TRUE, 10),
        ('STUDENT_NOT_FOUND', 'ไม่พบนักเรียน', FALSE, 20)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_home_visit_exception_options_set_updated_at
      BEFORE UPDATE ON home_visit_exception_options
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        ADD COLUMN visited_at TIMESTAMPTZ,
        ADD COLUMN home_visit_exception_code VARCHAR(40),
        ADD COLUMN updated_address_line TEXT,
        ADD COLUMN updated_address_province TEXT,
        ADD COLUMN updated_address_district TEXT,
        ADD COLUMN updated_address_sub_district TEXT,
        ADD COLUMN updated_postal_code VARCHAR(5)
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        ADD CONSTRAINT fk_task_submissions_home_visit_exception
          FOREIGN KEY (home_visit_exception_code)
          REFERENCES home_visit_exception_options(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_task_submissions_updated_postal_code
          CHECK (
            updated_postal_code IS NULL
            OR updated_postal_code ~ '^[0-9]{5}$'
          ),
        ADD CONSTRAINT chk_task_submissions_home_visit_address
          CHECK (
            home_visit_exception_code <> 'ADDRESS_CHANGED'
            OR (
              address_changed = TRUE
              AND updated_address_line IS NOT NULL
              AND length(btrim(updated_address_line)) > 0
              AND updated_address_province IS NOT NULL
              AND length(btrim(updated_address_province)) > 0
              AND updated_address_district IS NOT NULL
              AND length(btrim(updated_address_district)) > 0
              AND updated_address_sub_district IS NOT NULL
              AND length(btrim(updated_address_sub_district)) > 0
              AND updated_postal_code IS NOT NULL
            )
          )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT IF EXISTS chk_task_submissions_home_visit_address,
        DROP CONSTRAINT IF EXISTS chk_task_submissions_updated_postal_code,
        DROP CONSTRAINT IF EXISTS fk_task_submissions_home_visit_exception
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP COLUMN IF EXISTS updated_postal_code,
        DROP COLUMN IF EXISTS updated_address_sub_district,
        DROP COLUMN IF EXISTS updated_address_district,
        DROP COLUMN IF EXISTS updated_address_province,
        DROP COLUMN IF EXISTS updated_address_line,
        DROP COLUMN IF EXISTS home_visit_exception_code,
        DROP COLUMN IF EXISTS visited_at
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS home_visit_exception_options`);
  }
}
