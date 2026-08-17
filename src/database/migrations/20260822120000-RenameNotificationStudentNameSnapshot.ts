import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `notifications.student_name_masked` holds the student's real name, not a
 * masked one.
 *
 * That is deliberate and locked by the owner: a notification is already
 * delivered to a scoped recipient, so the rule is "PII is scope, not stripping".
 * The column name says the opposite, which invites exactly the wrong fix —
 * someone reads `masked`, decides the real name is a leak, and "repairs" a
 * behaviour that was chosen on purpose.
 *
 * What it actually is: the name captured when the notification was written, used
 * only when the case it points at is gone. The read prefers the live join:
 *
 *   COALESCE(notification_case.student_name, n.student_name_snapshot)
 *
 * `snapshot` is the word this schema already uses for a value frozen at write
 * time (`scope_snapshot`, `filter_snapshot`, `source_record_snapshot`), and it
 * keeps the two names in that COALESCE from reading as the same thing.
 */
export class RenameNotificationStudentNameSnapshot20260822120000 implements MigrationInterface {
  name = 'RenameNotificationStudentNameSnapshot20260822120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notifications RENAME COLUMN student_name_masked TO student_name_snapshot
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notifications RENAME COLUMN student_name_snapshot TO student_name_masked
    `);
  }
}
