import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aligns the observation schema with the active-row contract already used by
 * review, reporting, and export queries. Existing observations remain active.
 */
export class AddStudentObservationSoftDeleteTimestamp20260714300000 implements MigrationInterface {
  name = 'AddStudentObservationSoftDeleteTimestamp20260714300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_observations
        ADD COLUMN deleted_at TIMESTAMPTZ;

      DROP INDEX idx_student_observations_student_timeline;
      CREATE INDEX idx_student_observations_student_timeline
        ON student_observations (student_uuid, observed_at DESC, id DESC)
        WHERE deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_student_observations_student_timeline;
      CREATE INDEX idx_student_observations_student_timeline
        ON student_observations (student_uuid, observed_at DESC, id DESC);
      ALTER TABLE student_observations
        DROP COLUMN IF EXISTS deleted_at;
    `);
  }
}
