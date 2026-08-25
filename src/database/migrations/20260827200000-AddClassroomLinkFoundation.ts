import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additive foundation for classroom-scoped attendance links.
 *
 * The legacy teacher-access tables remain canonical until their consumers are
 * cut over. A compatibility trigger mirrors active HOMEROOM assignments into
 * the new room-owned relation so the expand phase cannot drift while both
 * contracts coexist.
 */
export class AddClassroomLinkFoundation20260827200000 implements MigrationInterface {
  name = 'AddClassroomLinkFoundation20260827200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE teacher_external_identities (
        id BIGSERIAL PRIMARY KEY,
        teacher_id BIGINT NOT NULL,
        provider VARCHAR(16) NOT NULL,
        provider_subject VARCHAR(255) NOT NULL,
        normalized_email VARCHAR(255),
        verified_at TIMESTAMPTZ NOT NULL,
        last_authenticated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER,
        CONSTRAINT uq_teacher_external_identities_provider_subject
          UNIQUE (provider, provider_subject),
        CONSTRAINT uq_teacher_external_identities_teacher_provider
          UNIQUE (teacher_id, provider),
        CONSTRAINT fk_teacher_external_identities_teacher
          FOREIGN KEY (teacher_id) REFERENCES teachers(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_external_identities_created_by
          FOREIGN KEY (created_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_external_identities_updated_by
          FOREIGN KEY (updated_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_external_identities_deleted_by
          FOREIGN KEY (deleted_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_teacher_external_identities_provider
          CHECK (provider IN ('GOOGLE', 'THAID')),
        CONSTRAINT chk_teacher_external_identities_provider_subject
          CHECK (
            provider_subject = btrim(provider_subject)
            AND char_length(provider_subject) BETWEEN 1 AND 255
          ),
        CONSTRAINT chk_teacher_external_identities_email
          CHECK (
            (
              provider = 'GOOGLE'
              AND normalized_email IS NOT NULL
              AND normalized_email = lower(btrim(normalized_email))
              AND position('@' IN normalized_email) > 1
            )
            OR (provider = 'THAID' AND normalized_email IS NULL)
          ),
        CONSTRAINT chk_teacher_external_identities_authentication_time
          CHECK (
            last_authenticated_at IS NULL
            OR last_authenticated_at >= verified_at
          ),
        CONSTRAINT chk_teacher_external_identities_deletion_actor
          CHECK (deleted_at IS NOT NULL OR deleted_by IS NULL)
      );

      CREATE INDEX idx_teacher_external_identities_google_email
        ON teacher_external_identities (normalized_email)
        WHERE provider = 'GOOGLE'
          AND normalized_email IS NOT NULL
          AND deleted_at IS NULL;
      CREATE INDEX idx_teacher_external_identities_created_by
        ON teacher_external_identities (created_by)
        WHERE created_by IS NOT NULL;
      CREATE INDEX idx_teacher_external_identities_updated_by
        ON teacher_external_identities (updated_by)
        WHERE updated_by IS NOT NULL;
      CREATE INDEX idx_teacher_external_identities_deleted_by
        ON teacher_external_identities (deleted_by)
        WHERE deleted_by IS NOT NULL;

      CREATE TRIGGER trg_teacher_external_identities_set_updated_at
      BEFORE UPDATE ON teacher_external_identities
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      CREATE TABLE classroom_homeroom_teachers (
        classroom_id BIGINT PRIMARY KEY,
        school_id INTEGER NOT NULL,
        teacher_membership_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER,
        CONSTRAINT fk_classroom_homeroom_teachers_classroom
          FOREIGN KEY (classroom_id, school_id)
          REFERENCES school_classrooms(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_homeroom_teachers_membership
          FOREIGN KEY (teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_homeroom_teachers_created_by
          FOREIGN KEY (created_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_homeroom_teachers_updated_by
          FOREIGN KEY (updated_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE
      );

      CREATE INDEX idx_classroom_homeroom_teachers_membership
        ON classroom_homeroom_teachers (teacher_membership_id, classroom_id);
      CREATE INDEX idx_classroom_homeroom_teachers_created_by
        ON classroom_homeroom_teachers (created_by)
        WHERE created_by IS NOT NULL;
      CREATE INDEX idx_classroom_homeroom_teachers_updated_by
        ON classroom_homeroom_teachers (updated_by)
        WHERE updated_by IS NOT NULL;

      CREATE TRIGGER trg_classroom_homeroom_teachers_set_updated_at
      BEFORE UPDATE ON classroom_homeroom_teachers
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      CREATE TABLE classroom_attendance_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id INTEGER NOT NULL,
        school_term_id BIGINT NOT NULL,
        classroom_id BIGINT NOT NULL,
        token_hash CHAR(64) NOT NULL,
        token_encrypted TEXT NOT NULL,
        link_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        rotated_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER,
        CONSTRAINT uq_classroom_attendance_links_token_hash UNIQUE (token_hash),
        CONSTRAINT uq_classroom_attendance_links_classroom UNIQUE (classroom_id),
        CONSTRAINT fk_classroom_attendance_links_classroom
          FOREIGN KEY (classroom_id, school_term_id, school_id)
          REFERENCES school_classrooms(id, school_term_id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_attendance_links_created_by
          FOREIGN KEY (created_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_attendance_links_updated_by
          FOREIGN KEY (updated_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_classroom_attendance_links_token_hash
          CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT chk_classroom_attendance_links_encrypted_token
          CHECK (char_length(btrim(token_encrypted)) > 0),
        CONSTRAINT chk_classroom_attendance_links_status
          CHECK (link_status IN ('ACTIVE', 'INACTIVE')),
        CONSTRAINT chk_classroom_attendance_links_rotated_at
          CHECK (rotated_at IS NULL OR rotated_at >= issued_at),
        CONSTRAINT chk_classroom_attendance_links_last_used_at
          CHECK (last_used_at IS NULL OR last_used_at >= issued_at)
      );

      CREATE INDEX idx_classroom_attendance_links_scope
        ON classroom_attendance_links (
          school_id,
          school_term_id,
          link_status,
          classroom_id
        );
      CREATE INDEX idx_classroom_attendance_links_created_by
        ON classroom_attendance_links (created_by)
        WHERE created_by IS NOT NULL;
      CREATE INDEX idx_classroom_attendance_links_updated_by
        ON classroom_attendance_links (updated_by)
        WHERE updated_by IS NOT NULL;

      CREATE TRIGGER trg_classroom_attendance_links_set_updated_at
      BEFORE UPDATE ON classroom_attendance_links
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      ALTER TABLE teacher_external_identities ENABLE ROW LEVEL SECURITY;
      ALTER TABLE classroom_homeroom_teachers ENABLE ROW LEVEL SECURITY;
      ALTER TABLE classroom_attendance_links ENABLE ROW LEVEL SECURITY;
    `);

    await queryRunner.query(`
      DO $secure_classroom_link_tables$
      DECLARE
        role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
        LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON TABLE teacher_external_identities, classroom_homeroom_teachers, classroom_attendance_links FROM %I',
              role_name
            );
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON SEQUENCE teacher_external_identities_id_seq FROM %I',
              role_name
            );
          END IF;
        END LOOP;
      END;
      $secure_classroom_link_tables$;
    `);

    await queryRunner.query(`
      DO $validate_homeroom_source$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM school_classrooms classroom
          LEFT JOIN classroom_teacher_assignments assignment
            ON assignment.classroom_id = classroom.id
           AND assignment.school_id = classroom.school_id
           AND assignment.assignment_kind = 'HOMEROOM'
           AND assignment.assignment_status = 'ACTIVE'
           AND assignment.deleted_at IS NULL
          WHERE classroom.classroom_status = 'ACTIVE'
            AND classroom.deleted_at IS NULL
          GROUP BY classroom.id
          HAVING count(assignment.id) <> 1
        ) THEN
          RAISE EXCEPTION
            'Cannot backfill classroom_homeroom_teachers: every active classroom must have exactly one active HOMEROOM assignment';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM classroom_teacher_assignments assignment
          LEFT JOIN school_classrooms classroom
            ON classroom.id = assignment.classroom_id
           AND classroom.school_id = assignment.school_id
          LEFT JOIN school_teacher_memberships membership
            ON membership.id = assignment.teacher_membership_id
           AND membership.school_id = assignment.school_id
          LEFT JOIN teachers teacher ON teacher.id = membership.teacher_id
          WHERE assignment.assignment_kind = 'HOMEROOM'
            AND assignment.assignment_status = 'ACTIVE'
            AND assignment.deleted_at IS NULL
            AND (
              classroom.id IS NULL
              OR classroom.classroom_status <> 'ACTIVE'
              OR classroom.deleted_at IS NOT NULL
              OR membership.id IS NULL
              OR membership.membership_status <> 'ACTIVE'
              OR membership.deleted_at IS NOT NULL
              OR teacher.id IS NULL
              OR teacher.teacher_status <> 'ACTIVE'
              OR teacher.deleted_at IS NOT NULL
            )
        ) THEN
          RAISE EXCEPTION
            'Cannot backfill classroom_homeroom_teachers: active HOMEROOM source has an inactive or invalid classroom, membership, or teacher';
        END IF;
      END;
      $validate_homeroom_source$;

      INSERT INTO classroom_homeroom_teachers (
        classroom_id,
        school_id,
        teacher_membership_id,
        created_at,
        created_by,
        updated_at,
        updated_by
      )
      SELECT
        assignment.classroom_id,
        assignment.school_id,
        assignment.teacher_membership_id,
        assignment.created_at,
        assignment.created_by,
        assignment.updated_at,
        assignment.updated_by
      FROM classroom_teacher_assignments assignment
      WHERE assignment.assignment_kind = 'HOMEROOM'
        AND assignment.assignment_status = 'ACTIVE'
        AND assignment.deleted_at IS NULL;

      DO $reconcile_homeroom_backfill$
      BEGIN
        IF EXISTS (
          SELECT
            coalesce(source.classroom_id, target.classroom_id) AS classroom_id
          FROM (
            SELECT classroom_id, school_id, teacher_membership_id
            FROM classroom_teacher_assignments
            WHERE assignment_kind = 'HOMEROOM'
              AND assignment_status = 'ACTIVE'
              AND deleted_at IS NULL
          ) source
          FULL JOIN classroom_homeroom_teachers target
            ON target.classroom_id = source.classroom_id
           AND target.school_id = source.school_id
           AND target.teacher_membership_id = source.teacher_membership_id
          WHERE source.classroom_id IS NULL OR target.classroom_id IS NULL
        ) THEN
          RAISE EXCEPTION
            'classroom_homeroom_teachers reconciliation failed after backfill';
        END IF;
      END;
      $reconcile_homeroom_backfill$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION sync_classroom_homeroom_teacher(
        target_classroom_id BIGINT
      )
      RETURNS VOID
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = public, pg_temp
      AS $sync_classroom_homeroom_teacher$
      BEGIN
        INSERT INTO classroom_homeroom_teachers (
          classroom_id,
          school_id,
          teacher_membership_id,
          created_at,
          created_by,
          updated_at,
          updated_by
        )
        SELECT
          assignment.classroom_id,
          assignment.school_id,
          assignment.teacher_membership_id,
          assignment.created_at,
          assignment.created_by,
          assignment.updated_at,
          assignment.updated_by
        FROM classroom_teacher_assignments assignment
        WHERE assignment.classroom_id = target_classroom_id
          AND assignment.assignment_kind = 'HOMEROOM'
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.deleted_at IS NULL
        ON CONFLICT (classroom_id) DO UPDATE
        SET school_id = EXCLUDED.school_id,
            teacher_membership_id = EXCLUDED.teacher_membership_id,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by;

        IF NOT FOUND THEN
          DELETE FROM classroom_homeroom_teachers
          WHERE classroom_id = target_classroom_id;
        END IF;
      END;
      $sync_classroom_homeroom_teacher$;

      CREATE OR REPLACE FUNCTION sync_classroom_homeroom_teacher_from_assignment()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = public, pg_temp
      AS $sync_classroom_homeroom_teacher_from_assignment$
      BEGIN
        IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.assignment_kind = 'HOMEROOM' THEN
          PERFORM sync_classroom_homeroom_teacher(OLD.classroom_id);
        END IF;

        IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.assignment_kind = 'HOMEROOM' THEN
          PERFORM sync_classroom_homeroom_teacher(NEW.classroom_id);
        END IF;

        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $sync_classroom_homeroom_teacher_from_assignment$;

      CREATE TRIGGER trg_sync_classroom_homeroom_teacher
      AFTER INSERT OR UPDATE OR DELETE ON classroom_teacher_assignments
      FOR EACH ROW EXECUTE FUNCTION sync_classroom_homeroom_teacher_from_assignment();

      REVOKE ALL ON FUNCTION sync_classroom_homeroom_teacher(BIGINT) FROM PUBLIC;
      REVOKE ALL ON FUNCTION sync_classroom_homeroom_teacher_from_assignment() FROM PUBLIC;

      DO $secure_classroom_link_functions$
      DECLARE
        role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
        LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
              'REVOKE ALL ON FUNCTION sync_classroom_homeroom_teacher(BIGINT) FROM %I',
              role_name
            );
            EXECUTE format(
              'REVOKE ALL ON FUNCTION sync_classroom_homeroom_teacher_from_assignment() FROM %I',
              role_name
            );
          END IF;
        END LOOP;
      END;
      $secure_classroom_link_functions$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $guard_classroom_link_foundation_rollback$
      BEGIN
        IF EXISTS (SELECT 1 FROM teacher_external_identities) THEN
          RAISE EXCEPTION
            'Refusing rollback: teacher_external_identities contains consumer data';
        END IF;

        IF EXISTS (SELECT 1 FROM classroom_attendance_links) THEN
          RAISE EXCEPTION
            'Refusing rollback: classroom_attendance_links contains consumer data';
        END IF;

        IF EXISTS (
          SELECT
            coalesce(source.classroom_id, target.classroom_id) AS classroom_id
          FROM (
            SELECT classroom_id, school_id, teacher_membership_id
            FROM classroom_teacher_assignments
            WHERE assignment_kind = 'HOMEROOM'
              AND assignment_status = 'ACTIVE'
              AND deleted_at IS NULL
          ) source
          FULL JOIN classroom_homeroom_teachers target
            ON target.classroom_id = source.classroom_id
           AND target.school_id = source.school_id
           AND target.teacher_membership_id = source.teacher_membership_id
          WHERE source.classroom_id IS NULL OR target.classroom_id IS NULL
        ) THEN
          RAISE EXCEPTION
            'Refusing rollback: classroom_homeroom_teachers no longer matches the legacy HOMEROOM source';
        END IF;
      END;
      $guard_classroom_link_foundation_rollback$;

      DROP TRIGGER IF EXISTS trg_sync_classroom_homeroom_teacher
        ON classroom_teacher_assignments;
      DROP FUNCTION IF EXISTS sync_classroom_homeroom_teacher_from_assignment();
      DROP FUNCTION IF EXISTS sync_classroom_homeroom_teacher(BIGINT, INTEGER);
      DROP FUNCTION IF EXISTS sync_classroom_homeroom_teacher(BIGINT);

      DROP TABLE classroom_attendance_links;
      DROP TABLE classroom_homeroom_teachers;
      DROP TABLE teacher_external_identities;
    `);
  }
}
