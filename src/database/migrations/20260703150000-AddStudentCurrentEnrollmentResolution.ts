import type { MigrationInterface, QueryRunner } from 'typeorm';
import { STUDENT_CURRENT_ENROLLMENT_VIEW_SQL } from '../bootstrap-sql';

export class AddStudentCurrentEnrollmentResolution20260703150000 implements MigrationInterface {
  name = 'AddStudentCurrentEnrollmentResolution20260703150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(STUDENT_CURRENT_ENROLLMENT_VIEW_SQL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS student_current_enrollment_resolution`);
  }
}
