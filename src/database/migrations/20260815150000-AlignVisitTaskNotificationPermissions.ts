import type { MigrationInterface, QueryRunner } from 'typeorm';

const VISIT_TASK_NOTIFICATION_CODES = ['TASK_DELEGATED', 'TASK_SUBMITTED'] as const;

/** Home-visit assignment and report review now belong to the case-review flow. */
export class AlignVisitTaskNotificationPermissions20260815150000 implements MigrationInterface {
  name = 'AlignVisitTaskNotificationPermissions20260815150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE notification_types SET required_permission = 'review-cases' WHERE code = ANY($1::varchar[])`,
      [VISIT_TASK_NOTIFICATION_CODES],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE notification_types SET required_permission = 'attendance-dashboard' WHERE code = ANY($1::varchar[])`,
      [VISIT_TASK_NOTIFICATION_CODES],
    );
  }
}
