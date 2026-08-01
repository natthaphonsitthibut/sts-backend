import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists an append-only teacher comment history for a student in a classroom.
 * Keyed by `person_uuid` (the cross-term identity in `student_person`) rather
 * than `student_term.student_uuid`, which is one row per enrolled term — the
 * history has to survive a student moving to the next term for the future
 * student-profile timeline to assemble. `classroom_id` records where a note was
 * written, so the roster can still show the newest note for that class.
 */
export class AddClassroomStudentComments20260801180000 implements MigrationInterface {
  name = 'AddClassroomStudentComments20260801180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE classroom_student_comments (
        id BIGSERIAL PRIMARY KEY,
        classroom_id BIGINT NOT NULL,
        person_uuid UUID NOT NULL,
        comment_text TEXT NOT NULL,
        authored_by_user_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_classroom_student_comments_classroom
          FOREIGN KEY (classroom_id) REFERENCES school_classrooms(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_student_comments_person
          FOREIGN KEY (person_uuid) REFERENCES student_person(person_uuid)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_student_comments_author
          FOREIGN KEY (authored_by_user_id) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_classroom_student_comments_text
          CHECK (
            comment_text = BTRIM(comment_text)
            AND CHAR_LENGTH(comment_text) BETWEEN 1 AND 2000
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_classroom_student_comments_latest
      ON classroom_student_comments (
        classroom_id,
        person_uuid,
        created_at DESC,
        id DESC
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS classroom_student_comments`);
  }
}
