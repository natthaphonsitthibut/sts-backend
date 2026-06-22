import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase B1.2 (EXPAND) — add the surrogate-key FK `student_uuid` to the
 * `attendance` and `cases` tables so they reference the opaque student UUID
 * (added to `student_term` in B1.1) in parallel with the legacy national-ID
 * link. The legacy text columns stay in place until a later CONTRACT phase.
 *
 * attendance: every row already FK-references `student_term("PersonID_Onec")`,
 * so the backfill is total and the column is set NOT NULL afterwards.
 * cases: `student_id` is loose text with no FK; some rows won't map, so the
 * column stays NULLABLE.
 *
 * Additive + reversible + idempotent. The FKs are added NOT VALID then
 * VALIDATE'd separately so the exclusive lock for adding the constraint is
 * brief and validation runs under a weaker lock.
 *
 * ⚠️ PRODUCTION-SCALE ROLLOUT (millions of rows): the inline single-statement
 * UPDATE backfill and non-concurrent index build below are fine for this seed
 * DB (5k/500) but NOT for national data. For the live rollout use:
 *   1) ADD COLUMN student_uuid UUID (nullable, no default)
 *   2) batched UPDATE backfill (keyed on the existing FK / student_id)
 *   3) CREATE INDEX CONCURRENTLY idx_..._student_uuid ON ... (student_uuid)
 *   4) ADD CONSTRAINT fk_..._student_uuid ... NOT VALID
 *   5) VALIDATE CONSTRAINT fk_..._student_uuid (weak lock)
 *   6) for attendance, enforce NOT NULL via a validated CHECK then a short
 *      final SET NOT NULL lock
 */
export class AddStudentUuidToAttendanceCases20260622120000 implements MigrationInterface {
  name = 'AddStudentUuidToAttendanceCases20260622120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // == attendance ==
    await queryRunner.query(`
      ALTER TABLE attendance
        ADD COLUMN IF NOT EXISTS student_uuid UUID
    `);

    await queryRunner.query(`
      UPDATE attendance a
      SET student_uuid = st.student_uuid
      FROM student_term st
      WHERE a."PersonID_Onec" = st."PersonID_Onec"
        AND a.student_uuid IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE attendance
        ALTER COLUMN student_uuid SET NOT NULL
    `);

    // ADD CONSTRAINT has no IF NOT EXISTS — guard it so the migration is re-runnable.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_student_uuid'
        ) THEN
          ALTER TABLE attendance
            ADD CONSTRAINT fk_attendance_student_uuid
            FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid)
            NOT VALID;
          ALTER TABLE attendance VALIDATE CONSTRAINT fk_attendance_student_uuid;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_student_uuid ON attendance(student_uuid)
    `);

    // == cases ==
    await queryRunner.query(`
      ALTER TABLE cases
        ADD COLUMN IF NOT EXISTS student_uuid UUID
    `);

    await queryRunner.query(`
      UPDATE cases c
      SET student_uuid = st.student_uuid
      FROM student_term st
      WHERE c.student_id = st."PersonID_Onec"
        AND c.student_id IS NOT NULL
        AND c.student_uuid IS NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_cases_student_uuid'
        ) THEN
          ALTER TABLE cases
            ADD CONSTRAINT fk_cases_student_uuid
            FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid)
            NOT VALID;
          ALTER TABLE cases VALIDATE CONSTRAINT fk_cases_student_uuid;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cases_student_uuid ON cases(student_uuid)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cases_student_uuid`);
    await queryRunner.query(`
      ALTER TABLE cases DROP CONSTRAINT IF EXISTS fk_cases_student_uuid
    `);
    await queryRunner.query(`
      ALTER TABLE cases DROP COLUMN IF EXISTS student_uuid
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_attendance_student_uuid`);
    await queryRunner.query(`
      ALTER TABLE attendance DROP CONSTRAINT IF EXISTS fk_attendance_student_uuid
    `);
    await queryRunner.query(`
      ALTER TABLE attendance DROP COLUMN IF EXISTS student_uuid
    `);
  }
}
