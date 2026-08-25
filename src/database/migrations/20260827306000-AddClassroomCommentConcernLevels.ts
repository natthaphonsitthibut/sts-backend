import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const SHARED_CATEGORY_ROWS = `
  ('ATTENDANCE', 'การมาเรียน', 'เช่น ขาดเรียน มาสาย หรือมาเรียนไม่สม่ำเสมอ', 70),
  ('FAMILY_CARE', 'ครอบครัวและการดูแล', 'เช่น ผู้ดูแลหรือสภาพแวดล้อมในครอบครัว', 80),
  ('SAFETY', 'ความปลอดภัย', 'เช่น ความเสี่ยงต่อการถูกทำร้ายหรืออุบัติเหตุ', 90)
`;

/**
 * Adds an explicit severity to teacher comments without coupling their category
 * catalog to follow-up submissions. Legacy comments become NOTE; no text is
 * interpreted to guess risk.
 */
export class AddClassroomCommentConcernLevels20260827306000 implements MigrationInterface {
  name = 'AddClassroomCommentConcernLevels20260827306000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $prerequisites$
      BEGIN
        IF to_regclass('public.classroom_student_comments') IS NULL
           OR to_regclass('public.classroom_student_problem_categories') IS NULL
           OR to_regclass('public.follow_up_problem_categories') IS NULL THEN
          RAISE EXCEPTION 'teacher-comment category prerequisites are missing';
        END IF;
      END
      $prerequisites$
    `);

    for (const table of ['classroom_student_problem_categories', 'follow_up_problem_categories']) {
      await queryRunner.query(`
        INSERT INTO ${table} (code, label_th, guidance_th, sort_order)
        VALUES ${SHARED_CATEGORY_ROWS}
        ON CONFLICT (code) DO UPDATE SET
          label_th = EXCLUDED.label_th,
          guidance_th = EXCLUDED.guidance_th,
          sort_order = EXCLUDED.sort_order,
          is_active = TRUE,
          updated_at = now()
      `);
    }

    await queryRunner.query(`
      DO $aligned_core$
      DECLARE mismatch_count INTEGER;
      BEGIN
        SELECT COUNT(*)::int INTO mismatch_count
        FROM (
          VALUES
            ('HEALTH'), ('SOCIAL_INTEGRATION'), ('ACADEMIC'),
            ('EMOTIONAL'), ('FINANCIAL'), ('OTHER'),
            ('ATTENDANCE'), ('FAMILY_CARE'), ('SAFETY')
        ) expected(code)
        LEFT JOIN classroom_student_problem_categories comment_category
          ON comment_category.code = expected.code
        LEFT JOIN follow_up_problem_categories follow_up_category
          ON follow_up_category.code = expected.code
        WHERE comment_category.code IS NULL
           OR follow_up_category.code IS NULL
           OR comment_category.label_th <> follow_up_category.label_th;

        IF mismatch_count <> 0 THEN
          RAISE EXCEPTION 'teacher-comment and follow-up shared core categories are not aligned';
        END IF;
      END
      $aligned_core$
    `);

    await queryRunner.query(`
      CREATE TABLE classroom_student_comment_concern_levels (
        code VARCHAR(16) PRIMARY KEY,
        label_th VARCHAR(80) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_classroom_student_comment_concern_levels_code CHECK (
          code = UPPER(BTRIM(code)) AND CHAR_LENGTH(code) BETWEEN 1 AND 16
        ),
        CONSTRAINT chk_classroom_student_comment_concern_levels_label CHECK (
          label_th = BTRIM(label_th) AND CHAR_LENGTH(label_th) BETWEEN 1 AND 80
        ),
        CONSTRAINT chk_classroom_student_comment_concern_levels_sort CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('classroom_student_comment_concern_levels'));
    await queryRunner.query(`
      INSERT INTO classroom_student_comment_concern_levels (
        code, label_th, sort_order
      ) VALUES
        ('NOTE', 'บันทึกทั่วไป', 10),
        ('WATCH', 'ควรเฝ้าดู', 20),
        ('CONCERN', 'น่ากังวล', 30)
    `);

    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        ADD COLUMN concern_level_code VARCHAR(16)
    `);
    await queryRunner.query(`
      UPDATE classroom_student_comments SET concern_level_code = 'NOTE'
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        ALTER COLUMN concern_level_code SET DEFAULT 'NOTE',
        ALTER COLUMN concern_level_code SET NOT NULL,
        ADD CONSTRAINT fk_classroom_student_comments_concern_level
          FOREIGN KEY (concern_level_code)
          REFERENCES classroom_student_comment_concern_levels(code)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX idx_classroom_student_comments_watchlist
      ON classroom_student_comments (
        classroom_id, concern_level_code, created_at DESC, id DESC
      )
      WHERE concern_level_code IN ('WATCH', 'CONCERN')
    `);

    await queryRunner.query(`
      ALTER TABLE classroom_student_comment_concern_levels ENABLE ROW LEVEL SECURITY
    `);
    await queryRunner.query(`
      DO $secure_concern_levels$
      DECLARE role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON TABLE classroom_student_comment_concern_levels FROM %I',
              role_name
            );
          END IF;
        END LOOP;
      END
      $secure_concern_levels$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $rollback_guard$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM classroom_student_comments WHERE concern_level_code <> 'NOTE'
        ) THEN
          RAISE EXCEPTION 'refusing rollback: teacher comments use WATCH or CONCERN';
        END IF;
        IF EXISTS (
          SELECT 1 FROM classroom_student_comments
          WHERE problem_category_code IN ('ATTENDANCE', 'FAMILY_CARE', 'SAFETY')
        ) OR EXISTS (
          SELECT 1 FROM task_submissions
          WHERE follow_up_problem_category_code IN ('ATTENDANCE', 'FAMILY_CARE', 'SAFETY')
        ) THEN
          RAISE EXCEPTION 'refusing rollback: records use the added shared categories';
        END IF;
      END
      $rollback_guard$
    `);
    await queryRunner.query(`DROP INDEX idx_classroom_student_comments_watchlist`);
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        DROP CONSTRAINT fk_classroom_student_comments_concern_level,
        DROP COLUMN concern_level_code
    `);
    await queryRunner.query(`DROP TABLE classroom_student_comment_concern_levels`);
    for (const table of ['classroom_student_problem_categories', 'follow_up_problem_categories']) {
      await queryRunner.query(`
        DELETE FROM ${table}
        WHERE code IN ('ATTENDANCE', 'FAMILY_CARE', 'SAFETY')
      `);
    }
  }
}
