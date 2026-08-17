import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives teacher comments and follow-up submissions independent normalized
 * category catalogs. They intentionally start with the same values but do not
 * share an FK or source of truth, because either workflow may diverge later.
 * Category labels and parenthetical guidance are separate database fields.
 *
 * Owner-approved data normalization:
 * - existing classroom comment descriptions are preserved and assigned a new
 *   category from their stored text; ambiguous text becomes `OTHER`;
 * - old follow-up result values are cleared;
 * - legacy cause categories are mapped into the new catalog (`FAMILY` and any
 *   unknown value become `OTHER`) without deleting their cases/submissions.
 *
 * `down` restores the former comment schema without deleting its descriptions,
 * but cannot restore cleared follow-up result values.
 * Take a database backup before applying in production.
 */
export class AddStudentProblemCategories20260825180000 implements MigrationInterface {
  name = 'AddStudentProblemCategories20260825180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE classroom_student_problem_categories (
        code VARCHAR(32) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        guidance_th VARCHAR(200),
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_classroom_student_problem_categories_code
          CHECK (code = UPPER(BTRIM(code)) AND CHAR_LENGTH(code) BETWEEN 1 AND 32),
        CONSTRAINT chk_classroom_student_problem_categories_label
          CHECK (label_th = BTRIM(label_th) AND CHAR_LENGTH(label_th) BETWEEN 1 AND 120),
        CONSTRAINT chk_classroom_student_problem_categories_guidance
          CHECK (
            guidance_th IS NULL OR (
              guidance_th = BTRIM(guidance_th)
              AND CHAR_LENGTH(guidance_th) BETWEEN 1 AND 200
            )
          ),
        CONSTRAINT chk_classroom_student_problem_categories_sort_order
          CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_classroom_student_problem_categories_set_updated_at
      BEFORE UPDATE ON classroom_student_problem_categories
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
    await queryRunner.query(`
      INSERT INTO classroom_student_problem_categories (
        code, label_th, guidance_th, sort_order
      ) VALUES
        ('HEALTH', 'ปัญหาด้านสุขภาพ', 'เช่น เจ็บป่วย, ได้รับบาดเจ็บ', 10),
        ('SOCIAL_INTEGRATION', 'ปัญหาด้านการเข้าสังคม', 'เช่น ถูกเพื่อนกลั่นแกล้ง', 20),
        ('ACADEMIC', 'ปัญหาด้านการเรียน', 'เช่น หมดไฟ, เรียนไม่ทัน', 30),
        ('EMOTIONAL', 'ปัญหาด้านอารมณ์', 'เช่น เบื่อหน่าย, เครียด, ซึมเศร้า', 40),
        ('FINANCIAL', 'ปัญหาด้านการเงิน', 'เช่น ไม่มีอุปกรณ์การเรียน/เครื่องแบบ', 50),
        ('OTHER', 'อื่น ๆ', 'ระบุในคำอธิบาย', 60)
    `);
    await queryRunner.query(`
      CREATE TABLE follow_up_problem_categories (
        code VARCHAR(32) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        guidance_th VARCHAR(200),
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_follow_up_problem_categories_code
          CHECK (code = UPPER(BTRIM(code)) AND CHAR_LENGTH(code) BETWEEN 1 AND 32),
        CONSTRAINT chk_follow_up_problem_categories_label
          CHECK (label_th = BTRIM(label_th) AND CHAR_LENGTH(label_th) BETWEEN 1 AND 120),
        CONSTRAINT chk_follow_up_problem_categories_guidance
          CHECK (
            guidance_th IS NULL OR (
              guidance_th = BTRIM(guidance_th)
              AND CHAR_LENGTH(guidance_th) BETWEEN 1 AND 200
            )
          ),
        CONSTRAINT chk_follow_up_problem_categories_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_follow_up_problem_categories_set_updated_at
      BEFORE UPDATE ON follow_up_problem_categories
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
    await queryRunner.query(`
      INSERT INTO follow_up_problem_categories (
        code, label_th, guidance_th, sort_order
      ) VALUES
        ('HEALTH', 'ปัญหาด้านสุขภาพ', 'เช่น เจ็บป่วย, ได้รับบาดเจ็บ', 10),
        ('SOCIAL_INTEGRATION', 'ปัญหาด้านการเข้าสังคม', 'เช่น ถูกเพื่อนกลั่นแกล้ง', 20),
        ('ACADEMIC', 'ปัญหาด้านการเรียน', 'เช่น หมดไฟ, เรียนไม่ทัน', 30),
        ('EMOTIONAL', 'ปัญหาด้านอารมณ์', 'เช่น เบื่อหน่าย, เครียด, ซึมเศร้า', 40),
        ('FINANCIAL', 'ปัญหาด้านการเงิน', 'เช่น ไม่มีอุปกรณ์การเรียน/เครื่องแบบ', 50),
        ('OTHER', 'อื่น ๆ', 'ระบุในคำอธิบาย', 60)
    `);

    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        DROP CONSTRAINT chk_classroom_student_comments_text
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        RENAME COLUMN comment_text TO problem_description
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        ADD COLUMN problem_category_code VARCHAR(32)
    `);
    await queryRunner.query(`
      UPDATE classroom_student_comments
      SET problem_category_code = CASE
        WHEN problem_description ~* '(เจ็บ|ป่วย|บาดเจ็บ|สุขภาพ|โรค)' THEN 'HEALTH'
        WHEN problem_description ~* '(อุปกรณ์|เครื่องแบบ|รองเท้า|ค่าใช้จ่าย|การเงิน|เงิน)' THEN 'FINANCIAL'
        WHEN problem_description ~* '(เรียน|การบ้าน|คะแนน|วิชา|ส่งงาน|หมดไฟ)' THEN 'ACADEMIC'
        WHEN problem_description ~* '(เพื่อน|กลั่นแกล้ง|เข้าสังคม|กิจกรรมกลุ่ม)' THEN 'SOCIAL_INTEGRATION'
        WHEN problem_description ~* '(เครียด|ซึมเศร้า|เบื่อ|อารมณ์|เงียบ|พฤติกรรม)' THEN 'EMOTIONAL'
        ELSE 'OTHER'
      END
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        ALTER COLUMN problem_category_code SET NOT NULL,
        ADD CONSTRAINT fk_classroom_student_comments_problem_category
          FOREIGN KEY (problem_category_code)
          REFERENCES classroom_student_problem_categories(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_classroom_student_comments_description
          CHECK (
            problem_description = BTRIM(problem_description)
            AND CHAR_LENGTH(problem_description) BETWEEN 1 AND 2000
          )
    `);

    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT IF EXISTS fk_task_submissions_follow_up_assessment
    `);
    await queryRunner.query(`UPDATE task_submissions SET follow_up_assessment_code = NULL`);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        RENAME COLUMN follow_up_assessment_code TO follow_up_problem_category_code
    `);
    await queryRunner.query(`
      UPDATE task_submissions
      SET follow_up_problem_category_code = CASE UPPER(BTRIM(cause_category))
        WHEN 'HEALTH' THEN 'HEALTH'
        WHEN 'ECONOMIC' THEN 'FINANCIAL'
        WHEN 'MIGRATION' THEN 'SOCIAL_INTEGRATION'
        WHEN 'DISABILITY' THEN 'HEALTH'
        WHEN 'BEHAVIOR' THEN 'EMOTIONAL'
        WHEN 'ACADEMIC' THEN 'ACADEMIC'
        WHEN 'FINANCIAL' THEN 'FINANCIAL'
        WHEN 'SOCIAL_INTEGRATION' THEN 'SOCIAL_INTEGRATION'
        WHEN 'EMOTIONAL' THEN 'EMOTIONAL'
        ELSE 'OTHER'
      END
      WHERE cause_category IS NOT NULL AND BTRIM(cause_category) <> ''
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        ALTER COLUMN follow_up_problem_category_code TYPE VARCHAR(32),
        ADD CONSTRAINT fk_task_submissions_follow_up_problem_category
          FOREIGN KEY (follow_up_problem_category_code)
          REFERENCES follow_up_problem_categories(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        DROP COLUMN cause_category
    `);
    await queryRunner.query(`DROP TABLE follow_up_result_options`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE follow_up_result_options (
        code VARCHAR(40) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT chk_home_visit_assessment_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_home_visit_assessment_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_home_visit_assessment_options_set_updated_at
      BEFORE UPDATE ON follow_up_result_options
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
    await queryRunner.query(`
      INSERT INTO follow_up_result_options (code, label_th, sort_order)
      VALUES
        ('NO_CONCERN', 'ไม่พบปัญหาเพิ่มเติม', 10),
        ('CONTINUE_FOLLOW_UP', 'ควรติดตามต่อ', 20),
        ('URGENT_SUPPORT', 'ต้องช่วยเหลือเร่งด่วน', 30),
        ('REFER_SUPPORT', 'ควรส่งต่อหน่วยงานหรือผู้เชี่ยวชาญ', 40)
    `);

    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT fk_task_submissions_follow_up_problem_category,
        ADD COLUMN cause_category TEXT
    `);
    await queryRunner.query(`
      UPDATE task_submissions
      SET cause_category = follow_up_problem_category_code,
          follow_up_problem_category_code = NULL
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        RENAME COLUMN follow_up_problem_category_code TO follow_up_assessment_code
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        ALTER COLUMN follow_up_assessment_code TYPE VARCHAR(40),
        ADD CONSTRAINT fk_task_submissions_follow_up_assessment
          FOREIGN KEY (follow_up_assessment_code)
          REFERENCES follow_up_result_options(code)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        DROP CONSTRAINT fk_classroom_student_comments_problem_category,
        DROP CONSTRAINT chk_classroom_student_comments_description,
        DROP COLUMN problem_category_code
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        RENAME COLUMN problem_description TO comment_text
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        ADD CONSTRAINT chk_classroom_student_comments_text
          CHECK (
            comment_text = BTRIM(comment_text)
            AND CHAR_LENGTH(comment_text) BETWEEN 1 AND 2000
          )
    `);
    await queryRunner.query(`DROP TABLE follow_up_problem_categories`);
    await queryRunner.query(`DROP TABLE classroom_student_problem_categories`);
  }
}
