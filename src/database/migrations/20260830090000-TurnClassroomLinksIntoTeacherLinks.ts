import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the attendance link from a classroom to a teacher.
 *
 * A link per classroom could only ever reach the homeroom teacher, so a subject
 * teacher had no way in. Now that `classroom_subject_teachers` records who
 * teaches what, the link belongs to the teacher and the classrooms follow from
 * their subjects — one standing link per teacher per term, exactly as the
 * classroom link was one per room per term.
 *
 * The link carries no window of its own: an assignment is a separate act with
 * its own dates, and putting the dates here would make the standing link expire
 * with the first assignment issued from it.
 *
 * Existing links are deleted rather than migrated (owner's decision): a link
 * issued to a room cannot be reassigned to a person without guessing which one.
 */
export class TurnClassroomLinksIntoTeacherLinks20260830090000 implements MigrationInterface {
  name = 'TurnClassroomLinksIntoTeacherLinks20260830090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM classroom_attendance_links`);
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        ADD COLUMN teacher_membership_id BIGINT NOT NULL,
        DROP COLUMN classroom_id,
        ADD CONSTRAINT fk_classroom_attendance_links_teacher
          FOREIGN KEY (teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_classroom_attendance_links_teacher_term
        ON classroom_attendance_links (school_term_id, teacher_membership_id)
        WHERE link_status = 'ACTIVE';
      CREATE INDEX idx_classroom_attendance_links_teacher
        ON classroom_attendance_links (teacher_membership_id, school_id, link_status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM classroom_attendance_links`);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_classroom_attendance_links_teacher;
      DROP INDEX IF EXISTS uq_classroom_attendance_links_teacher_term;
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        DROP CONSTRAINT fk_classroom_attendance_links_teacher,
        DROP COLUMN teacher_membership_id,
        ADD COLUMN classroom_id BIGINT NOT NULL,
        ADD CONSTRAINT uq_classroom_attendance_links_classroom UNIQUE (classroom_id),
        ADD CONSTRAINT fk_classroom_attendance_links_classroom
          FOREIGN KEY (classroom_id, school_term_id, school_id)
          REFERENCES school_classrooms(id, school_term_id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX idx_classroom_attendance_links_scope
        ON classroom_attendance_links (
          school_id, school_term_id, link_status, classroom_id
        )
    `);
  }
}
