import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * คำขอเยี่ยมบ้าน is retired (owner decision 2026-08-04): a home-visit task is
 * created directly now, so the request queue in between — submit, review,
 * approve, then assign a task — has no role left. The screens, endpoints and
 * the task-creation branch that consumed a request are gone, and the tables go
 * with them as clearly named archived tables. Keeping the original constraints,
 * indexes and rows intact makes rollback an exact rename instead of an
 * incomplete schema reconstruction that silently loses operational history.
 */
export class RetireStudentFollowUpRequests20260804140000 implements MigrationInterface {
  name = 'RetireStudentFollowUpRequests20260804140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS student_follow_up_request_sources
        RENAME TO retired_student_follow_up_request_sources;
      ALTER TABLE IF EXISTS student_follow_up_requests
        RENAME TO retired_student_follow_up_requests;
      ALTER TABLE IF EXISTS student_follow_up_request_statuses
        RENAME TO retired_student_follow_up_request_statuses;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS retired_student_follow_up_request_statuses
        RENAME TO student_follow_up_request_statuses;
      ALTER TABLE IF EXISTS retired_student_follow_up_requests
        RENAME TO student_follow_up_requests;
      ALTER TABLE IF EXISTS retired_student_follow_up_request_sources
        RENAME TO student_follow_up_request_sources;
    `);
  }
}
