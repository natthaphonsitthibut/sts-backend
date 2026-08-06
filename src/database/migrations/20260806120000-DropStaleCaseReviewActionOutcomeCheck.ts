import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `chk_case_reviews_action_outcome` (added in 20260720120000-AlignCaseTrackingWorkflow)
 * hardcodes the old two-action rule: CONTINUE requires a null resolution_outcome,
 * CLOSE requires a non-null one. 20260802120000-UpdateCaseFollowingWorkflow moved
 * the workflow onto `case_review_actions.completion_outcome_code` /
 * `requires_resolution_outcome` instead (CLOSE and the new REFER_AGENCY both have
 * requires_resolution_outcome = FALSE, and CONTINUE was deactivated) but never
 * updated this constraint. Every review submission now sends
 * resolution_outcome: null, which the stale CHECK rejects outright — CLOSE fails
 * its "must be non-null" branch, REFER_AGENCY matches neither branch at all.
 * Resolution-outcome enforcement now lives at the `cases` table level via
 * chk_cases_completion_outcome, so this constraint is fully superseded.
 */
export class DropStaleCaseReviewActionOutcomeCheck20260806120000 implements MigrationInterface {
  name = 'DropStaleCaseReviewActionOutcomeCheck20260806120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_reviews DROP CONSTRAINT IF EXISTS chk_case_reviews_action_outcome
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_reviews ADD CONSTRAINT chk_case_reviews_action_outcome CHECK (
        (review_action = 'CONTINUE' AND resolution_outcome IS NULL)
        OR (review_action = 'CLOSE' AND resolution_outcome IS NOT NULL)
      )
    `);
  }
}
