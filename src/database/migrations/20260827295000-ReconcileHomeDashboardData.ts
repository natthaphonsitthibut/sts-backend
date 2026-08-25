import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  STUDENT_CURRENT_ENROLLMENT_VIEW_SQL,
  studentCurrentEnrollmentViewSql,
} from '../bootstrap-sql';

const LEGACY_CASE_IDS = [1339, 1534, 2596] as const;
const LEGACY_CURRENT_ENROLLMENT_VIEW_SQL = studentCurrentEnrollmentViewSql('ACTIVE', 'UNMAPPED');

/**
 * Repairs two independently observed dashboard gaps after the master-data rename:
 * the current-enrollment view still selected the retired ACTIVE category, and
 * three reviewed legacy visits predated the normalized problem-category field.
 */
export class ReconcileHomeDashboardData20260827295000 implements MigrationInterface {
  name = 'ReconcileHomeDashboardData20260827295000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(STUDENT_CURRENT_ENROLLMENT_VIEW_SQL);

    await queryRunner.query(`
      CREATE TABLE home_dashboard_category_reconcile_20260824_backup (
        task_submission_id INTEGER PRIMARY KEY,
        CONSTRAINT fk_home_dashboard_category_reconcile_submission
          FOREIGN KEY (task_submission_id)
          REFERENCES task_submissions(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(
      `
        INSERT INTO home_dashboard_category_reconcile_20260824_backup (task_submission_id)
        SELECT submission.id
        FROM task_submissions submission
        JOIN task_links link
          ON link.id = submission.task_link_id
         AND link.deleted_at IS NULL
        JOIN tasks task
          ON task.id = link.task_id
         AND task.deleted_at IS NULL
         AND task.task_type = 'VISIT'
         AND task.status = 'COMPLETED'
        JOIN cases tracked_case
          ON tracked_case.id = task.case_id
         AND tracked_case.deleted_at IS NULL
         AND tracked_case.status = 'RESOLVED'
         AND tracked_case.completion_outcome_code = 'CLOSED'
        WHERE tracked_case.id = ANY($1::integer[])
          AND submission.deleted_at IS NULL
          AND submission.follow_up_problem_category_code IS NULL
          AND submission.case_follow_up_decision = 'REQUEST_REVIEW'
          AND submission.case_resolution_outcome_code IS NULL
          AND EXISTS (
            SELECT 1
            FROM case_reviews review
            WHERE review.case_id = tracked_case.id
              AND review.review_action = 'CLOSE'
          )
      `,
      [LEGACY_CASE_IDS],
    );
    await queryRunner.query(`
      ALTER TABLE home_dashboard_category_reconcile_20260824_backup
        ENABLE ROW LEVEL SECURITY
    `);
    await queryRunner.query(`
      DO $secure_home_dashboard_reconcile$
      DECLARE role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON TABLE home_dashboard_category_reconcile_20260824_backup FROM %I',
              role_name
            );
          END IF;
        END LOOP;
      END
      $secure_home_dashboard_reconcile$
    `);
    await queryRunner.query(`
      UPDATE task_submissions submission
      SET follow_up_problem_category_code = 'OTHER'
      FROM home_dashboard_category_reconcile_20260824_backup backup
      WHERE backup.task_submission_id = submission.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE task_submissions submission
      SET follow_up_problem_category_code = NULL
      FROM home_dashboard_category_reconcile_20260824_backup backup
      WHERE backup.task_submission_id = submission.id
        AND submission.follow_up_problem_category_code = 'OTHER'
    `);
    await queryRunner.query(`DROP TABLE home_dashboard_category_reconcile_20260824_backup`);
    await queryRunner.query(LEGACY_CURRENT_ENROLLMENT_VIEW_SQL);
  }
}
