import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EXPAND — app-editable home address fields for a student enrollment snapshot.
 *
 * `address_house_no` (บ้านเลขที่) complements the ONEC-sourced `VillageNumber_Onec`
 * (หมู่) so staff can record a house number that ONEC does not provide. The
 * coordinates are nullable DOUBLE PRECISION values that must be present as a
 * valid pair, letting staff pin the home on the map for visit planning. All are
 * app data rather than ONEC fields, so they use the `address_*` naming instead
 * of the `*_Onec` suffix. They reference no master-data table, so no FK is
 * required. Existing rows stay valid (all NULL) and backfill through the edit
 * form.
 */
export class AddStudentHomeAddressFields20260701180000 implements MigrationInterface {
  name = 'AddStudentHomeAddressFields20260701180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_term
        ADD COLUMN IF NOT EXISTS address_house_no TEXT,
        ADD COLUMN IF NOT EXISTS address_latitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS address_longitude DOUBLE PRECISION
    `);

    await queryRunner.query(`
      ALTER TABLE student_term DROP CONSTRAINT IF EXISTS chk_student_term_address_coordinates
    `);
    await queryRunner.query(`
      ALTER TABLE student_term
        ADD CONSTRAINT chk_student_term_address_coordinates
        CHECK (
          (address_latitude IS NULL AND address_longitude IS NULL)
          OR (
            address_latitude BETWEEN -90 AND 90
            AND address_longitude BETWEEN -180 AND 180
          )
        ) NOT VALID
    `);
    await queryRunner.query(`
      ALTER TABLE student_term VALIDATE CONSTRAINT chk_student_term_address_coordinates
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_term DROP CONSTRAINT IF EXISTS chk_student_term_address_coordinates
    `);
    await queryRunner.query(`
      ALTER TABLE student_term
        DROP COLUMN IF EXISTS address_longitude,
        DROP COLUMN IF EXISTS address_latitude,
        DROP COLUMN IF EXISTS address_house_no
    `);
  }
}
