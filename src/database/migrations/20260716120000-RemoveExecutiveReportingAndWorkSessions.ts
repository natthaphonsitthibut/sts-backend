import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveExecutiveReportingAndWorkSessions20260716120000 implements MigrationInterface {
  name = 'RemoveExecutiveReportingAndWorkSessions20260716120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS visit_position_pings`);
    await queryRunner.query(`DROP TABLE IF EXISTS visit_work_sessions`);

    await queryRunner.query(`
      INSERT INTO data_export_job_event (job_id, actor_user_id, event_code, metadata)
      SELECT id, requested_by, 'CANCELED', '{"reason":"DATASET_RETIRED"}'::jsonb
      FROM data_export_job
      WHERE dataset_code = 'executive_aggregate'
        AND status IN ('PENDING', 'RUNNING', 'FAILED')
    `);
    await queryRunner.query(`
      UPDATE data_export_job
      SET status = 'CANCELED',
          canceled_at = now(),
          completed_at = COALESCE(completed_at, now()),
          progress_percent = 100,
          failure_code = 'DATASET_RETIRED',
          failure_summary = 'ชุดข้อมูลนี้ถูกถอดออกจากระบบแล้ว'
      WHERE dataset_code = 'executive_aggregate'
        AND status IN ('PENDING', 'RUNNING', 'FAILED')
    `);

    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE(default_permissions, '[]'::jsonb) - 'executive-report'
      WHERE COALESCE(default_permissions, '[]'::jsonb) ? 'executive-report'
    `);
    await queryRunner.query(`
      UPDATE users
      SET permissions = COALESCE(permissions, '[]'::jsonb) - 'executive-report'
      WHERE COALESCE(permissions, '[]'::jsonb) ? 'executive-report'
    `);

    // This table only supported rollback of the retired executive restriction rollout.
    await queryRunner.query(`DROP TABLE IF EXISTS executive_aggregate_permission_backups`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE visit_work_sessions (
        id BIGSERIAL PRIMARY KEY,
        task_link_id UUID NOT NULL
          CONSTRAINT fk_visit_work_sessions_task_link
          REFERENCES task_links(id) ON DELETE CASCADE ON UPDATE CASCADE,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at TIMESTAMPTZ NULL,
        end_reason VARCHAR(20) NULL
          CONSTRAINT chk_visit_work_sessions_end_reason
          CHECK (end_reason IN ('MANUAL', 'SUBMITTED', 'TIMEOUT')),
        consent_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_visit_work_sessions_open_per_link
        ON visit_work_sessions (task_link_id)
        WHERE ended_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_visit_work_sessions_task_link_id
        ON visit_work_sessions (task_link_id)
    `);
    await queryRunner.query(`
      CREATE TABLE visit_position_pings (
        id BIGSERIAL PRIMARY KEY,
        session_id BIGINT NOT NULL
          CONSTRAINT fk_visit_position_pings_session
          REFERENCES visit_work_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_visit_position_pings_session_recorded
        ON visit_position_pings (session_id, recorded_at)
    `);

    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE(default_permissions, '[]'::jsonb)
        || '["executive-report"]'::jsonb
      WHERE name IN ('ADMIN', 'EXECUTIVE')
        AND NOT (COALESCE(default_permissions, '[]'::jsonb) ? 'executive-report')
    `);
    await queryRunner.query(`
      UPDATE users
      SET permissions = COALESCE(permissions, '[]'::jsonb) || '["executive-report"]'::jsonb
      WHERE role = 'EXECUTIVE'
        AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'executive-report')
    `);

    // A retired in-flight export cannot safely resume mid-stream after rollback.
    // FAILED makes the job explicitly retryable through the normal queue path.
    await queryRunner.query(`
      UPDATE data_export_job
      SET status = 'FAILED',
          canceled_at = NULL,
          progress_percent = 0,
          failure_code = 'DATASET_RESTORED_RETRY_REQUIRED',
          failure_summary = 'ชุดข้อมูลกลับมาใช้งานแล้ว กรุณาสั่ง retry งานนี้'
      WHERE dataset_code = 'executive_aggregate'
        AND status = 'CANCELED'
        AND failure_code = 'DATASET_RETIRED'
    `);

    // Recreate the historical rollback support expected by migration 14310000.
    await queryRunner.query(`
      CREATE TABLE executive_aggregate_permission_backups (
        id BIGSERIAL PRIMARY KEY,
        role_name VARCHAR(64),
        user_id INTEGER,
        original_permissions JSONB NOT NULL,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_executive_permission_backup_role
          FOREIGN KEY (role_name) REFERENCES roles(name)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_executive_permission_backup_user
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT chk_executive_permission_backup_owner
          CHECK ((role_name IS NULL) <> (user_id IS NULL)),
        CONSTRAINT chk_executive_permission_backup_json
          CHECK (jsonb_typeof(original_permissions) = 'array'),
        CONSTRAINT uq_executive_permission_backup_role UNIQUE (role_name),
        CONSTRAINT uq_executive_permission_backup_user UNIQUE (user_id)
      )
    `);
    await queryRunner.query(`
      INSERT INTO executive_aggregate_permission_backups (role_name, original_permissions)
      SELECT name, COALESCE(default_permissions, '[]'::jsonb)
      FROM roles
      WHERE name = 'EXECUTIVE'
    `);
    await queryRunner.query(`
      INSERT INTO executive_aggregate_permission_backups (user_id, original_permissions)
      SELECT id, COALESCE(permissions, '[]'::jsonb)
      FROM users
      WHERE role = 'EXECUTIVE'
    `);
  }
}
