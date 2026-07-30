import type { MigrationInterface, QueryRunner } from 'typeorm';

const REJECTED_BACKUP_TABLE = 'notification_reason_rejected_backup_20260731';

export class RequireStudentNotificationReasons20260731130000 implements MigrationInterface {
  name = 'RequireStudentNotificationReasons20260731130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notifications
        DROP CONSTRAINT IF EXISTS chk_notifications_reason_type
    `);

    await queryRunner.query(`
      UPDATE notifications notification
      SET reason_text = NULLIF(btrim(case_record.reason_flagged), '')
      FROM cases case_record
      WHERE notification.type_code IN (
          'CASE_STATUS_CHANGED', 'CASE_SLA_WARNING', 'CASE_SLA_BREACHED'
        )
        AND notification.case_id = case_record.id
    `);

    await queryRunner.query(`
      CREATE TABLE ${REJECTED_BACKUP_TABLE} AS
      SELECT notification.*
      FROM notifications notification
      WHERE notification.type_code IN (
          'CASE_CREATED', 'CASE_STATUS_CHANGED', 'CASE_SLA_WARNING',
          'CASE_SLA_BREACHED', 'CASE_RISK_ESCALATED', 'STUDENT_RISK_WATCH'
        )
        AND (notification.reason_text IS NULL OR btrim(notification.reason_text) = '')
    `);

    await queryRunner.query(`
      DELETE FROM notifications notification
      USING ${REJECTED_BACKUP_TABLE} rejected
      WHERE notification.id = rejected.id
    `);

    await queryRunner.query(`
      ALTER TABLE notifications
        ADD CONSTRAINT chk_notifications_reason_type CHECK (
          (
            type_code IN (
              'CASE_CREATED', 'CASE_STATUS_CHANGED', 'CASE_SLA_WARNING',
              'CASE_SLA_BREACHED', 'CASE_RISK_ESCALATED', 'STUDENT_RISK_WATCH'
            )
            AND reason_text IS NOT NULL
          )
          OR (
            type_code NOT IN (
              'CASE_CREATED', 'CASE_STATUS_CHANGED', 'CASE_SLA_WARNING',
              'CASE_SLA_BREACHED', 'CASE_RISK_ESCALATED', 'STUDENT_RISK_WATCH'
            )
            AND reason_text IS NULL
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notifications
        DROP CONSTRAINT IF EXISTS chk_notifications_reason_type
    `);

    await queryRunner.query(`
      INSERT INTO notifications (
        id, recipient_user_id, type_code, title, body, ref_entity, ref_id,
        seen_at, read_at, created_at, student_person_uuid, case_id,
        student_name_masked, reason_text
      )
      SELECT
        id, recipient_user_id, type_code, title, body, ref_entity, ref_id,
        seen_at, read_at, created_at, student_person_uuid, case_id,
        student_name_masked, reason_text
      FROM ${REJECTED_BACKUP_TABLE}
      ON CONFLICT (id) DO NOTHING
    `);

    await queryRunner.query(`
      UPDATE notifications
      SET reason_text = NULL
      WHERE type_code IN (
        'CASE_STATUS_CHANGED', 'CASE_SLA_WARNING', 'CASE_SLA_BREACHED'
      )
    `);

    await queryRunner.query(`
      ALTER TABLE notifications
        ADD CONSTRAINT chk_notifications_reason_type CHECK (
          (
            type_code IN ('CASE_CREATED', 'CASE_RISK_ESCALATED', 'STUDENT_RISK_WATCH')
            AND reason_text IS NOT NULL
          )
          OR (
            type_code NOT IN ('CASE_CREATED', 'CASE_RISK_ESCALATED', 'STUDENT_RISK_WATCH')
            AND reason_text IS NULL
          )
        )
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS ${REJECTED_BACKUP_TABLE}`);
  }
}
