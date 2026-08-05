import type { MigrationInterface, QueryRunner } from 'typeorm';
import { STUDENT_TERM_POSTAL_CODE_BACKFILL_SQL } from '../bootstrap-sql';

export class AddStudentTermPostalCode20260630150000 implements MigrationInterface {
  name = 'AddStudentTermPostalCode20260630150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE student_term ADD COLUMN IF NOT EXISTS "PostalCode_Onec" VARCHAR(5)`,
    );
    await queryRunner.query(STUDENT_TERM_POSTAL_CODE_BACKFILL_SQL);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_student_term_postal_code'
        ) THEN
          ALTER TABLE student_term
            ADD CONSTRAINT chk_student_term_postal_code
            CHECK ("PostalCode_Onec" IS NULL OR "PostalCode_Onec" ~ '^[0-9]{5}$') NOT VALID;
          ALTER TABLE student_term VALIDATE CONSTRAINT chk_student_term_postal_code;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE student_term DROP CONSTRAINT IF EXISTS chk_student_term_postal_code`,
    );
    await queryRunner.query(`ALTER TABLE student_term DROP COLUMN IF EXISTS "PostalCode_Onec"`);
  }
}
