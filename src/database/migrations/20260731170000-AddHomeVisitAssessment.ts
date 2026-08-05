import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHomeVisitAssessment20260731170000 implements MigrationInterface {
  name = 'AddHomeVisitAssessment20260731170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE home_visit_assessment_options (
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
        CONSTRAINT chk_home_visit_assessment_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_home_visit_assessment_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      INSERT INTO home_visit_assessment_options (code, label_th, sort_order)
      VALUES
        ('NO_CONCERN', 'ไม่พบปัญหาเพิ่มเติม', 10),
        ('CONTINUE_FOLLOW_UP', 'ควรติดตามต่อ', 20),
        ('URGENT_SUPPORT', 'ต้องช่วยเหลือเร่งด่วน', 30),
        ('REFER_SUPPORT', 'ควรส่งต่อหน่วยงานหรือผู้เชี่ยวชาญ', 40)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_home_visit_assessment_options_set_updated_at
      BEFORE UPDATE ON home_visit_assessment_options
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        ADD COLUMN follow_up_assessment_code VARCHAR(40),
        ADD CONSTRAINT fk_task_submissions_follow_up_assessment
          FOREIGN KEY (follow_up_assessment_code)
          REFERENCES home_visit_assessment_options(code)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT IF EXISTS fk_task_submissions_follow_up_assessment,
        DROP COLUMN IF EXISTS follow_up_assessment_code
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS home_visit_assessment_options`);
  }
}
