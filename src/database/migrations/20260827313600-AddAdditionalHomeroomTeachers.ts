import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Keeps the existing one-row-per-classroom table as the primary homeroom
 * teacher (and therefore the backward-compatible LINE recipient), while an
 * additive relation stores every co-homeroom teacher. Consumers that grant
 * homeroom access read the union view so primary and additional teachers have
 * identical classroom scope.
 */
export class AddAdditionalHomeroomTeachers20260827313600 implements MigrationInterface {
  name = 'AddAdditionalHomeroomTeachers20260827313600';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE classroom_additional_homeroom_teachers (
        classroom_id BIGINT NOT NULL,
        school_id INTEGER NOT NULL,
        teacher_membership_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER,
        CONSTRAINT pk_classroom_additional_homeroom_teachers
          PRIMARY KEY (classroom_id),
        CONSTRAINT fk_classroom_additional_homeroom_teachers_classroom
          FOREIGN KEY (classroom_id, school_id)
          REFERENCES school_classrooms(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_additional_homeroom_teachers_membership
          FOREIGN KEY (teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_additional_homeroom_teachers_created_by
          FOREIGN KEY (created_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_additional_homeroom_teachers_updated_by
          FOREIGN KEY (updated_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE
      );

      CREATE INDEX idx_classroom_additional_homeroom_teachers_membership
        ON classroom_additional_homeroom_teachers (teacher_membership_id, classroom_id);
      CREATE INDEX idx_classroom_additional_homeroom_teachers_created_by
        ON classroom_additional_homeroom_teachers (created_by)
        WHERE created_by IS NOT NULL;
      CREATE INDEX idx_classroom_additional_homeroom_teachers_updated_by
        ON classroom_additional_homeroom_teachers (updated_by)
        WHERE updated_by IS NOT NULL;

      CREATE TRIGGER trg_classroom_additional_homeroom_teachers_set_updated_at
      BEFORE UPDATE ON classroom_additional_homeroom_teachers
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      CREATE OR REPLACE FUNCTION prevent_duplicate_additional_homeroom_teacher()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $prevent_duplicate_additional_homeroom_teacher$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM classroom_homeroom_teachers primary_assignment
          WHERE primary_assignment.classroom_id = NEW.classroom_id
        ) THEN
          RAISE EXCEPTION 'A primary homeroom teacher is required before an additional teacher'
            USING ERRCODE = '23503';
        END IF;
        IF EXISTS (
          SELECT 1
          FROM classroom_homeroom_teachers primary_assignment
          WHERE primary_assignment.classroom_id = NEW.classroom_id
            AND primary_assignment.teacher_membership_id = NEW.teacher_membership_id
        ) THEN
          RAISE EXCEPTION 'Teacher membership is already the primary homeroom teacher'
            USING ERRCODE = '23505';
        END IF;
        RETURN NEW;
      END;
      $prevent_duplicate_additional_homeroom_teacher$;

      CREATE TRIGGER trg_prevent_duplicate_additional_homeroom_teacher
      BEFORE INSERT OR UPDATE ON classroom_additional_homeroom_teachers
      FOR EACH ROW EXECUTE FUNCTION prevent_duplicate_additional_homeroom_teacher();

      CREATE OR REPLACE FUNCTION remove_promoted_additional_homeroom_teacher()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $remove_promoted_additional_homeroom_teacher$
      BEGIN
        DELETE FROM classroom_additional_homeroom_teachers
        WHERE classroom_id = NEW.classroom_id
          AND teacher_membership_id = NEW.teacher_membership_id;
        RETURN NEW;
      END;
      $remove_promoted_additional_homeroom_teacher$;

      CREATE TRIGGER trg_remove_promoted_additional_homeroom_teacher
      AFTER INSERT OR UPDATE OF teacher_membership_id ON classroom_homeroom_teachers
      FOR EACH ROW EXECUTE FUNCTION remove_promoted_additional_homeroom_teacher();

      CREATE OR REPLACE FUNCTION promote_additional_homeroom_teacher_after_primary_delete()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $promote_additional_homeroom_teacher_after_primary_delete$
      DECLARE promoted classroom_additional_homeroom_teachers%ROWTYPE;
      BEGIN
        SELECT * INTO promoted
        FROM classroom_additional_homeroom_teachers
        WHERE classroom_id = OLD.classroom_id;
        IF FOUND THEN
          INSERT INTO classroom_homeroom_teachers (
            classroom_id, school_id, teacher_membership_id,
            created_at, created_by, updated_at, updated_by
          ) VALUES (
            promoted.classroom_id, promoted.school_id, promoted.teacher_membership_id,
            promoted.created_at, promoted.created_by, now(), promoted.updated_by
          );
        END IF;
        RETURN OLD;
      END;
      $promote_additional_homeroom_teacher_after_primary_delete$;

      CREATE TRIGGER trg_promote_additional_homeroom_teacher_after_primary_delete
      AFTER DELETE ON classroom_homeroom_teachers
      FOR EACH ROW EXECUTE FUNCTION promote_additional_homeroom_teacher_after_primary_delete();

      CREATE OR REPLACE VIEW classroom_homeroom_teacher_assignments
      WITH (security_invoker = true)
      AS
      SELECT primary_assignment.classroom_id,
             primary_assignment.school_id,
             primary_assignment.teacher_membership_id,
             TRUE AS is_primary,
             primary_assignment.created_at,
             primary_assignment.created_by,
             primary_assignment.updated_at,
             primary_assignment.updated_by
      FROM classroom_homeroom_teachers primary_assignment
      UNION ALL
      SELECT additional_assignment.classroom_id,
             additional_assignment.school_id,
             additional_assignment.teacher_membership_id,
             FALSE AS is_primary,
             additional_assignment.created_at,
             additional_assignment.created_by,
             additional_assignment.updated_at,
             additional_assignment.updated_by
      FROM classroom_additional_homeroom_teachers additional_assignment;

      ALTER TABLE classroom_additional_homeroom_teachers ENABLE ROW LEVEL SECURITY;

      DO $secure_additional_homeroom_teachers$
      DECLARE role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
        LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON TABLE classroom_additional_homeroom_teachers, classroom_homeroom_teacher_assignments FROM %I',
              role_name
            );
          END IF;
        END LOOP;
      END;
      $secure_additional_homeroom_teachers$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $rollback_guard$
      BEGIN
        IF EXISTS (SELECT 1 FROM classroom_additional_homeroom_teachers) THEN
          RAISE EXCEPTION
            'Refusing rollback: additional homeroom teacher assignments must be removed explicitly first';
        END IF;
      END;
      $rollback_guard$;

      DROP VIEW classroom_homeroom_teacher_assignments;
      DROP TRIGGER trg_promote_additional_homeroom_teacher_after_primary_delete
        ON classroom_homeroom_teachers;
      DROP FUNCTION promote_additional_homeroom_teacher_after_primary_delete();
      DROP TRIGGER trg_remove_promoted_additional_homeroom_teacher
        ON classroom_homeroom_teachers;
      DROP FUNCTION remove_promoted_additional_homeroom_teacher();
      DROP TRIGGER trg_prevent_duplicate_additional_homeroom_teacher
        ON classroom_additional_homeroom_teachers;
      DROP FUNCTION prevent_duplicate_additional_homeroom_teacher();
      DROP TRIGGER trg_classroom_additional_homeroom_teachers_set_updated_at
        ON classroom_additional_homeroom_teachers;
      DROP TABLE classroom_additional_homeroom_teachers;
    `);
  }
}
