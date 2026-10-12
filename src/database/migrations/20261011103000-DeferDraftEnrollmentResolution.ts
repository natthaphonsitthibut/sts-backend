import type { MigrationInterface, QueryRunner } from 'typeorm';
import { studentCurrentEnrollmentViewSql } from '../bootstrap-sql';

/** Preparing next term must not replace the student's current enrollment. */
export class DeferDraftEnrollmentResolution20261011103000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(studentCurrentEnrollmentViewSql('STUDYING', 'UNMATCHED', true));
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(studentCurrentEnrollmentViewSql('STUDYING', 'UNMATCHED'));
  }
}
