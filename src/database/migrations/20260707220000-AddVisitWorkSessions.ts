import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVisitWorkSessions20260707220000 implements MigrationInterface {
  name = 'AddVisitWorkSessions20260707220000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS visit_work_sessions (
        id BIGSERIAL PRIMARY KEY,
        task_link_id TEXT NOT NULL
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
    // Guards "one open session per link" at the database level — a guest
    // double-clicking start (or two tabs) cannot open a second session.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_visit_work_sessions_open_per_link
        ON visit_work_sessions (task_link_id)
        WHERE ended_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_visit_work_sessions_task_link_id
        ON visit_work_sessions (task_link_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS visit_position_pings (
        id BIGSERIAL PRIMARY KEY,
        session_id BIGINT NOT NULL
          CONSTRAINT fk_visit_position_pings_session
          REFERENCES visit_work_sessions(id) ON DELETE CASCADE,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_visit_position_pings_session_recorded
        ON visit_position_pings (session_id, recorded_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS visit_position_pings`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_visit_work_sessions_task_link_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_visit_work_sessions_open_per_link`);
    await queryRunner.query(`DROP TABLE IF EXISTS visit_work_sessions`);
  }
}
