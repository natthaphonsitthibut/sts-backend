import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EXPAND — structured student/contact snapshot for field-visit cases.
 *
 * Existing `student_name` and `student_address` stay as the backward-compatible
 * display strings. The new nullable columns keep the structured pieces entered
 * at case creation time. `cases.school_id` remains the school FK and is already
 * constrained by `cases_school_id_fkey` (cases.school_id -> schools.id).
 */
export class AddStructuredCaseStudentContact20260624160000 implements MigrationInterface {
  name = 'AddStructuredCaseStudentContact20260624160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE cases
        ADD COLUMN IF NOT EXISTS student_first_name TEXT,
        ADD COLUMN IF NOT EXISTS student_last_name TEXT,
        ADD COLUMN IF NOT EXISTS address_line TEXT,
        ADD COLUMN IF NOT EXISTS address_province TEXT,
        ADD COLUMN IF NOT EXISTS address_district TEXT,
        ADD COLUMN IF NOT EXISTS address_sub_district TEXT,
        ADD COLUMN IF NOT EXISTS postal_code TEXT
    `);

    await queryRunner.query(`
      UPDATE cases
      SET
        address_line = COALESCE(address_line, student_address),
        student_first_name = COALESCE(
          student_first_name,
          NULLIF(SPLIT_PART(TRIM(student_name), ' ', 1), '')
        ),
        student_last_name = COALESCE(
          student_last_name,
          NULLIF(REGEXP_REPLACE(TRIM(student_name), '^\\S+\\s*', ''), '')
        )
      WHERE student_name IS NOT NULL
         OR student_address IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_cases_postal_code
    `);
    await queryRunner.query(`
      ALTER TABLE cases
        ADD CONSTRAINT chk_cases_postal_code
        CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{5}$') NOT VALID
    `);
    await queryRunner.query(`
      ALTER TABLE cases VALIDATE CONSTRAINT chk_cases_postal_code
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_cases_postal_code
    `);
    await queryRunner.query(`
      ALTER TABLE cases
        DROP COLUMN IF EXISTS postal_code,
        DROP COLUMN IF EXISTS address_sub_district,
        DROP COLUMN IF EXISTS address_district,
        DROP COLUMN IF EXISTS address_province,
        DROP COLUMN IF EXISTS address_line,
        DROP COLUMN IF EXISTS student_last_name,
        DROP COLUMN IF EXISTS student_first_name
    `);
  }
}
