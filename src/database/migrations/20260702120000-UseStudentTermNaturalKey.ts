import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CONTRACT — allow one canonical person to have one enrollment snapshot per
 * academic year, semester, and school. All four columns are required for new
 * imports and form the conflict target used by the import upsert.
 *
 * Existing identifiers keep their FK through student_term.person_uuid ->
 * student_person(person_uuid) with ON DELETE RESTRICT / ON UPDATE NO ACTION.
 * No new columns or defaults are introduced.
 *
 * Reversal is fail-closed: once more than one term exists for a PersonID, the
 * legacy unique constraint cannot be restored without deleting history. The
 * down migration raises a clear error instead of discarding rows.
 */
export class UseStudentTermNaturalKey20260702120000 implements MigrationInterface {
  name = 'UseStudentTermNaturalKey20260702120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM student_term
          WHERE person_uuid IS NULL
             OR "AcademicYear_Onec" IS NULL
             OR "Semester_Onec" IS NULL
             OR "SchoolID_Onec" IS NULL
        ) THEN
          RAISE EXCEPTION 'student_term contains incomplete enrollment natural keys';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM student_term
          GROUP BY person_uuid, "AcademicYear_Onec", "Semester_Onec", "SchoolID_Onec"
          HAVING COUNT(*) > 1
        ) THEN
          RAISE EXCEPTION 'student_term contains duplicate enrollment natural keys';
        END IF;
      END $$
    `);

    await queryRunner.query(`
      ALTER TABLE student_term
        ALTER COLUMN person_uuid SET NOT NULL,
        ALTER COLUMN "AcademicYear_Onec" SET NOT NULL,
        ALTER COLUMN "Semester_Onec" SET NOT NULL,
        ALTER COLUMN "SchoolID_Onec" SET NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE student_term DROP CONSTRAINT IF EXISTS fk_student_term_school`,
    );
    await queryRunner.query(`
      ALTER TABLE student_term
        ADD CONSTRAINT fk_student_term_school
        FOREIGN KEY ("SchoolID_Onec") REFERENCES schools(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'uq_student_term_enrollment_natural'
        ) THEN
          ALTER TABLE student_term
            ADD CONSTRAINT uq_student_term_enrollment_natural
            UNIQUE (person_uuid, "AcademicYear_Onec", "Semester_Onec", "SchoolID_Onec");
        END IF;
      END $$
    `);

    await queryRunner.query(
      `ALTER TABLE student_term DROP CONSTRAINT IF EXISTS uq_student_term_personid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM student_term
          GROUP BY "PersonID_Onec"
          HAVING COUNT(*) > 1
        ) THEN
          RAISE EXCEPTION 'cannot restore PersonID uniqueness after multi-term rows exist';
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_student_term_personid'
        ) THEN
          ALTER TABLE student_term
            ADD CONSTRAINT uq_student_term_personid UNIQUE ("PersonID_Onec");
        END IF;
      END $$
    `);

    await queryRunner.query(
      `ALTER TABLE student_term DROP CONSTRAINT IF EXISTS uq_student_term_enrollment_natural`,
    );
    await queryRunner.query(
      `ALTER TABLE student_term DROP CONSTRAINT IF EXISTS fk_student_term_school`,
    );
    await queryRunner.query(`
      ALTER TABLE student_term
        ALTER COLUMN "SchoolID_Onec" DROP NOT NULL,
        ALTER COLUMN "Semester_Onec" DROP NOT NULL,
        ALTER COLUMN "AcademicYear_Onec" DROP NOT NULL,
        ALTER COLUMN person_uuid DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE student_term
        ADD CONSTRAINT fk_student_term_school
        FOREIGN KEY ("SchoolID_Onec") REFERENCES schools(id)
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }
}
