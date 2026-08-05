import type { MigrationInterface, QueryRunner } from 'typeorm';
import { OPERATIONAL_STATUS_CATALOG_TABLES_SQL } from '../bootstrap-sql';

export class AddOperationalStatusCatalogs20260703120000 implements MigrationInterface {
  name = 'AddOperationalStatusCatalogs20260703120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(OPERATIONAL_STATUS_CATALOG_TABLES_SQL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_import_batches DROP CONSTRAINT IF EXISTS fk_student_import_batches_status;
      ALTER TABLE case_referrals DROP CONSTRAINT IF EXISTS fk_case_referrals_status;
      ALTER TABLE student_account_batch_job_item DROP CONSTRAINT IF EXISTS fk_student_account_batch_item_status;
      ALTER TABLE student_account_batch_job DROP CONSTRAINT IF EXISTS fk_student_account_batch_job_status;
      ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS fk_attendance_sessions_status;
      ALTER TABLE school_calendar_days DROP CONSTRAINT IF EXISTS fk_school_calendar_days_type;
      ALTER TABLE school_terms DROP CONSTRAINT IF EXISTS fk_school_terms_status;
      ALTER TABLE attendance DROP CONSTRAINT IF EXISTS fk_attendance_record_status;
      ALTER TABLE task_links DROP CONSTRAINT IF EXISTS fk_task_links_status;
      ALTER TABLE tasks DROP CONSTRAINT IF EXISTS fk_tasks_workflow_status;
      ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_account_status;

      ALTER TABLE users ADD CONSTRAINT chk_users_status CHECK (status IN ('ACTIVE','DISABLED'));
      ALTER TABLE tasks ADD CONSTRAINT chk_tasks_status CHECK (status IN ('OPEN','ACTIVE','IN_PROGRESS','COMPLETED','PENDING_REVIEW'));
      ALTER TABLE school_terms ADD CONSTRAINT chk_school_terms_status CHECK (status IN ('DRAFT','ACTIVE','CLOSED'));
      ALTER TABLE school_calendar_days ADD CONSTRAINT chk_school_calendar_days_type CHECK (day_type IN ('SCHOOL_DAY','HOLIDAY','CANCELLED'));
      ALTER TABLE attendance_sessions ADD CONSTRAINT chk_attendance_sessions_status CHECK (status IN ('OPEN','SUBMITTED','REOPENED','VOIDED'));
      ALTER TABLE student_account_batch_job ADD CONSTRAINT chk_student_account_batch_job_status CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','INTERRUPTED','CANCELED'));
      ALTER TABLE student_account_batch_job_item ADD CONSTRAINT chk_student_account_batch_job_item_status CHECK (status IN ('PENDING','CREATED','SKIPPED','FAILED'));
      ALTER TABLE case_referrals ADD CONSTRAINT chk_case_referrals_status CHECK (status IN ('SENT','ACKNOWLEDGED','ACCEPTED','DECLINED','RETURNED'));
      ALTER TABLE student_import_batches ADD CONSTRAINT chk_student_import_batches_status CHECK (status IN ('RUNNING','COMPLETED','PARTIAL','FAILED'));

      DROP TABLE application_display_states;
      DROP TABLE student_import_batch_statuses;
      DROP TABLE case_referral_statuses;
      DROP TABLE student_account_batch_item_statuses;
      DROP TABLE student_account_batch_job_statuses;
      DROP TABLE attendance_session_statuses;
      DROP TABLE school_calendar_day_types;
      DROP TABLE school_term_statuses;
      DROP TABLE attendance_record_statuses;
      DROP TABLE task_link_statuses;
      DROP TABLE task_workflow_statuses;
      DROP TABLE user_account_statuses;
    `);
  }
}
