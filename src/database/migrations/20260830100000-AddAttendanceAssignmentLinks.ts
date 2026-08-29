import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A second kind of attendance link: an assignment to cover one classroom for a
 * stretch of days.
 *
 * The standing link belongs to a teacher and answers "these are my rooms". An
 * assignment belongs to a room and names nobody — it is handed round until
 * someone picks it up, and whoever does proves they teach at the school on the
 * way in.
 *
 * Both live in this table rather than a table of their own, because everything
 * that happens after the token is the same: the same lookup, the same Google or
 * AraID challenge, the same session cookie. A separate table would have meant a
 * second copy of that entry path, and two copies of an identity check is how
 * one of them ends up weaker than the other.
 *
 * `teacher_membership_id IS NULL` is what makes a row an assignment, so the
 * one-live-link-per-teacher rule now applies only to the standing links.
 */
export class AddAttendanceAssignmentLinks20260830100000 implements MigrationInterface {
  name = 'AddAttendanceAssignmentLinks20260830100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        ALTER COLUMN teacher_membership_id DROP NOT NULL,
        ADD COLUMN assigned_classroom_id BIGINT,
        ADD COLUMN opens_at TIMESTAMPTZ,
        ADD COLUMN expires_at TIMESTAMPTZ,
        ADD COLUMN assignment_note VARCHAR(500),
        ADD CONSTRAINT fk_classroom_attendance_links_assigned_classroom
          FOREIGN KEY (assigned_classroom_id, school_id)
          REFERENCES school_classrooms(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        -- Exactly one of the two shapes, never both and never neither.
        ADD CONSTRAINT chk_classroom_attendance_links_kind CHECK (
          (teacher_membership_id IS NOT NULL AND assigned_classroom_id IS NULL
           AND expires_at IS NULL AND opens_at IS NULL)
          OR
          (teacher_membership_id IS NULL AND assigned_classroom_id IS NOT NULL
           AND expires_at IS NOT NULL)
        ),
        ADD CONSTRAINT chk_classroom_attendance_links_window
          CHECK (opens_at IS NULL OR (expires_at IS NOT NULL AND opens_at < expires_at)),
        ADD CONSTRAINT chk_classroom_attendance_links_note
          CHECK (assignment_note IS NULL OR length(btrim(assignment_note)) BETWEEN 1 AND 500)
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_classroom_attendance_links_teacher_term;
      CREATE UNIQUE INDEX uq_classroom_attendance_links_teacher_term
        ON classroom_attendance_links (school_term_id, teacher_membership_id)
        WHERE link_status = 'ACTIVE' AND teacher_membership_id IS NOT NULL;
      CREATE INDEX idx_classroom_attendance_links_assignment
        ON classroom_attendance_links (assigned_classroom_id, school_id, expires_at DESC)
        WHERE assigned_classroom_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM classroom_attendance_links WHERE assigned_classroom_id IS NOT NULL`,
    );
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_classroom_attendance_links_assignment;
      DROP INDEX IF EXISTS uq_classroom_attendance_links_teacher_term;
      CREATE UNIQUE INDEX uq_classroom_attendance_links_teacher_term
        ON classroom_attendance_links (school_term_id, teacher_membership_id)
        WHERE link_status = 'ACTIVE';
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        DROP CONSTRAINT chk_classroom_attendance_links_note,
        DROP CONSTRAINT chk_classroom_attendance_links_window,
        DROP CONSTRAINT chk_classroom_attendance_links_kind,
        DROP CONSTRAINT fk_classroom_attendance_links_assigned_classroom,
        DROP COLUMN assignment_note,
        DROP COLUMN expires_at,
        DROP COLUMN opens_at,
        DROP COLUMN assigned_classroom_id,
        ALTER COLUMN teacher_membership_id SET NOT NULL
    `);
  }
}
