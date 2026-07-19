import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EXPAND — store guardian given name and family name separately.
 *
 * full_name remains as a synchronized compatibility column while older app
 * versions are drained. Existing values are split at the final whitespace;
 * a single-token legacy name is retained as first_name with a null last_name.
 */
export class SplitStudentGuardianNames20260719120000 implements MigrationInterface {
  name = 'SplitStudentGuardianNames20260719120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_guardian
        ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
        ADD COLUMN IF NOT EXISTS last_name VARCHAR(100)
    `);
    await queryRunner.query(`
      UPDATE student_guardian
      SET first_name = CASE
            WHEN btrim(full_name) ~ '[[:space:]]'
              THEN regexp_replace(btrim(full_name), '[[:space:]]+[^[:space:]]+$', '')
            ELSE btrim(full_name)
          END,
          last_name = CASE
            WHEN btrim(full_name) ~ '[[:space:]]'
              THEN substring(btrim(full_name) FROM '([^[:space:]]+)$')
            ELSE NULL
          END
      WHERE first_name IS NULL
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION sync_student_guardian_name_fields()
      RETURNS trigger AS $$
      DECLARE
        normalized_full_name TEXT;
      BEGIN
        IF (
          TG_OP = 'UPDATE'
          AND NEW.full_name IS DISTINCT FROM OLD.full_name
          AND NEW.first_name IS NOT DISTINCT FROM OLD.first_name
          AND NEW.last_name IS NOT DISTINCT FROM OLD.last_name
        ) OR NEW.first_name IS NULL OR btrim(NEW.first_name) = '' THEN
          normalized_full_name := btrim(COALESCE(NEW.full_name, ''));
          IF normalized_full_name ~ '[[:space:]]' THEN
            NEW.first_name := regexp_replace(
              normalized_full_name,
              '[[:space:]]+[^[:space:]]+$',
              ''
            );
            NEW.last_name := substring(normalized_full_name FROM '([^[:space:]]+)$');
          ELSE
            NEW.first_name := normalized_full_name;
            NEW.last_name := NULL;
          END IF;
        ELSE
          NEW.first_name := btrim(NEW.first_name);
          NEW.last_name := NULLIF(btrim(NEW.last_name), '');
          NEW.full_name := concat_ws(' ', NEW.first_name, NEW.last_name);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_student_guardian_sync_name_fields ON student_guardian
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_student_guardian_sync_name_fields
      BEFORE INSERT OR UPDATE OF first_name, last_name, full_name
      ON student_guardian
      FOR EACH ROW EXECUTE FUNCTION sync_student_guardian_name_fields()
    `);
    await queryRunner.query(`
      ALTER TABLE student_guardian
        ALTER COLUMN first_name SET NOT NULL,
        ADD CONSTRAINT chk_student_guardian_first_name_not_blank
          CHECK (btrim(first_name) <> ''),
        ADD CONSTRAINT chk_student_guardian_last_name_not_blank
          CHECK (last_name IS NULL OR btrim(last_name) <> '')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_student_guardian_sync_name_fields ON student_guardian
    `);
    await queryRunner.query(`DROP FUNCTION IF EXISTS sync_student_guardian_name_fields()`);
    await queryRunner.query(`
      ALTER TABLE student_guardian
        DROP CONSTRAINT IF EXISTS chk_student_guardian_last_name_not_blank,
        DROP CONSTRAINT IF EXISTS chk_student_guardian_first_name_not_blank,
        DROP COLUMN IF EXISTS last_name,
        DROP COLUMN IF EXISTS first_name
    `);
  }
}
