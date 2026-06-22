import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase B1.4 (CONTRACT) — promote the opaque surrogate `student_uuid` to the
 * real primary key of `student_term` and retire the national-ID link:
 *   - `student_term` PK moves `PersonID_Onec` -> `student_uuid`; `PersonID_Onec`
 *     stays as a UNIQUE attribute (still the import reconciliation key via
 *     `ON CONFLICT ("PersonID_Onec")`), but is no longer the PK and never leaves
 *     the server.
 *   - `attendance` is keyed solely by `student_uuid`: its dedup unique index and
 *     FK move to the uuid, and the now-unused `attendance."PersonID_Onec"`
 *     column is dropped.
 *   - `cases` drops the loose `student_id` text link; case matching/scope keys on
 *     `student_uuid` (the FK added in B1.2).
 *
 * Must run AFTER the application code stops reading/writing the legacy columns
 * (B1.4 code sweep), so the drops below are safe.
 *
 * Reversible: down() re-adds the legacy PK/columns and backfills the national ID
 * from `student_term` via the intact `student_uuid` FK. Idempotent guards on
 * every constraint so the migration is re-runnable.
 *
 * ⚠️ PRODUCTION-SCALE: on national data do the PK swap online (build the uuid
 * unique index CONCURRENTLY, swap the PK under a brief lock) and drop the legacy
 * columns in a separate later release once nothing references them. This inline
 * form targets the seed DB only.
 */
export class ContractStudentSurrogatePk20260622130000 implements MigrationInterface {
  name = 'ContractStudentSurrogatePk20260622130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Keep PersonID_Onec unique once it is no longer the PK (imports rely on
    //    a unique constraint for ON CONFLICT reconciliation).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_student_term_personid'
        ) THEN
          ALTER TABLE student_term
            ADD CONSTRAINT uq_student_term_personid UNIQUE ("PersonID_Onec");
        END IF;
      END $$;
    `);

    // 2. Move the attendance dedup unique index to the surrogate key.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_uuid_date_period
        ON attendance (student_uuid, "AttendanceDate", "Period")
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_attendance_person_date_period`);

    // 3. Drop the legacy attendance -> PersonID FK (uuid FK from B1.2 remains).
    await queryRunner.query(
      `ALTER TABLE attendance DROP CONSTRAINT IF EXISTS "attendance_PersonID_Onec_fkey"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_attendance_person_id`);

    // 4. Swap the student_term primary key: PersonID_Onec -> student_uuid.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'student_term_pkey' AND conrelid = 'student_term'::regclass
        ) THEN
          ALTER TABLE student_term DROP CONSTRAINT student_term_pkey;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE contype = 'p' AND conrelid = 'student_term'::regclass
        ) THEN
          ALTER TABLE student_term ADD PRIMARY KEY (student_uuid);
        END IF;
      END $$;
    `);

    // 5. Drop the now-unused legacy student-link columns.
    await queryRunner.query(`ALTER TABLE attendance DROP COLUMN IF EXISTS "PersonID_Onec"`);
    await queryRunner.query(`ALTER TABLE cases DROP COLUMN IF EXISTS student_id`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // reverse 5: re-add legacy columns and backfill the national ID from the
    // intact student_uuid link.
    await queryRunner.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS student_id TEXT`);
    await queryRunner.query(`
      UPDATE cases c
      SET student_id = st."PersonID_Onec"
      FROM student_term st
      WHERE c.student_uuid = st.student_uuid
        AND c.student_uuid IS NOT NULL
        AND c.student_id IS NULL
    `);

    await queryRunner.query(
      `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS "PersonID_Onec" VARCHAR(20)`,
    );
    await queryRunner.query(`
      UPDATE attendance a
      SET "PersonID_Onec" = st."PersonID_Onec"
      FROM student_term st
      WHERE a.student_uuid = st.student_uuid
        AND a."PersonID_Onec" IS NULL
    `);
    await queryRunner.query(`ALTER TABLE attendance ALTER COLUMN "PersonID_Onec" SET NOT NULL`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_attendance_person_id ON attendance("PersonID_Onec")`,
    );

    // reverse 4: primary key back to PersonID_Onec.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE contype = 'p' AND conrelid = 'student_term'::regclass
        ) THEN
          ALTER TABLE student_term DROP CONSTRAINT student_term_pkey;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE contype = 'p' AND conrelid = 'student_term'::regclass
        ) THEN
          ALTER TABLE student_term ADD PRIMARY KEY ("PersonID_Onec");
        END IF;
      END $$;
    `);

    // reverse 1 (must run BEFORE re-adding the FK so the FK binds to the restored
    // PK instead of this redundant unique — otherwise the unique can't be dropped):
    // drop the standalone PersonID unique now that the PK covers PersonID again.
    await queryRunner.query(
      `ALTER TABLE student_term DROP CONSTRAINT IF EXISTS uq_student_term_personid`,
    );

    // reverse 3: re-add the attendance -> PersonID FK (binds to the restored PK).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'attendance_PersonID_Onec_fkey'
        ) THEN
          ALTER TABLE attendance
            ADD CONSTRAINT "attendance_PersonID_Onec_fkey"
            FOREIGN KEY ("PersonID_Onec") REFERENCES student_term("PersonID_Onec");
        END IF;
      END $$;
    `);

    // reverse 2: dedup unique index back to PersonID.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_person_date_period
        ON attendance ("PersonID_Onec", "AttendanceDate", "Period")
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_attendance_uuid_date_period`);
  }
}
