import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ปิดการเฝ้าระวัง (owner, 2026-10-15): a เฝ้าระวัง student is decided either
 * by opening a case (ติดตาม → เสี่ยง, the existing case flow) or by closing the
 * watch, which returns the student to ปกติ without a case. Only the closing
 * needs its own record; a follow-up is the case itself.
 *
 * A closure resets the teacher-comment count the same way a closed case does:
 * comments written before it no longer make the student เฝ้าระวัง, a new one
 * after it does. Rows are append-only history — a mistaken close is undone by
 * opening a case or by the next comment, never by editing the row.
 *
 * `student_uuid` is the enrollment the student was in when closed (the term
 * context); the student it follows is `student_term.person_uuid`.
 */
export class AddStudentWatchClosures20261015120000 implements MigrationInterface {
  name = 'AddStudentWatchClosures20261015120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE student_watch_closures (
        id SERIAL PRIMARY KEY,
        student_uuid UUID NOT NULL,
        note TEXT,
        closed_by_user_id INTEGER NOT NULL,
        closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_student_watch_closures_student
          FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_watch_closures_closed_by
          FOREIGN KEY (closed_by_user_id) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_student_watch_closures_note
          CHECK (note IS NULL OR (length(btrim(note)) BETWEEN 1 AND 1000))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_student_watch_closures_student
        ON student_watch_closures (student_uuid, closed_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE student_watch_closures`);
  }
}
