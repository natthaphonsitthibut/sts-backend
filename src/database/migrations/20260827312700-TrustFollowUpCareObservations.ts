import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Treats verified-teacher follow-up observations as source-attributed facts
 * without a fake review gate. A row a reviewer already refused stays refused:
 * dropping the gate must not silently promote a `REJECTED` observation.
 */
export class TrustFollowUpCareObservations20260827312700 implements MigrationInterface {
  name = 'TrustFollowUpCareObservations20260827312700';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO student_term_disadvantages (
        student_uuid, disadvantage_type_code, recorded_at, recorded_by_user_id
      )
      SELECT cases.student_uuid, observation.disadvantage_type_code,
        observation.observed_at, observation.reviewed_by_user_id
      FROM home_visit_disadvantage_observations observation
      JOIN task_submissions submission ON submission.id = observation.task_submission_id
      JOIN task_links link ON link.id = submission.task_link_id
      JOIN tasks task ON task.id = link.task_id
      JOIN cases ON cases.id = task.case_id
      WHERE cases.student_uuid IS NOT NULL
        AND observation.verification_status <> 'REJECTED'
      ON CONFLICT (student_uuid, disadvantage_type_code) DO UPDATE SET
        recorded_at = EXCLUDED.recorded_at,
        recorded_by_user_id = EXCLUDED.recorded_by_user_id
    `);
    await queryRunner.query(`
      INSERT INTO student_disabilities (
        student_uuid, disability_type_code, recorded_at, recorded_by_user_id
      )
      SELECT cases.student_uuid, observation.disability_type_code,
        observation.observed_at, observation.reviewed_by_user_id
      FROM home_visit_disability_observations observation
      JOIN task_submissions submission ON submission.id = observation.task_submission_id
      JOIN task_links link ON link.id = submission.task_link_id
      JOIN tasks task ON task.id = link.task_id
      JOIN cases ON cases.id = task.case_id
      WHERE cases.student_uuid IS NOT NULL
        AND observation.verification_status <> 'REJECTED'
      ON CONFLICT (student_uuid, disability_type_code) DO UPDATE SET
        recorded_at = EXCLUDED.recorded_at,
        recorded_by_user_id = EXCLUDED.recorded_by_user_id
    `);

    for (const [table, codeColumn] of [
      ['home_visit_disadvantage_observations', 'disadvantage_type_code'],
      ['home_visit_disability_observations', 'disability_type_code'],
    ] as const) {
      await queryRunner.query(`DELETE FROM ${table} WHERE verification_status = 'REJECTED'`);
      await queryRunner.query(`DROP INDEX IF EXISTS idx_${table}_status_time`);
      await queryRunner.query(`DROP INDEX IF EXISTS idx_${table}_type_status`);
      await queryRunner.query(`
        ALTER TABLE ${table}
          DROP CONSTRAINT IF EXISTS chk_${table}_note,
          DROP CONSTRAINT IF EXISTS chk_${table}_review_state,
          DROP CONSTRAINT IF EXISTS chk_${table}_status,
          DROP CONSTRAINT IF EXISTS fk_${table}_reviewer,
          DROP COLUMN IF EXISTS verification_status,
          DROP COLUMN IF EXISTS reviewed_at,
          DROP COLUMN IF EXISTS reviewed_by_user_id,
          DROP COLUMN IF EXISTS review_note
      `);
      await queryRunner.query(`
        CREATE INDEX idx_${table}_type_observed
        ON ${table} (${codeColumn}, observed_at DESC)
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, codeColumn] of [
      ['home_visit_disadvantage_observations', 'disadvantage_type_code'],
      ['home_visit_disability_observations', 'disability_type_code'],
    ] as const) {
      await queryRunner.query(`DROP INDEX IF EXISTS idx_${table}_type_observed`);
      await queryRunner.query(`
        ALTER TABLE ${table}
          ADD COLUMN verification_status VARCHAR(20) NOT NULL DEFAULT 'APPROVED',
          ADD COLUMN reviewed_at TIMESTAMPTZ,
          ADD COLUMN reviewed_by_user_id INTEGER,
          ADD COLUMN review_note VARCHAR(1000)
      `);
      await queryRunner.query(`UPDATE ${table} SET reviewed_at = observed_at`);
      await queryRunner.query(`
        ALTER TABLE ${table}
          ADD CONSTRAINT fk_${table}_reviewer FOREIGN KEY (reviewed_by_user_id)
            REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
          ADD CONSTRAINT chk_${table}_status CHECK (
            verification_status IN ('PENDING', 'APPROVED', 'REJECTED')
          ),
          ADD CONSTRAINT chk_${table}_review_state CHECK (
            (verification_status = 'PENDING' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
            OR (verification_status IN ('APPROVED', 'REJECTED') AND reviewed_at IS NOT NULL)
          ),
          ADD CONSTRAINT chk_${table}_note CHECK (
            review_note IS NULL OR length(btrim(review_note)) BETWEEN 1 AND 1000
          )
      `);
      await queryRunner.query(`
        CREATE INDEX idx_${table}_status_time
        ON ${table} (verification_status, observed_at DESC)
      `);
      await queryRunner.query(`
        CREATE INDEX idx_${table}_type_status
        ON ${table} (${codeColumn}, verification_status)
      `);
    }
  }
}
