import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase A (A1+A2+A3) — production DB hardening, additive + reversible.
 *
 * A1 indexes: scope/filter columns that currently force sequential scans at
 *   national scale (student_term roster, attendance history, cases/tasks lists,
 *   schools geo cascade). The dev DB is tiny so the planner may still seq-scan;
 *   the indexes matter once these tables hold millions of rows.
 *   ⚠️ PRODUCTION ROLLOUT: on large existing tables create these with
 *   `CREATE INDEX CONCURRENTLY` (outside a txn) to avoid write locks. They are
 *   written as plain `CREATE INDEX IF NOT EXISTS` here to match the repo's
 *   in-transaction migration convention on a small DB.
 *
 * A2 foreign keys: domain relations that were loose integer columns with no
 *   referential integrity. Verified orphan-free on the live DB before adding.
 *   `cases.student_id -> student_term` is intentionally DEFERRED until the
 *   surrogate-key decision (#1) so the FK is not re-pointed twice.
 *
 * A3 unique: idempotency guard against duplicate attendance writes
 *   (one row per student per day per period). Verified duplicate-free first.
 */
export class AddCoreIndexesForeignKeysUnique20260620120000 implements MigrationInterface {
  name = 'AddCoreIndexesForeignKeysUnique20260620120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- A1: indexes ----
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_student_term_scope ON student_term ("SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_attendance_school_date ON attendance ("SchoolID_Onec", "AttendanceDate")`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status)`);
    // NOTE: idx_cases_school_id is owned by AddSchoolIdToCases20260617123000 — not managed here.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_cases_student_id ON cases (student_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tasks_target_school_id ON tasks (target_school_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tasks_type_status ON tasks (task_type, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_schools_geo ON schools (province, district, sub_district)`,
    );

    // ---- A3: attendance idempotency unique (created before any code upsert) ----
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_person_date_period ON attendance ("PersonID_Onec", "AttendanceDate", "Period")`,
    );

    // ---- A2: foreign keys (orphan-free verified). NOT NULL cols use RESTRICT,
    //          nullable cols use ON DELETE SET NULL. Idempotent via pg_constraint. ----
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_SchoolID_Onec_fkey') THEN
          ALTER TABLE attendance ADD CONSTRAINT "attendance_SchoolID_Onec_fkey"
            FOREIGN KEY ("SchoolID_Onec") REFERENCES schools(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_GradeLevelID_Onec_fkey') THEN
          ALTER TABLE attendance ADD CONSTRAINT "attendance_GradeLevelID_Onec_fkey"
            FOREIGN KEY ("GradeLevelID_Onec") REFERENCES grade_levels(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cases_school_id_fkey') THEN
          ALTER TABLE cases ADD CONSTRAINT cases_school_id_fkey
            FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_target_school_id_fkey') THEN
          ALTER TABLE tasks ADD CONSTRAINT tasks_target_school_id_fkey
            FOREIGN KEY (target_school_id) REFERENCES schools(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_target_school_id_fkey`,
    );
    await queryRunner.query(`ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_school_id_fkey`);
    await queryRunner.query(
      `ALTER TABLE attendance DROP CONSTRAINT IF EXISTS "attendance_GradeLevelID_Onec_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE attendance DROP CONSTRAINT IF EXISTS "attendance_SchoolID_Onec_fkey"`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS uq_attendance_person_date_period`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_schools_geo`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_tasks_type_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_tasks_target_school_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cases_student_id`);
    // idx_cases_school_id intentionally NOT dropped — owned by AddSchoolIdToCases20260617123000.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cases_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_attendance_school_date`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_student_term_scope`);
  }
}
