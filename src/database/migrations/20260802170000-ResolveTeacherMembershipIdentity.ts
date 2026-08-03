import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expand-phase compatibility shim for the teacher identity split.
 *
 * `AddTeacherIdentity20260802160000` made `school_teacher_memberships.teacher_id`
 * NOT NULL, but every existing writer (teacher roster import, seeds) still
 * inserts memberships keyed only by `teacher_user_id`. Until those paths are
 * moved onto teacher identity — step 5 of the agreed plan — this trigger keeps
 * them working by resolving, and when necessary creating, the matching
 * `teachers` row.
 *
 * Mirrors the existing `resolve_student_term_structure_refs` /
 * `resolve_timetable_slot_classroom` triggers. The contract migration that drops
 * `teacher_user_id` drops this trigger with it.
 */
export class ResolveTeacherMembershipIdentity20260802170000 implements MigrationInterface {
  name = 'ResolveTeacherMembershipIdentity20260802170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION resolve_school_teacher_membership_identity()
      RETURNS trigger AS $$
      DECLARE
        source_user users%ROWTYPE;
      BEGIN
        IF NEW.teacher_id IS NOT NULL THEN
          RETURN NEW;
        END IF;

        IF NEW.teacher_user_id IS NULL THEN
          RAISE EXCEPTION 'teacher membership needs either teacher_id or teacher_user_id'
            USING ERRCODE = '23502';
        END IF;

        SELECT teacher.id
        INTO NEW.teacher_id
        FROM teachers teacher
        WHERE teacher.linked_user_id = NEW.teacher_user_id
          AND teacher.deleted_at IS NULL
        LIMIT 1;

        IF NEW.teacher_id IS NOT NULL THEN
          RETURN NEW;
        END IF;

        SELECT * INTO source_user FROM users WHERE id = NEW.teacher_user_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'teacher account % does not exist', NEW.teacher_user_id
            USING ERRCODE = '23503';
        END IF;

        -- Same normalisation as the original backfill: copy only well-formed
        -- contact values so the teachers CHECK constraints always hold.
        INSERT INTO teachers (
          first_name,
          last_name,
          citizen_id,
          phone,
          email,
          line_id,
          teacher_status,
          linked_user_id
        )
        VALUES (
          COALESCE(NULLIF(btrim(source_user."FirstName"), ''), source_user.username),
          COALESCE(NULLIF(btrim(source_user."LastName"), ''), '-'),
          CASE
            WHEN btrim(COALESCE(source_user."PersonID_Onec", '')) ~ '^[0-9]{13}$'
              AND NOT EXISTS (
                SELECT 1 FROM teachers existing
                WHERE existing.citizen_id = btrim(source_user."PersonID_Onec")
                  AND existing.deleted_at IS NULL
              )
            THEN btrim(source_user."PersonID_Onec")
          END,
          CASE
            WHEN btrim(COALESCE(source_user.phone, '')) ~ '^[0-9]{9,10}$'
            THEN btrim(source_user.phone)
          END,
          CASE
            WHEN position('@' IN btrim(COALESCE(source_user.email, ''))) > 1
            THEN btrim(source_user.email)
          END,
          NULLIF(btrim(COALESCE(source_user.line_id, '')), ''),
          CASE WHEN source_user.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
          source_user.id
        )
        RETURNING id INTO NEW.teacher_id;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_school_teacher_memberships_resolve_identity
        ON school_teacher_memberships;
      CREATE TRIGGER trg_school_teacher_memberships_resolve_identity
        BEFORE INSERT OR UPDATE OF teacher_user_id, teacher_id
        ON school_teacher_memberships
        FOR EACH ROW EXECUTE FUNCTION resolve_school_teacher_membership_identity();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_school_teacher_memberships_resolve_identity
        ON school_teacher_memberships;
      DROP FUNCTION IF EXISTS resolve_school_teacher_membership_identity;
    `);
  }
}
