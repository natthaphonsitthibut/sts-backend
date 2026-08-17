import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes tombstoned case records that can no longer be opened by the current
 * case workflow. Notifications use a RESTRICT FK, so they must be removed
 * first; task, review, and risk-signal descendants are removed by their
 * existing ON DELETE CASCADE constraints.
 */
export class PurgeSoftDeletedCases20260815140000 implements MigrationInterface {
  name = 'PurgeSoftDeletedCases20260815140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM student_observations observation
      USING task_links link, tasks task, cases tracked_case
      WHERE observation.source_task_link_id = link.id
        AND link.task_id = task.id
        AND task.case_id = tracked_case.id
        AND tracked_case.deleted_at IS NOT NULL
    `);

    await queryRunner.query(`
      DELETE FROM task_submissions submission
      USING task_links link, tasks task, cases tracked_case
      WHERE submission.task_link_id = link.id
        AND link.task_id = task.id
        AND task.case_id = tracked_case.id
        AND tracked_case.deleted_at IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE task_links child_link
      SET parent_link_id = NULL, updated_at = now()
      FROM task_links parent_link, tasks parent_task, cases parent_case
      WHERE child_link.parent_link_id = parent_link.id
        AND parent_link.task_id = parent_task.id
        AND parent_task.case_id = parent_case.id
        AND parent_case.deleted_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM tasks child_task
          JOIN cases child_case ON child_case.id = child_task.case_id
          WHERE child_task.id = child_link.task_id
            AND child_case.deleted_at IS NOT NULL
        )
    `);

    await queryRunner.query(`
      DELETE FROM task_links link
      USING tasks task, cases tracked_case
      WHERE link.task_id = task.id
        AND task.case_id = tracked_case.id
        AND tracked_case.deleted_at IS NOT NULL
    `);

    await queryRunner.query(`
      DELETE FROM notifications notification
      USING cases tracked_case
      WHERE notification.case_id = tracked_case.id
        AND tracked_case.deleted_at IS NOT NULL
    `);

    await queryRunner.query(`DELETE FROM cases WHERE deleted_at IS NOT NULL`);
  }

  /** User-requested data purge; deleted rows cannot be reconstructed safely. */
  public async down(): Promise<void> {}
}
