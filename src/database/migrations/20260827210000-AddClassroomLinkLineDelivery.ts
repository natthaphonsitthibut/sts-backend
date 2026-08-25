import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists the latest LINE delivery state on the classroom-owned link.
 * The recipient is a school membership used only for delivery; it never grants
 * access to the link and is deliberately separate from external link sessions.
 */
export class AddClassroomLinkLineDelivery20260827210000 implements MigrationInterface {
  name = 'AddClassroomLinkLineDelivery20260827210000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        ADD COLUMN line_delivery_teacher_membership_id BIGINT,
        ADD COLUMN line_delivery_status VARCHAR(16) NOT NULL DEFAULT 'NOT_READY',
        ADD COLUMN line_delivery_failure_code VARCHAR(32),
        ADD COLUMN line_delivery_attempt_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN line_delivery_request_id UUID,
        ADD COLUMN line_delivery_last_attempted_at TIMESTAMPTZ,
        ADD COLUMN line_delivered_at TIMESTAMPTZ,
        ADD CONSTRAINT fk_classroom_attendance_links_line_delivery_membership
          FOREIGN KEY (line_delivery_teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_classroom_attendance_links_line_delivery_status
          CHECK (
            line_delivery_status IN (
              'NOT_READY', 'SENDING', 'SENT', 'FAILED', 'NEEDS_RESEND'
            )
          ),
        ADD CONSTRAINT chk_classroom_attendance_links_line_delivery_failure
          CHECK (
            line_delivery_failure_code IS NULL
            OR line_delivery_failure_code IN (
              'HOMEROOM_UNAVAILABLE',
              'MESSAGING_DISABLED',
              'ACCOUNT_NOT_VERIFIED',
              'ACCOUNT_NOT_REACHABLE',
              'PROVIDER_REJECTED',
              'PROVIDER_UNAVAILABLE'
            )
          ),
        ADD CONSTRAINT chk_classroom_attendance_links_line_delivery_attempts
          CHECK (line_delivery_attempt_count >= 0),
        ADD CONSTRAINT chk_classroom_attendance_links_line_delivery_state
          CHECK (
            (
              line_delivery_status = 'NOT_READY'
              AND line_delivered_at IS NULL
              AND (
                line_delivery_failure_code IS NULL
                OR line_delivery_failure_code IN (
                  'HOMEROOM_UNAVAILABLE',
                  'MESSAGING_DISABLED',
                  'ACCOUNT_NOT_VERIFIED',
                  'ACCOUNT_NOT_REACHABLE'
                )
              )
            )
            OR (
              line_delivery_status = 'NEEDS_RESEND'
              AND line_delivery_teacher_membership_id IS NOT NULL
              AND line_delivery_failure_code IS NULL
              AND line_delivered_at IS NULL
            )
            OR (
              line_delivery_status = 'SENDING'
              AND line_delivery_teacher_membership_id IS NOT NULL
              AND line_delivery_request_id IS NOT NULL
              AND line_delivery_attempt_count > 0
              AND line_delivery_last_attempted_at IS NOT NULL
              AND line_delivery_failure_code IS NULL
              AND line_delivered_at IS NULL
            )
            OR (
              line_delivery_status = 'SENT'
              AND line_delivery_teacher_membership_id IS NOT NULL
              AND line_delivery_request_id IS NOT NULL
              AND line_delivery_attempt_count > 0
              AND line_delivery_last_attempted_at IS NOT NULL
              AND line_delivery_failure_code IS NULL
              AND line_delivered_at IS NOT NULL
              AND line_delivered_at >= line_delivery_last_attempted_at
            )
            OR (
              line_delivery_status = 'FAILED'
              AND line_delivery_teacher_membership_id IS NOT NULL
              AND line_delivery_request_id IS NOT NULL
              AND line_delivery_attempt_count > 0
              AND line_delivery_last_attempted_at IS NOT NULL
              AND line_delivery_failure_code IN (
                'PROVIDER_REJECTED', 'PROVIDER_UNAVAILABLE'
              )
              AND line_delivered_at IS NULL
            )
          );

      CREATE INDEX idx_classroom_attendance_links_line_delivery
        ON classroom_attendance_links (
          line_delivery_status,
          school_id,
          school_term_id
        );
      CREATE INDEX idx_classroom_attendance_links_line_delivery_membership
        ON classroom_attendance_links (line_delivery_teacher_membership_id, school_id)
        WHERE line_delivery_teacher_membership_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $guard_classroom_link_line_delivery_rollback$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM classroom_attendance_links
          WHERE line_delivery_teacher_membership_id IS NOT NULL
             OR line_delivery_status <> 'NOT_READY'
             OR line_delivery_failure_code IS NOT NULL
             OR line_delivery_attempt_count <> 0
             OR line_delivery_request_id IS NOT NULL
             OR line_delivery_last_attempted_at IS NOT NULL
             OR line_delivered_at IS NOT NULL
        ) THEN
          RAISE EXCEPTION
            'Refusing rollback: classroom link LINE delivery contains consumer data';
        END IF;
      END;
      $guard_classroom_link_line_delivery_rollback$;

      DROP INDEX idx_classroom_attendance_links_line_delivery_membership;
      DROP INDEX idx_classroom_attendance_links_line_delivery;
      ALTER TABLE classroom_attendance_links
        DROP CONSTRAINT chk_classroom_attendance_links_line_delivery_state,
        DROP CONSTRAINT chk_classroom_attendance_links_line_delivery_attempts,
        DROP CONSTRAINT chk_classroom_attendance_links_line_delivery_failure,
        DROP CONSTRAINT chk_classroom_attendance_links_line_delivery_status,
        DROP CONSTRAINT fk_classroom_attendance_links_line_delivery_membership,
        DROP COLUMN line_delivered_at,
        DROP COLUMN line_delivery_last_attempted_at,
        DROP COLUMN line_delivery_request_id,
        DROP COLUMN line_delivery_attempt_count,
        DROP COLUMN line_delivery_failure_code,
        DROP COLUMN line_delivery_status,
        DROP COLUMN line_delivery_teacher_membership_id;
    `);
  }
}
