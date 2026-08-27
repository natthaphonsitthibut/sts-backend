import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records the teacher who opened a case when they came through a classroom
 * link.
 *
 * `cases.created_by` answers "who opened this" for an account, but a teacher
 * working from a classroom link has none — the link session identifies them by
 * their `teachers` row. Without this column a case opened from a link would say
 * only "someone holding this classroom's link", which is the same gap
 * `pii_access_events.actor_teacher_membership_id` and
 * `classroom_student_comments.authored_by_teacher_id` already close for their
 * own tables; this follows them.
 *
 * Nullable and `ON DELETE SET NULL` to match `created_by`: a case outlives the
 * person record it points at, and losing the teacher reference must never
 * delete the case.
 */
export class AddCaseTeacherAuthor20260828140000 implements MigrationInterface {
  name = 'AddCaseTeacherAuthor20260828140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE cases
        ADD COLUMN IF NOT EXISTS created_by_teacher_id BIGINT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE cases
        DROP CONSTRAINT IF EXISTS fk_cases_created_by_teacher
    `);
    await queryRunner.query(`
      ALTER TABLE cases
        ADD CONSTRAINT fk_cases_created_by_teacher
        FOREIGN KEY (created_by_teacher_id)
        REFERENCES teachers (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
    `);
    // Only for "what did this teacher open", which is the report this column
    // exists to answer; the rows without one are the overwhelming majority.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cases_created_by_teacher
        ON cases (created_by_teacher_id, created_at)
        WHERE created_by_teacher_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cases_created_by_teacher`);
    await queryRunner.query(`
      ALTER TABLE cases
        DROP CONSTRAINT IF EXISTS fk_cases_created_by_teacher
    `);
    await queryRunner.query(`
      ALTER TABLE cases
        DROP COLUMN IF EXISTS created_by_teacher_id
    `);
  }
}
