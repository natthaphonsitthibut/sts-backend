import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists the latest LINE delivery of an assignment round's link, so the case
 * page can send the link straight to the assigned teacher with one press — the
 * same "ส่งลิงก์ผ่าน LINE" the teacher-link page has (owner, 2026-09-25).
 * Mirrors 20260827210000-AddClassroomLinkLineDelivery: the recipient column
 * records who the message went to and never grants access to the link.
 */
export class AddTaskLinkLineDelivery20260925120000 implements MigrationInterface {
  name = 'AddTaskLinkLineDelivery20260925120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD COLUMN line_delivery_teacher_id BIGINT,
        ADD COLUMN line_delivery_status VARCHAR(16) NOT NULL DEFAULT 'NOT_READY',
        ADD COLUMN line_delivery_failure_code VARCHAR(32),
        ADD COLUMN line_delivery_attempt_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN line_delivery_request_id UUID,
        ADD COLUMN line_delivery_last_attempted_at TIMESTAMPTZ,
        ADD COLUMN line_delivered_at TIMESTAMPTZ,
        ADD CONSTRAINT fk_task_links_line_delivery_teacher
          FOREIGN KEY (line_delivery_teacher_id)
          REFERENCES teachers(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_task_links_line_delivery_status
          CHECK (line_delivery_status IN ('NOT_READY', 'SENDING', 'SENT', 'FAILED')),
        ADD CONSTRAINT chk_task_links_line_delivery_failure
          CHECK (
            line_delivery_failure_code IS NULL
            OR line_delivery_failure_code IN (
              'ASSIGNEE_UNAVAILABLE',
              'MESSAGING_DISABLED',
              'ACCOUNT_NOT_VERIFIED',
              'ACCOUNT_NOT_REACHABLE',
              'PROVIDER_REJECTED',
              'PROVIDER_UNAVAILABLE'
            )
          ),
        ADD CONSTRAINT chk_task_links_line_delivery_attempts
          CHECK (line_delivery_attempt_count >= 0),
        ADD CONSTRAINT chk_task_links_line_delivery_state
          CHECK (
            (
              line_delivery_status = 'NOT_READY'
              AND line_delivered_at IS NULL
              AND (
                line_delivery_failure_code IS NULL
                OR line_delivery_failure_code IN (
                  'ASSIGNEE_UNAVAILABLE',
                  'MESSAGING_DISABLED',
                  'ACCOUNT_NOT_VERIFIED',
                  'ACCOUNT_NOT_REACHABLE'
                )
              )
            )
            OR (
              line_delivery_status = 'SENDING'
              AND line_delivery_teacher_id IS NOT NULL
              AND line_delivery_request_id IS NOT NULL
              AND line_delivery_attempt_count > 0
              AND line_delivery_last_attempted_at IS NOT NULL
              AND line_delivery_failure_code IS NULL
              AND line_delivered_at IS NULL
            )
            OR (
              line_delivery_status = 'SENT'
              AND line_delivery_teacher_id IS NOT NULL
              AND line_delivery_request_id IS NOT NULL
              AND line_delivery_attempt_count > 0
              AND line_delivery_last_attempted_at IS NOT NULL
              AND line_delivery_failure_code IS NULL
              AND line_delivered_at IS NOT NULL
              AND line_delivered_at >= line_delivery_last_attempted_at
            )
            OR (
              line_delivery_status = 'FAILED'
              AND line_delivery_teacher_id IS NOT NULL
              AND line_delivery_request_id IS NOT NULL
              AND line_delivery_attempt_count > 0
              AND line_delivery_last_attempted_at IS NOT NULL
              AND line_delivery_failure_code IN ('PROVIDER_REJECTED', 'PROVIDER_UNAVAILABLE')
              AND line_delivered_at IS NULL
            )
          );

      CREATE INDEX idx_task_links_line_delivery_teacher
        ON task_links (line_delivery_teacher_id)
        WHERE line_delivery_teacher_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $guard_task_link_line_delivery_rollback$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM task_links
          WHERE line_delivery_teacher_id IS NOT NULL
             OR line_delivery_status <> 'NOT_READY'
             OR line_delivery_failure_code IS NOT NULL
             OR line_delivery_attempt_count <> 0
             OR line_delivery_request_id IS NOT NULL
             OR line_delivery_last_attempted_at IS NOT NULL
             OR line_delivered_at IS NOT NULL
        ) THEN
          RAISE EXCEPTION
            'Refusing rollback: task link LINE delivery contains delivery history';
        END IF;
      END;
      $guard_task_link_line_delivery_rollback$;

      DROP INDEX idx_task_links_line_delivery_teacher;
      ALTER TABLE task_links
        DROP CONSTRAINT chk_task_links_line_delivery_state,
        DROP CONSTRAINT chk_task_links_line_delivery_attempts,
        DROP CONSTRAINT chk_task_links_line_delivery_failure,
        DROP CONSTRAINT chk_task_links_line_delivery_status,
        DROP CONSTRAINT fk_task_links_line_delivery_teacher,
        DROP COLUMN line_delivered_at,
        DROP COLUMN line_delivery_last_attempted_at,
        DROP COLUMN line_delivery_request_id,
        DROP COLUMN line_delivery_attempt_count,
        DROP COLUMN line_delivery_failure_code,
        DROP COLUMN line_delivery_status,
        DROP COLUMN line_delivery_teacher_id;
    `);
  }
}
