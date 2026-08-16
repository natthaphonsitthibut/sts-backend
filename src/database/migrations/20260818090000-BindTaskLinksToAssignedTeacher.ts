import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `task_links` kept only a denormalised `assigned_to_name` / `assigned_to_email`
 * — the shape left over from when a follow-up link could be handed to a guest.
 * Assignment now always picks a teacher from the student's school, so the link
 * records *which* user it was issued to.
 *
 * That binding is what makes AraID verification possible on a task link: the
 * identity check compares the AraID-verified citizen id against the assigned
 * teacher's, exactly like `teacher_access_grants` does. Matching on email would
 * not be safe — `users.email` carries no unique index and duplicates exist.
 *
 * Left nullable: links issued before this migration have no trustworthy user to
 * point at, and they keep working through email OTP.
 *
 * Requiring a citizen id for new teachers is enforced in `CreateTeacherDto`, not
 * as a NOT NULL column: `teachers.citizen_id` already carries a 13-digit CHECK
 * and a unique constraint, but historical/imported rows predate the rule (446/446
 * filled on the live database, only 21/479 on the smoke dataset), so locking the
 * column would break those environments instead of the data-entry path the rule
 * is actually about.
 */
export class BindTaskLinksToAssignedTeacher20260818090000 implements MigrationInterface {
  name = 'BindTaskLinksToAssignedTeacher20260818090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links ADD COLUMN assigned_teacher_user_id INTEGER
    `);
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD CONSTRAINT fk_task_links_assigned_teacher
        FOREIGN KEY (assigned_teacher_user_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX idx_task_links_assigned_teacher
        ON task_links(assigned_teacher_user_id)
        WHERE assigned_teacher_user_id IS NOT NULL
    `);

    // Backfill only where the email resolves to exactly one active account.
    // Anything ambiguous stays null rather than guessing an identity.
    await queryRunner.query(`
      UPDATE task_links link
      SET assigned_teacher_user_id = resolved.id
      FROM (
        SELECT lower(usr.email) AS email, min(usr.id) AS id, count(*) AS matches
        FROM users usr
        WHERE usr.email IS NOT NULL
          AND btrim(usr.email) <> ''
          AND usr.status = 'ACTIVE'
        GROUP BY lower(usr.email)
        HAVING count(*) = 1
      ) resolved
      WHERE link.assigned_teacher_user_id IS NULL
        AND link.assigned_to_email IS NOT NULL
        AND lower(link.assigned_to_email) = resolved.email
        AND EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.id = link.task_id AND t.task_type IN ('VISIT', 'ASSIST')
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_links_assigned_teacher`);
    await queryRunner.query(`
      ALTER TABLE task_links
        DROP CONSTRAINT IF EXISTS fk_task_links_assigned_teacher,
        DROP COLUMN IF EXISTS assigned_teacher_user_id
    `);
  }
}
