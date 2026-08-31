import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Keeps link-issued attendance assignments attached to the standing teacher
 * link that created them. The token may rotate on that same parent row without
 * affecting children; deactivating the parent can now close its live children
 * deterministically without guessing from the current teacher membership.
 */
export class LinkAssignmentsToTeacherLink20260830150000 implements MigrationInterface {
  name = 'LinkAssignmentsToTeacherLink20260830150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        ADD COLUMN source_teacher_link_id UUID,
        ADD CONSTRAINT uq_classroom_attendance_links_id_scope
          UNIQUE (id, school_id, school_term_id)
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        ADD CONSTRAINT fk_classroom_attendance_links_source_teacher_link
          FOREIGN KEY (source_teacher_link_id, school_id, school_term_id)
          REFERENCES classroom_attendance_links(id, school_id, school_term_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_classroom_attendance_links_source_teacher_link CHECK (
          source_teacher_link_id IS NULL
          OR (
            source_teacher_link_id <> id
            AND teacher_membership_id IS NULL
            AND assigned_classroom_subject_id IS NOT NULL
          )
        )
    `);
    await queryRunner.query(`
      UPDATE classroom_attendance_links child
      SET source_teacher_link_id = (
        SELECT parent.id
        FROM classroom_attendance_links parent
        WHERE parent.school_id = child.school_id
          AND parent.school_term_id = child.school_term_id
          AND parent.teacher_membership_id = child.issued_by_teacher_membership_id
          AND parent.assigned_classroom_subject_id IS NULL
        ORDER BY
          CASE WHEN parent.issued_at <= child.issued_at THEN 0 ELSE 1 END,
          parent.issued_at DESC,
          parent.id DESC
        LIMIT 1
      )
      WHERE child.assigned_classroom_subject_id IS NOT NULL
        AND child.issued_by_teacher_membership_id IS NOT NULL
        AND child.source_teacher_link_id IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_classroom_attendance_links_source_teacher_link
        ON classroom_attendance_links (source_teacher_link_id, link_status, issued_at)
        WHERE source_teacher_link_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_classroom_attendance_links_source_teacher_link
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        DROP CONSTRAINT fk_classroom_attendance_links_source_teacher_link,
        DROP CONSTRAINT chk_classroom_attendance_links_source_teacher_link,
        DROP CONSTRAINT uq_classroom_attendance_links_id_scope,
        DROP COLUMN source_teacher_link_id
    `);
  }
}
