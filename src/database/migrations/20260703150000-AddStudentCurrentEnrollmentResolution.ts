import type { MigrationInterface, QueryRunner } from 'typeorm';
import { studentCurrentEnrollmentViewSql } from '../bootstrap-sql';

export class AddStudentCurrentEnrollmentResolution20260703150000 implements MigrationInterface {
  name = 'AddStudentCurrentEnrollmentResolution20260703150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(studentCurrentEnrollmentViewSql('ACTIVE', 'UNMAPPED'));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS student_current_enrollment_resolution`);
  }
}
