import type { MigrationInterface, QueryRunner } from 'typeorm';

const BACKUP_TABLE = 'exception_attendance_scope_repair_20260827_backup';

/**
 * Repairs databases that applied an earlier draft of the exception-attendance
 * migration before its school-scoped roster/exception constraints were final.
 * Fresh databases already have this shape, so the migration is a no-op there.
 */
export class RepairExceptionAttendanceScope20260827275000 implements MigrationInterface {
  name = 'RepairExceptionAttendanceScope20260827275000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $capture_exception_attendance_scope$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'attendance_session_roster'
            AND column_name = 'school_id'
        ) OR NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'attendance_exceptions'
            AND column_name = 'school_id'
        ) OR NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'attendance_session_roster'::regclass
            AND conname = 'fk_attendance_session_roster_session_school'
        ) OR NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'attendance_exceptions'::regclass
            AND conname = 'fk_attendance_exceptions_roster'
        ) THEN
          CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
            repair_id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (repair_id),
            roster_school_id_existed BOOLEAN NOT NULL,
            exception_school_id_existed BOOLEAN NOT NULL,
            session_school_unique_existed BOOLEAN NOT NULL,
            roster_session_school_fk_existed BOOLEAN NOT NULL,
            exception_session_school_fk_existed BOOLEAN NOT NULL,
            exception_roster_fk_existed BOOLEAN NOT NULL,
            exception_membership_school_fk_existed BOOLEAN NOT NULL,
            scoped_membership_index_existed BOOLEAN NOT NULL
          );

          INSERT INTO ${BACKUP_TABLE} (
            repair_id,
            roster_school_id_existed,
            exception_school_id_existed,
            session_school_unique_existed,
            roster_session_school_fk_existed,
            exception_session_school_fk_existed,
            exception_roster_fk_existed,
            exception_membership_school_fk_existed,
            scoped_membership_index_existed
          )
          SELECT
            TRUE,
            EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'attendance_session_roster'
                AND column_name = 'school_id'
            ),
            EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'attendance_exceptions'
                AND column_name = 'school_id'
            ),
            EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conrelid = 'attendance_sessions'::regclass
                AND conname = 'uq_attendance_sessions_id_school'
            ),
            EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conrelid = 'attendance_session_roster'::regclass
                AND conname = 'fk_attendance_session_roster_session_school'
            ),
            EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conrelid = 'attendance_exceptions'::regclass
                AND conname = 'fk_attendance_exceptions_session_school'
            ),
            EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conrelid = 'attendance_exceptions'::regclass
                AND conname = 'fk_attendance_exceptions_roster'
            ),
            EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conrelid = 'attendance_exceptions'::regclass
                AND conname = 'fk_attendance_exceptions_marked_by_membership_school'
            ),
            EXISTS (
              SELECT 1 FROM pg_indexes
              WHERE schemaname = 'public'
                AND tablename = 'attendance_exceptions'
                AND indexname = 'idx_attendance_exceptions_marked_by_membership'
                AND indexdef LIKE '%(marked_by_teacher_membership_id, school_id)%'
            )
          ON CONFLICT (repair_id) DO NOTHING;
        END IF;
      END;
      $capture_exception_attendance_scope$;
    `);

    await queryRunner.query(`
      DO $secure_exception_attendance_scope_backup$
      DECLARE
        role_name TEXT;
      BEGIN
        IF to_regclass('public.${BACKUP_TABLE}') IS NULL THEN
          RETURN;
        END IF;
        ALTER TABLE ${BACKUP_TABLE} ENABLE ROW LEVEL SECURITY;
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
        LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE ${BACKUP_TABLE} FROM %I', role_name);
          END IF;
        END LOOP;
      END;
      $secure_exception_attendance_scope_backup$;
    `);

    await queryRunner.query(`
      ALTER TABLE attendance_session_roster ADD COLUMN IF NOT EXISTS school_id INTEGER;
      ALTER TABLE attendance_exceptions ADD COLUMN IF NOT EXISTS school_id INTEGER;

      UPDATE attendance_session_roster roster
      SET school_id = session.school_id
      FROM attendance_sessions session
      WHERE session.id = roster.session_id
        AND roster.school_id IS NULL;

      UPDATE attendance_exceptions exception
      SET school_id = session.school_id
      FROM attendance_sessions session
      WHERE session.id = exception.session_id
        AND exception.school_id IS NULL;
    `);

    await queryRunner.query(`
      DO $reconcile_exception_attendance_scope$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM attendance_session_roster roster
          LEFT JOIN attendance_sessions session ON session.id = roster.session_id
          WHERE roster.school_id IS NULL
             OR session.id IS NULL
             OR roster.school_id <> session.school_id
        ) THEN
          RAISE EXCEPTION
            'RepairExceptionAttendanceScope: roster school reconciliation failed';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM attendance_exceptions exception
          LEFT JOIN attendance_sessions session ON session.id = exception.session_id
          LEFT JOIN attendance_session_roster roster
            ON roster.session_id = exception.session_id
           AND roster.student_uuid = exception.student_uuid
          WHERE exception.school_id IS NULL
             OR session.id IS NULL
             OR exception.school_id <> session.school_id
             OR roster.session_id IS NULL
        ) THEN
          RAISE EXCEPTION
            'RepairExceptionAttendanceScope: exception school/roster reconciliation failed';
        END IF;
      END;
      $reconcile_exception_attendance_scope$;
    `);

    await queryRunner.query(`
      DO $add_exception_attendance_scope_constraints$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'attendance_sessions'::regclass
            AND conname = 'uq_attendance_sessions_id_school'
        ) THEN
          ALTER TABLE attendance_sessions
            ADD CONSTRAINT uq_attendance_sessions_id_school UNIQUE (id, school_id);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'attendance_session_roster'::regclass
            AND conname = 'fk_attendance_session_roster_session_school'
        ) THEN
          ALTER TABLE attendance_session_roster
            ADD CONSTRAINT fk_attendance_session_roster_session_school
            FOREIGN KEY (session_id, school_id)
            REFERENCES attendance_sessions(id, school_id)
            ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'attendance_exceptions'::regclass
            AND conname = 'fk_attendance_exceptions_session_school'
        ) THEN
          ALTER TABLE attendance_exceptions
            ADD CONSTRAINT fk_attendance_exceptions_session_school
            FOREIGN KEY (session_id, school_id)
            REFERENCES attendance_sessions(id, school_id)
            ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'attendance_exceptions'::regclass
            AND conname = 'fk_attendance_exceptions_roster'
        ) THEN
          ALTER TABLE attendance_exceptions
            ADD CONSTRAINT fk_attendance_exceptions_roster
            FOREIGN KEY (session_id, student_uuid)
            REFERENCES attendance_session_roster(session_id, student_uuid)
            ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'attendance_exceptions'::regclass
            AND conname = 'fk_attendance_exceptions_marked_by_membership_school'
        ) THEN
          ALTER TABLE attendance_exceptions
            ADD CONSTRAINT fk_attendance_exceptions_marked_by_membership_school
            FOREIGN KEY (marked_by_teacher_membership_id, school_id)
            REFERENCES school_teacher_memberships(id, school_id)
            ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
        END IF;
      END;
      $add_exception_attendance_scope_constraints$;

      ALTER TABLE attendance_session_roster
        VALIDATE CONSTRAINT fk_attendance_session_roster_session_school;
      ALTER TABLE attendance_exceptions
        VALIDATE CONSTRAINT fk_attendance_exceptions_session_school;
      ALTER TABLE attendance_exceptions
        VALIDATE CONSTRAINT fk_attendance_exceptions_roster;
      ALTER TABLE attendance_exceptions
        VALIDATE CONSTRAINT fk_attendance_exceptions_marked_by_membership_school;

      ALTER TABLE attendance_session_roster
        DROP CONSTRAINT IF EXISTS chk_attendance_session_roster_school_id_repair,
        ADD CONSTRAINT chk_attendance_session_roster_school_id_repair
        CHECK (school_id IS NOT NULL) NOT VALID;
      ALTER TABLE attendance_exceptions
        DROP CONSTRAINT IF EXISTS chk_attendance_exceptions_school_id_repair,
        ADD CONSTRAINT chk_attendance_exceptions_school_id_repair
        CHECK (school_id IS NOT NULL) NOT VALID;
      ALTER TABLE attendance_session_roster
        VALIDATE CONSTRAINT chk_attendance_session_roster_school_id_repair;
      ALTER TABLE attendance_exceptions
        VALIDATE CONSTRAINT chk_attendance_exceptions_school_id_repair;

      ALTER TABLE attendance_session_roster ALTER COLUMN school_id SET NOT NULL;
      ALTER TABLE attendance_exceptions ALTER COLUMN school_id SET NOT NULL;
      ALTER TABLE attendance_session_roster
        DROP CONSTRAINT chk_attendance_session_roster_school_id_repair;
      ALTER TABLE attendance_exceptions
        DROP CONSTRAINT chk_attendance_exceptions_school_id_repair;

      ALTER TABLE attendance_session_roster
        DROP CONSTRAINT IF EXISTS fk_attendance_session_roster_session;
      ALTER TABLE attendance_exceptions
        DROP CONSTRAINT IF EXISTS fk_attendance_exceptions_session,
        DROP CONSTRAINT IF EXISTS fk_attendance_exceptions_student,
        DROP CONSTRAINT IF EXISTS fk_attendance_exceptions_marked_by_membership;

      DROP INDEX IF EXISTS idx_attendance_exceptions_marked_by_membership;
      CREATE INDEX idx_attendance_exceptions_marked_by_membership
        ON attendance_exceptions (marked_by_teacher_membership_id, school_id)
        WHERE marked_by_teacher_membership_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
        repair_id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (repair_id),
        roster_school_id_existed BOOLEAN NOT NULL,
        exception_school_id_existed BOOLEAN NOT NULL,
        session_school_unique_existed BOOLEAN NOT NULL,
        roster_session_school_fk_existed BOOLEAN NOT NULL,
        exception_session_school_fk_existed BOOLEAN NOT NULL,
        exception_roster_fk_existed BOOLEAN NOT NULL,
        exception_membership_school_fk_existed BOOLEAN NOT NULL,
        scoped_membership_index_existed BOOLEAN NOT NULL
      )
    `);
    await queryRunner.query(`
      DO $revert_exception_attendance_scope_repair$
      DECLARE
        repair ${BACKUP_TABLE}%ROWTYPE;
      BEGIN
        IF to_regclass('public.${BACKUP_TABLE}') IS NULL THEN
          RETURN;
        END IF;

        SELECT * INTO repair FROM ${BACKUP_TABLE} WHERE repair_id = TRUE;
        IF NOT FOUND THEN
          DROP TABLE ${BACKUP_TABLE};
          RETURN;
        END IF;

        IF NOT repair.roster_session_school_fk_existed THEN
          ALTER TABLE attendance_session_roster
            DROP CONSTRAINT IF EXISTS fk_attendance_session_roster_session_school;
        END IF;
        IF NOT repair.exception_session_school_fk_existed THEN
          ALTER TABLE attendance_exceptions
            DROP CONSTRAINT IF EXISTS fk_attendance_exceptions_session_school;
        END IF;
        IF NOT repair.exception_roster_fk_existed THEN
          ALTER TABLE attendance_exceptions
            DROP CONSTRAINT IF EXISTS fk_attendance_exceptions_roster;
        END IF;
        IF NOT repair.exception_membership_school_fk_existed THEN
          ALTER TABLE attendance_exceptions
            DROP CONSTRAINT IF EXISTS fk_attendance_exceptions_marked_by_membership_school;
        END IF;

        DROP INDEX IF EXISTS idx_attendance_exceptions_marked_by_membership;

        IF NOT repair.roster_school_id_existed THEN
          ALTER TABLE attendance_session_roster
            ADD CONSTRAINT fk_attendance_session_roster_session
            FOREIGN KEY (session_id) REFERENCES attendance_sessions(id)
            ON DELETE RESTRICT ON UPDATE CASCADE;
          ALTER TABLE attendance_session_roster DROP COLUMN school_id;
        END IF;

        IF NOT repair.exception_school_id_existed THEN
          ALTER TABLE attendance_exceptions
            ADD CONSTRAINT fk_attendance_exceptions_session
            FOREIGN KEY (session_id) REFERENCES attendance_sessions(id)
            ON DELETE RESTRICT ON UPDATE CASCADE,
            ADD CONSTRAINT fk_attendance_exceptions_student
            FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid)
            ON DELETE RESTRICT ON UPDATE CASCADE,
            ADD CONSTRAINT fk_attendance_exceptions_marked_by_membership
            FOREIGN KEY (marked_by_teacher_membership_id)
            REFERENCES school_teacher_memberships(id)
            ON DELETE RESTRICT ON UPDATE CASCADE;
          ALTER TABLE attendance_exceptions DROP COLUMN school_id;
        END IF;

        IF NOT repair.session_school_unique_existed THEN
          ALTER TABLE attendance_sessions
            DROP CONSTRAINT IF EXISTS uq_attendance_sessions_id_school;
        END IF;

        IF repair.scoped_membership_index_existed THEN
          CREATE INDEX idx_attendance_exceptions_marked_by_membership
            ON attendance_exceptions (marked_by_teacher_membership_id, school_id)
            WHERE marked_by_teacher_membership_id IS NOT NULL;
        ELSE
          CREATE INDEX idx_attendance_exceptions_marked_by_membership
            ON attendance_exceptions (marked_by_teacher_membership_id)
            WHERE marked_by_teacher_membership_id IS NOT NULL;
        END IF;

        DROP TABLE ${BACKUP_TABLE};
      END;
      $revert_exception_attendance_scope_repair$;
    `);
  }
}
