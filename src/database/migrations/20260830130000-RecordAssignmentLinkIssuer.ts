import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Who handed a lesson on.
 *
 * An assignment link names no recipient by design, but it does have an author,
 * and until now that author was recorded only in the audit metadata of the
 * `CLASSROOM_ATTENDANCE_ASSIGNMENT_CREATE` row. That is the right place to
 * answer "what happened", and the wrong place to answer "which of these links
 * are mine" — the screen where a teacher manages what they issued cannot read
 * the audit trail on every page load, and a teacher standing in a link has no
 * account for `created_by` to hold.
 *
 * So the issuer moves onto the row itself, beside `created_by` rather than
 * instead of it: a link issued from the admin screen has an account behind it,
 * one issued from a teacher's own link has a membership, and either may be
 * null for the other kind.
 *
 * The composite FK carries `school_id` the way every other membership
 * reference in this table does, which is what keeps a membership from one
 * school being written onto another school's link. `ON DELETE RESTRICT`
 * matches the standing-link FK next to it: memberships are retired by status,
 * not deleted, so there is no delete to cascade — and if one ever were, losing
 * the record of who issued a live link is not something to do silently.
 */
export class RecordAssignmentLinkIssuer20260830130000 implements MigrationInterface {
  name = 'RecordAssignmentLinkIssuer20260830130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        ADD COLUMN issued_by_teacher_membership_id BIGINT,
        ADD CONSTRAINT fk_classroom_attendance_links_issued_by
          FOREIGN KEY (issued_by_teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        -- Only an assignment is issued by someone; a standing link belongs to
        -- the teacher it names, which teacher_membership_id already says.
        ADD CONSTRAINT chk_classroom_attendance_links_issued_by CHECK (
          issued_by_teacher_membership_id IS NULL
          OR assigned_classroom_subject_id IS NOT NULL
        )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_classroom_attendance_links_issued_by
        ON classroom_attendance_links (
          issued_by_teacher_membership_id,
          school_term_id,
          link_status
        )
        WHERE issued_by_teacher_membership_id IS NOT NULL
    `);
    // Everything issued from a link so far is recoverable: the create action
    // wrote the membership into its metadata. Guarded by the same school, so a
    // metadata value that no longer belongs here is left null rather than
    // written across schools.
    await queryRunner.query(`
      UPDATE classroom_attendance_links link
      SET issued_by_teacher_membership_id = membership.id
      FROM audit_log entry
      JOIN school_teacher_memberships membership
        ON membership.id = CASE
          WHEN entry.metadata ->> 'issuedByTeacherMembershipId' ~ '^[0-9]+$'
            THEN (entry.metadata ->> 'issuedByTeacherMembershipId')::bigint
          ELSE NULL
        END
      WHERE entry.target_type = 'classroom_attendance_links'
        AND entry.action = 'CLASSROOM_ATTENDANCE_ASSIGNMENT_CREATE'
        AND entry.target_id = link.id::text
        AND entry.metadata ->> 'issuedByTeacherMembershipId' ~ '^[0-9]+$'
        AND membership.school_id = link.school_id
        AND link.assigned_classroom_subject_id IS NOT NULL
        AND link.issued_by_teacher_membership_id IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_classroom_attendance_links_issued_by
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        DROP CONSTRAINT chk_classroom_attendance_links_issued_by,
        DROP CONSTRAINT fk_classroom_attendance_links_issued_by,
        DROP COLUMN issued_by_teacher_membership_id
    `);
  }
}
