import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records the explicit P6 assignment that consumes an approved P4 follow-up
 * request. Review remains non-mutating; the nullable assignment fields are
 * populated only when an authorized user creates the visit task.
 */
export class LinkFollowUpRequestsToAssignedTasks20260714290000 implements MigrationInterface {
  name = 'LinkFollowUpRequestsToAssignedTasks20260714290000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_follow_up_requests
        ADD COLUMN assigned_task_id UUID,
        ADD COLUMN assigned_by INTEGER,
        ADD COLUMN assigned_at TIMESTAMPTZ,
        ADD CONSTRAINT fk_follow_up_requests_assigned_task
          FOREIGN KEY (assigned_task_id) REFERENCES tasks(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT fk_follow_up_requests_assigned_by
          FOREIGN KEY (assigned_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_follow_up_requests_assignment_state
          CHECK (
            (assigned_task_id IS NULL AND assigned_by IS NULL AND assigned_at IS NULL)
            OR
            (status = 'APPROVE_AND_ASSIGN'
              AND assigned_task_id IS NOT NULL
              AND assigned_by IS NOT NULL
              AND assigned_at IS NOT NULL)
          );

      CREATE UNIQUE INDEX uq_follow_up_requests_assigned_task
        ON student_follow_up_requests (assigned_task_id)
        WHERE assigned_task_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_follow_up_requests_assigned_task;
      ALTER TABLE student_follow_up_requests
        DROP CONSTRAINT IF EXISTS chk_follow_up_requests_assignment_state,
        DROP CONSTRAINT IF EXISTS fk_follow_up_requests_assigned_by,
        DROP CONSTRAINT IF EXISTS fk_follow_up_requests_assigned_task,
        DROP COLUMN IF EXISTS assigned_at,
        DROP COLUMN IF EXISTS assigned_by,
        DROP COLUMN IF EXISTS assigned_task_id;
    `);
  }
}
