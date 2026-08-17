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
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'notifications'
            AND column_name = 'student_name_masked'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'notifications'
            AND column_name = 'student_name_snapshot'
        ) THEN
          ALTER TABLE notifications
            RENAME COLUMN student_name_masked TO student_name_snapshot;
        ELSIF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'notifications'
            AND column_name = 'student_name_masked'
        ) AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'notifications'
            AND column_name = 'student_name_snapshot'
        ) THEN
          UPDATE notifications
          SET student_name_snapshot = COALESCE(student_name_snapshot, student_name_masked)
          WHERE student_name_snapshot IS NULL;

          ALTER TABLE notifications DROP COLUMN student_name_masked;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notifications RENAME COLUMN student_name_snapshot TO student_name_masked
    `);
  }
}
