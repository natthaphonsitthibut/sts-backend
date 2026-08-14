import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  AUDIT_COLUMNS_SQL,
  SET_UPDATED_AT_FUNCTION_SQL,
  STUDENT_ACCOUNT_BATCH_TABLES_SQL,
  auditUpdatedAtTriggerSql,
} from '../bootstrap-sql';

/**
 * Retires guest-to-guest delegation and the dormant student-account batch
 * storage. Home-visit rounds are created by staff from case tracking, one
 * assignee per round. Notification delivery is intentionally limited to the
 * five case-workflow status transitions.
 *
 * `notifications.case_status_code` records the status at the time of the
 * event, rather than inferring it from a title. It is a real FK to the current
 * five-status catalog so the client can share the exact status-card icon/color
 * presentation. Legacy notifications are replaced with one unread notification
 * per current case, timestamped at that case's last update.
 *
 * The purge is intentional: retired archive tables and legacy notification,
 * delegation-column, and batch-job values cannot be reconstructed by down().
 * Down restores only the schema/catalog shape needed to roll back code.
 */
export class RetireDelegationAndLegacyNotifications20260815160000 implements MigrationInterface {
  name = 'RetireDelegationAndLegacyNotifications20260815160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM notifications`);

    await queryRunner.query(`
      UPDATE task_links
      SET status = 'EXPIRED', updated_at = now()
      WHERE status = 'DELEGATED'
    `);
    await queryRunner.query(
      `DELETE FROM application_display_states WHERE domain_code = 'TASK_LINK_STATE' AND code = 'DELEGATED'`,
    );
    await queryRunner.query(`DELETE FROM task_link_statuses WHERE code = 'DELEGATED'`);

    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS parent_link_id`);
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS delegation_depth`);
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS delegation_note`);
    await queryRunner.query(`ALTER TABLE tasks DROP COLUMN IF EXISTS max_delegation_depth`);

    await queryRunner.query(
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS case_status_code VARCHAR(32)`,
    );
    await queryRunner.query(`ALTER TABLE notifications ALTER COLUMN case_status_code SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS fk_notifications_case_status`,
    );
    await queryRunner.query(`
      ALTER TABLE notifications
        ADD CONSTRAINT fk_notifications_case_status
        FOREIGN KEY (case_status_code) REFERENCES case_workflow_statuses(code)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(
      `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_student_context`,
    );
    await queryRunner.query(
      `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_case_context`,
    );
    await queryRunner.query(
      `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_reason_type`,
    );
    await queryRunner.query(`
      ALTER TABLE notifications ADD CONSTRAINT chk_notifications_student_context CHECK (
        type_code = 'CASE_STATUS_CHANGED'
        AND student_name_masked IS NOT NULL
        AND length(trim(student_name_masked)) > 0
      )
    `);
    await queryRunner.query(`
      ALTER TABLE notifications ADD CONSTRAINT chk_notifications_case_context CHECK (
        type_code = 'CASE_STATUS_CHANGED'
        AND case_id IS NOT NULL
        AND case_status_code IS NOT NULL
      )
    `);
    await queryRunner.query(`DELETE FROM notification_types WHERE code <> 'CASE_STATUS_CHANGED'`);
    await queryRunner.query(`
      UPDATE notification_types
      SET label_th = 'เคสเปลี่ยนสถานะ', required_permission = 'review-cases', sort_order = 10, is_enabled = TRUE
      WHERE code = 'CASE_STATUS_CHANGED'
    `);

    await queryRunner.query(`
      INSERT INTO notifications (
        recipient_user_id, type_code, title, body, ref_entity, ref_id,
        student_person_uuid, case_id, case_status_code, student_name_masked,
        reason_text, created_at
      )
      SELECT
        user_record.id,
        'CASE_STATUS_CHANGED',
        CONCAT(
          'เคสเปลี่ยนสถานะ: ',
          CASE case_record.status
            WHEN 'OPEN' THEN 'รอมอบหมาย'
            WHEN 'IN_PROGRESS' THEN 'รอติดตาม'
            WHEN 'PENDING_REVIEW' THEN 'รอพิจารณา'
            WHEN 'RESOLVED' THEN 'เสร็จสิ้น'
            WHEN 'STUDENT_NOT_FOUND' THEN 'ไม่พบนักเรียน'
          END,
          CASE
            WHEN case_record.status = 'RESOLVED'
              AND case_record.completion_outcome_code = 'CLOSED' THEN ' : ปิดเคส'
            WHEN case_record.status = 'RESOLVED'
              AND case_record.completion_outcome_code = 'REFERRED_AGENCY' THEN ' : ส่งต่อหน่วยงาน'
            ELSE ''
          END
        ),
        masked_student_name,
        'case',
        case_record.id::text,
        enrollment.person_uuid,
        case_record.id,
        case_record.status,
        masked_student_name,
        NULLIF(btrim(case_record.reason_flagged), ''),
        COALESCE(case_record.updated_at, case_record.created_at, CURRENT_TIMESTAMP)
      FROM cases case_record
      LEFT JOIN student_term enrollment ON enrollment.student_uuid = case_record.student_uuid
      LEFT JOIN schools school ON school.id = case_record.school_id
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN length(btrim(case_record.student_name)) <= 2
            THEN left(btrim(case_record.student_name), 1) || '*'
          ELSE left(btrim(case_record.student_name), 1)
            || repeat('*', greatest(length(btrim(case_record.student_name)) - 2, 1))
            || right(btrim(case_record.student_name), 1)
        END AS masked_student_name
      ) masked
      CROSS JOIN users user_record
      LEFT JOIN roles role_record ON role_record.name = user_record.role
      WHERE case_record.deleted_at IS NULL
        AND case_record.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'RESOLVED', 'STUDENT_NOT_FOUND')
        AND user_record.status = 'ACTIVE'
        AND user_record.role IS DISTINCT FROM 'STUDENT'
        AND user_record.data_origin_code <> 'AUTOMATED_TEST'
        AND CASE
          WHEN jsonb_typeof(user_record.permissions) = 'array'
            THEN user_record.permissions ? 'review-cases'
          ELSE COALESCE(role_record.default_permissions ? 'review-cases', FALSE)
        END
        AND (
          user_record.data_scope->'global' = 'true'::jsonb
          OR (
            jsonb_typeof(user_record.data_scope) = 'object'
            AND COALESCE(user_record.data_scope->'own_only', 'false'::jsonb) <> 'true'::jsonb
            AND (
              (user_record.data_scope ? 'school_ids' AND jsonb_typeof(user_record.data_scope->'school_ids') = 'array' AND jsonb_array_length(user_record.data_scope->'school_ids') > 0)
              OR (user_record.data_scope ? 'provinces' AND jsonb_typeof(user_record.data_scope->'provinces') = 'array' AND jsonb_array_length(user_record.data_scope->'provinces') > 0)
              OR (user_record.data_scope ? 'districts' AND jsonb_typeof(user_record.data_scope->'districts') = 'array' AND jsonb_array_length(user_record.data_scope->'districts') > 0)
              OR (user_record.data_scope ? 'sub_districts' AND jsonb_typeof(user_record.data_scope->'sub_districts') = 'array' AND jsonb_array_length(user_record.data_scope->'sub_districts') > 0)
              OR (user_record.data_scope ? 'grade_levels' AND jsonb_typeof(user_record.data_scope->'grade_levels') = 'array' AND jsonb_array_length(user_record.data_scope->'grade_levels') > 0)
              OR (user_record.data_scope ? 'room_ids' AND jsonb_typeof(user_record.data_scope->'room_ids') = 'array' AND jsonb_array_length(user_record.data_scope->'room_ids') > 0)
            )
            AND (NOT (user_record.data_scope ? 'school_ids') OR (jsonb_typeof(user_record.data_scope->'school_ids') = 'array' AND (jsonb_array_length(user_record.data_scope->'school_ids') = 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(user_record.data_scope->'school_ids') value WHERE value = case_record.school_id::text))))
            AND (NOT (user_record.data_scope ? 'provinces') OR (jsonb_typeof(user_record.data_scope->'provinces') = 'array' AND (jsonb_array_length(user_record.data_scope->'provinces') = 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(user_record.data_scope->'provinces') value WHERE value = school.province))))
            AND (NOT (user_record.data_scope ? 'districts') OR (jsonb_typeof(user_record.data_scope->'districts') = 'array' AND (jsonb_array_length(user_record.data_scope->'districts') = 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(user_record.data_scope->'districts') value WHERE value = school.district))))
            AND (NOT (user_record.data_scope ? 'sub_districts') OR (jsonb_typeof(user_record.data_scope->'sub_districts') = 'array' AND (jsonb_array_length(user_record.data_scope->'sub_districts') = 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(user_record.data_scope->'sub_districts') value WHERE value = school.sub_district))))
            AND (NOT (user_record.data_scope ? 'grade_levels') OR (jsonb_typeof(user_record.data_scope->'grade_levels') = 'array' AND (jsonb_array_length(user_record.data_scope->'grade_levels') = 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(user_record.data_scope->'grade_levels') value WHERE value = enrollment."GradeLevelID_Onec"::text))))
            AND (NOT (user_record.data_scope ? 'room_ids') OR (jsonb_typeof(user_record.data_scope->'room_ids') = 'array' AND (jsonb_array_length(user_record.data_scope->'room_ids') = 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(user_record.data_scope->'room_ids') value WHERE value = enrollment."RoomID_Onec"::text))))
          )
        )
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS student_account_batch_job_item`);
    await queryRunner.query(`DROP TABLE IF EXISTS student_account_batch_job`);
    await queryRunner.query(`DROP TABLE IF EXISTS student_account_batch_item_statuses`);
    await queryRunner.query(`DROP TABLE IF EXISTS student_account_batch_job_statuses`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_access_role_backup_20260802`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_student_account_user_backup_20260802`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_student_follow_up_request_sources`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_student_follow_up_requests`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_student_follow_up_request_statuses`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_task_link_timetable_slots_20260815`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_attendance_task_links_20260815`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_attendance_tasks_20260815`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_task_link_field_follower_refs_20260814`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS retired_follower_recruitment_campaign_targets_20260814`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS retired_field_followers_20260814`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_follower_recruitment_campaigns_20260814`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_field_follower_display_states_20260814`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(SET_UPDATED_AT_FUNCTION_SQL);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_account_batch_job_statuses (
        code VARCHAR(16) PRIMARY KEY,
        label_th VARCHAR(100) NOT NULL,
        badge_variant VARCHAR(16) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_student_account_batch_job_statuses_label
          CHECK (length(trim(label_th)) > 0),
        CONSTRAINT chk_student_account_batch_job_statuses_badge
          CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('student_account_batch_job_statuses'));
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_account_batch_item_statuses (
        code VARCHAR(16) PRIMARY KEY,
        label_th VARCHAR(100) NOT NULL,
        badge_variant VARCHAR(16) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_student_account_batch_item_statuses_label
          CHECK (length(trim(label_th)) > 0),
        CONSTRAINT chk_student_account_batch_item_statuses_badge
          CHECK (badge_variant IN ('default','secondary','destructive','success','warning'))
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('student_account_batch_item_statuses'));
    await queryRunner.query(`
      INSERT INTO student_account_batch_job_statuses
        (code, label_th, badge_variant, sort_order)
      VALUES
        ('PENDING', 'รอเริ่ม', 'secondary', 10),
        ('RUNNING', 'กำลังทำงาน', 'default', 20),
        ('COMPLETED', 'เสร็จสิ้น', 'success', 30),
        ('FAILED', 'ล้มเหลว', 'destructive', 40),
        ('INTERRUPTED', 'หยุดชะงัก', 'warning', 50),
        ('CANCELED', 'ยกเลิกแล้ว', 'secondary', 60)
      ON CONFLICT (code) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO student_account_batch_item_statuses
        (code, label_th, badge_variant, sort_order)
      VALUES
        ('PENDING', 'รอดำเนินการ', 'secondary', 10),
        ('CREATED', 'สร้างแล้ว', 'success', 20),
        ('SKIPPED', 'ข้าม', 'warning', 30),
        ('FAILED', 'ล้มเหลว', 'destructive', 40)
      ON CONFLICT (code) DO NOTHING
    `);
    await queryRunner.query(STUDENT_ACCOUNT_BATCH_TABLES_SQL);
    await queryRunner.query(`
      DO $batch_status_fks$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_account_batch_job_status'
        ) THEN
          ALTER TABLE student_account_batch_job
            ADD CONSTRAINT fk_student_account_batch_job_status
            FOREIGN KEY (status) REFERENCES student_account_batch_job_statuses(code)
            ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_account_batch_item_status'
        ) THEN
          ALTER TABLE student_account_batch_job_item
            ADD CONSTRAINT fk_student_account_batch_item_status
            FOREIGN KEY (status) REFERENCES student_account_batch_item_statuses(code)
            ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $batch_status_fks$;
    `);

    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS max_delegation_depth INTEGER DEFAULT 3`,
    );
    await queryRunner.query(
      `ALTER TABLE task_links ADD COLUMN IF NOT EXISTS parent_link_id UUID REFERENCES task_links(id)`,
    );
    await queryRunner.query(
      `ALTER TABLE task_links ADD COLUMN IF NOT EXISTS delegation_depth INTEGER DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE task_links ADD COLUMN IF NOT EXISTS delegation_note TEXT`);
    await queryRunner.query(`
      INSERT INTO task_link_statuses (code, label_th, badge_variant, sort_order)
      VALUES ('DELEGATED', 'ส่งต่อแล้ว', 'secondary', 20)
      ON CONFLICT (code) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO application_display_states (domain_code, code, label_th, badge_variant, summary_tone, sort_order)
      VALUES ('TASK_LINK_STATE', 'DELEGATED', 'ส่งต่อแล้ว', 'secondary', NULL, 50)
      ON CONFLICT (domain_code, code) DO NOTHING
    `);
    await queryRunner.query(
      `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_student_context`,
    );
    await queryRunner.query(
      `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_case_context`,
    );
    await queryRunner.query(
      `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_reason_type`,
    );
    await queryRunner.query(
      `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS fk_notifications_case_status`,
    );
    await queryRunner.query(`ALTER TABLE notifications DROP COLUMN IF EXISTS case_status_code`);
    await queryRunner.query(`
      ALTER TABLE notifications ADD CONSTRAINT chk_notifications_student_context CHECK (
        type_code = 'CASE_STATUS_CHANGED'
        AND student_person_uuid IS NOT NULL
        AND student_name_masked IS NOT NULL
        AND length(trim(student_name_masked)) > 0
      )
    `);
    await queryRunner.query(`
      ALTER TABLE notifications ADD CONSTRAINT chk_notifications_case_context CHECK (
        type_code = 'CASE_STATUS_CHANGED'
        AND case_id IS NOT NULL
      )
    `);
  }
}
