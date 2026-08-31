import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A link id is globally unique, but attendance provenance also carries a
 * school. Composite FKs make the school equality a database invariant instead
 * of trusting every insert path to keep the two columns aligned.
 *
 * Both keep the `ON DELETE SET NULL` the single-column references had. A plain
 * `SET NULL` would try to null `school_id` too and hit its NOT NULL, so each
 * names the one column to release — leaving the register and its history in
 * place with the school intact when a link row is removed.
 */
export class EnforceAttendanceLinkSchoolScope20260830170000 implements MigrationInterface {
  name = 'EnforceAttendanceLinkSchoolScope20260830170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        ADD CONSTRAINT uq_classroom_attendance_links_id_school UNIQUE (id, school_id)
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        DROP CONSTRAINT fk_attendance_sessions_classroom_link,
        ADD CONSTRAINT fk_attendance_sessions_classroom_link_school
          FOREIGN KEY (classroom_attendance_link_id, school_id)
          REFERENCES classroom_attendance_links(id, school_id)
          ON DELETE SET NULL (classroom_attendance_link_id) ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_submission_history
        DROP CONSTRAINT fk_attendance_submission_history_classroom_link,
        ADD CONSTRAINT fk_attendance_submission_history_classroom_link_school
          FOREIGN KEY (classroom_attendance_link_id, school_id)
          REFERENCES classroom_attendance_links(id, school_id)
          ON DELETE SET NULL (classroom_attendance_link_id) ON UPDATE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE attendance_submission_history
        DROP CONSTRAINT fk_attendance_submission_history_classroom_link_school,
        ADD CONSTRAINT fk_attendance_submission_history_classroom_link
          FOREIGN KEY (classroom_attendance_link_id) REFERENCES classroom_attendance_links(id)
          ON DELETE SET NULL ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        DROP CONSTRAINT fk_attendance_sessions_classroom_link_school,
        ADD CONSTRAINT fk_attendance_sessions_classroom_link
          FOREIGN KEY (classroom_attendance_link_id) REFERENCES classroom_attendance_links(id)
          ON DELETE SET NULL ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        DROP CONSTRAINT uq_classroom_attendance_links_id_school
    `);
  }
}
