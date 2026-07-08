import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubjectLateCountToRiskProfiles20260708120000 implements MigrationInterface {
  name = 'AddSubjectLateCountToRiskProfiles20260708120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE student_risk_profiles ADD COLUMN IF NOT EXISTS subject_late_count INTEGER NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE student_risk_profiles DROP COLUMN IF EXISTS subject_late_count`,
    );
  }
}
