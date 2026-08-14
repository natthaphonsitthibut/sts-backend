import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Stores the instruction entered while assigning a student follow-up link. */
export class AddTaskLinkAssignmentNote20260813170000 implements MigrationInterface {
  name = 'AddTaskLinkAssignmentNote20260813170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD COLUMN IF NOT EXISTS assignment_note TEXT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE task_links
        DROP CONSTRAINT IF EXISTS chk_task_links_assignment_note_length,
        ADD CONSTRAINT chk_task_links_assignment_note_length
          CHECK (assignment_note IS NULL OR length(assignment_note) <= 2000)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
        DROP CONSTRAINT IF EXISTS chk_task_links_assignment_note_length,
        DROP COLUMN IF EXISTS assignment_note
    `);
  }
}
