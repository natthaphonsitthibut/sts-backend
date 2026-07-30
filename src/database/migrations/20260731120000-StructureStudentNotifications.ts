import type { MigrationInterface, QueryRunner } from 'typeorm';

const STRUCTURED_TYPE_CODES = [
  'CASE_CREATED',
  'CASE_STATUS_CHANGED',
  'CASE_SLA_WARNING',
  'CASE_SLA_BREACHED',
  'CASE_RISK_ESCALATED',
  'STUDENT_RISK_WATCH',
] as const;

const CASE_TYPE_CODES = [
  'CASE_CREATED',
  'CASE_STATUS_CHANGED',
  'CASE_SLA_WARNING',
  'CASE_SLA_BREACHED',
  'CASE_RISK_ESCALATED',
] as const;

const REASON_TYPE_CODES = ['CASE_CREATED', 'CASE_RISK_ESCALATED', 'STUDENT_RISK_WATCH'] as const;

const REJECTED_BACKUP_TABLE = 'notification_structure_rejected_backup_20260731';

export class StructureStudentNotifications20260731120000 implements MigrationInterface {
  name = 'StructureStudentNotifications20260731120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS student_person_uuid UUID,
        ADD COLUMN IF NOT EXISTS case_id INTEGER,
        ADD COLUMN IF NOT EXISTS student_name_masked TEXT,
        ADD COLUMN IF NOT EXISTS reason_text TEXT
    `);

    await queryRunner.query(
      `
        UPDATE notifications notification
        SET
          case_id = case_record.id,
          student_person_uuid = enrollment.person_uuid
        FROM cases case_record
        INNER JOIN student_term enrollment
          ON enrollment.student_uuid = case_record.student_uuid
        WHERE notification.type_code = ANY($1::varchar[])
          AND notification.ref_entity = 'case'
          AND notification.ref_id ~ '^[0-9]+$'
          AND case_record.id = notification.ref_id::int
          AND enrollment.person_uuid IS NOT NULL
      `,
      [[...CASE_TYPE_CODES]],
    );

    await queryRunner.query(`
      UPDATE notifications notification
      SET student_person_uuid = enrollment.person_uuid
      FROM student_term enrollment
      WHERE notification.type_code = 'STUDENT_RISK_WATCH'
        AND notification.ref_entity = 'student-risk-watch'
        AND split_part(notification.ref_id, ':', 1)
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND enrollment.student_uuid = split_part(notification.ref_id, ':', 1)::uuid
        AND enrollment.person_uuid IS NOT NULL
    `);

    await queryRunner.query(
      `
      UPDATE notifications
      SET student_name_masked = NULLIF(
        btrim(
          CASE
            WHEN type_code = 'CASE_CREATED' THEN split_part(body, ' · ', 1)
            WHEN type_code IN (
              'CASE_STATUS_CHANGED', 'CASE_SLA_WARNING',
              'CASE_SLA_BREACHED', 'CASE_RISK_ESCALATED'
            ) THEN regexp_replace(split_part(body, ' · ', 1), '^เคสของ[[:space:]]+', '')
            WHEN type_code = 'STUDENT_RISK_WATCH'
              THEN regexp_replace(split_part(body, ' · ', 1), '^เฝ้าระวัง[[:space:]]+', '')
            ELSE NULL
          END
        ),
        ''
      )
      WHERE type_code = ANY($1::varchar[])
    `,
      [[...STRUCTURED_TYPE_CODES]],
    );

    await queryRunner.query(`
      UPDATE notifications notification
      SET reason_text = NULLIF(
        btrim(
          CASE
            WHEN notification.body =
              notification.student_name_masked || ' · ' || case_record.student_school
              THEN NULL
            WHEN case_record.student_school IS NOT NULL
              AND notification.body LIKE
                notification.student_name_masked || ' · ' || case_record.student_school || ' · %'
              THEN substr(
                notification.body,
                length(notification.student_name_masked || ' · ' || case_record.student_school || ' · ') + 1
              )
            WHEN case_record.student_school IS NULL
              AND strpos(notification.body, ' · ') > 0
              THEN substr(notification.body, strpos(notification.body, ' · ') + length(' · '))
            ELSE NULL
          END
        ),
        ''
      )
      FROM cases case_record
      WHERE notification.type_code = 'CASE_CREATED'
        AND notification.case_id = case_record.id
    `);

    await queryRunner.query(`
      UPDATE notifications
      SET reason_text = NULLIF(
        btrim(
          CASE
            WHEN split_part(body, ' · ', 2) LIKE '%→%'
              THEN substr(
                body,
                length(split_part(body, ' · ', 1) || ' · ' || split_part(body, ' · ', 2) || ' · ') + 1
              )
            WHEN strpos(body, ' · ') > 0
              THEN substr(body, strpos(body, ' · ') + length(' · '))
            ELSE NULL
          END
        ),
        ''
      )
      WHERE type_code = 'CASE_RISK_ESCALATED'
    `);

    await queryRunner.query(`
      UPDATE notifications
      SET reason_text = NULLIF(
        btrim(substr(body, strpos(body, ' · ') + length(' · '))),
        ''
      )
      WHERE type_code = 'STUDENT_RISK_WATCH'
        AND strpos(body, ' · ') > 0
    `);

    await queryRunner.query(
      `
      CREATE TABLE ${REJECTED_BACKUP_TABLE} AS
      SELECT notification.*
      FROM notifications notification
      WHERE notification.type_code = ANY($1::varchar[])
        AND (
          notification.student_person_uuid IS NULL
          OR notification.student_name_masked IS NULL
          OR btrim(notification.student_name_masked) = ''
          OR (
            notification.type_code = ANY($2::varchar[])
            AND notification.case_id IS NULL
          )
          OR (
            notification.type_code = ANY($3::varchar[])
            AND (notification.reason_text IS NULL OR btrim(notification.reason_text) = '')
          )
        )
    `,
      [[...STRUCTURED_TYPE_CODES], [...CASE_TYPE_CODES], [...REASON_TYPE_CODES]],
    );

    await queryRunner.query(`
      DELETE FROM notifications notification
      USING ${REJECTED_BACKUP_TABLE} rejected
      WHERE notification.id = rejected.id
    `);

    await queryRunner.query(`
      ALTER TABLE notifications
        DROP CONSTRAINT IF EXISTS chk_notifications_student_context,
        DROP CONSTRAINT IF EXISTS chk_notifications_case_context,
        DROP CONSTRAINT IF EXISTS chk_notifications_reason_type,
        DROP CONSTRAINT IF EXISTS chk_notifications_reason_text,
        DROP CONSTRAINT IF EXISTS fk_notifications_student_person,
        DROP CONSTRAINT IF EXISTS fk_notifications_case
    `);
    await queryRunner.query(`
      ALTER TABLE notifications
        ADD CONSTRAINT fk_notifications_student_person
          FOREIGN KEY (student_person_uuid) REFERENCES student_person(person_uuid)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT fk_notifications_case
          FOREIGN KEY (case_id) REFERENCES cases(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_notifications_student_context CHECK (
          (
            type_code = ANY(ARRAY[
              'CASE_CREATED', 'CASE_STATUS_CHANGED', 'CASE_SLA_WARNING',
              'CASE_SLA_BREACHED', 'CASE_RISK_ESCALATED', 'STUDENT_RISK_WATCH'
            ]::varchar[])
            AND student_person_uuid IS NOT NULL
            AND student_name_masked IS NOT NULL
            AND length(trim(student_name_masked)) > 0
          )
          OR (
            type_code <> ALL(ARRAY[
              'CASE_CREATED', 'CASE_STATUS_CHANGED', 'CASE_SLA_WARNING',
              'CASE_SLA_BREACHED', 'CASE_RISK_ESCALATED', 'STUDENT_RISK_WATCH'
            ]::varchar[])
            AND student_person_uuid IS NULL
            AND student_name_masked IS NULL
            AND reason_text IS NULL
          )
        ),
        ADD CONSTRAINT chk_notifications_case_context CHECK (
          (
            type_code = ANY(ARRAY[
              'CASE_CREATED', 'CASE_STATUS_CHANGED', 'CASE_SLA_WARNING',
              'CASE_SLA_BREACHED', 'CASE_RISK_ESCALATED'
            ]::varchar[])
            AND case_id IS NOT NULL
          )
          OR (
            type_code <> ALL(ARRAY[
              'CASE_CREATED', 'CASE_STATUS_CHANGED', 'CASE_SLA_WARNING',
              'CASE_SLA_BREACHED', 'CASE_RISK_ESCALATED'
            ]::varchar[])
            AND case_id IS NULL
          )
        ),
        ADD CONSTRAINT chk_notifications_reason_text CHECK (
          reason_text IS NULL OR length(trim(reason_text)) > 0
        ),
        ADD CONSTRAINT chk_notifications_reason_type CHECK (
          (
            type_code = ANY(ARRAY[
              'CASE_CREATED', 'CASE_RISK_ESCALATED', 'STUDENT_RISK_WATCH'
            ]::varchar[])
            AND reason_text IS NOT NULL
          )
          OR (
            type_code <> ALL(ARRAY[
              'CASE_CREATED', 'CASE_RISK_ESCALATED', 'STUDENT_RISK_WATCH'
            ]::varchar[])
            AND reason_text IS NULL
          )
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_student_person_created
        ON notifications (student_person_uuid, created_at DESC)
        WHERE student_person_uuid IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_case_created
        ON notifications (case_id, created_at DESC)
        WHERE case_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notifications
        DROP CONSTRAINT IF EXISTS chk_notifications_reason_type,
        DROP CONSTRAINT IF EXISTS chk_notifications_reason_text,
        DROP CONSTRAINT IF EXISTS chk_notifications_case_context,
        DROP CONSTRAINT IF EXISTS chk_notifications_student_context,
        DROP CONSTRAINT IF EXISTS fk_notifications_case,
        DROP CONSTRAINT IF EXISTS fk_notifications_student_person
    `);

    await queryRunner.query(`
      INSERT INTO notifications (
        id, recipient_user_id, type_code, title, body, ref_entity, ref_id,
        seen_at, read_at, created_at
      )
      SELECT
        id, recipient_user_id, type_code, title, body, ref_entity, ref_id,
        seen_at, read_at, created_at
      FROM ${REJECTED_BACKUP_TABLE}
      ON CONFLICT (id) DO NOTHING
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_notifications_case_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_notifications_student_person_created`);
    await queryRunner.query(`
      ALTER TABLE notifications
        DROP COLUMN IF EXISTS reason_text,
        DROP COLUMN IF EXISTS student_name_masked,
        DROP COLUMN IF EXISTS case_id,
        DROP COLUMN IF EXISTS student_person_uuid
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS ${REJECTED_BACKUP_TABLE}`);
  }
}
