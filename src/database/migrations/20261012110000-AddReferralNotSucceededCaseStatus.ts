import type { MigrationInterface, QueryRunner } from 'typeorm';

const ACTIVE_CASE_INDEX_SQL = (statuses: string) => `
  CREATE UNIQUE INDEX uq_cases_active_student_uuid
    ON cases(student_uuid)
    WHERE student_uuid IS NOT NULL
      AND deleted_at IS NULL
      AND status IN (${statuses})
`;

/**
 * An agency reporting ยังไม่สำเร็จ now parks the case in ส่งต่อไม่สำเร็จ, the
 * way a visit that found nobody parks it in ไม่พบนักเรียน (owner, 2026-10-12):
 * the result reads on the case's own status instead of a separate ผลการส่งต่อ
 * field, and the school assigns a new follow-up or refers again from there.
 * A สำเร็จ result still goes to รอพิจารณา for the reviewer to close the case.
 *
 * Cases already resting in รอพิจารณา on an unsuccessful referral — its newest
 * referral, nothing assigned since — move to the new status.
 */
export class AddReferralNotSucceededCaseStatus20261012110000 implements MigrationInterface {
  name = 'AddReferralNotSucceededCaseStatus20261012110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO case_workflow_statuses (code, label_th, badge_variant, sort_order)
      VALUES ('REFERRAL_NOT_SUCCEEDED', 'ส่งต่อไม่สำเร็จ', 'destructive', 27)
      ON CONFLICT (code) DO UPDATE SET
        label_th = EXCLUDED.label_th,
        badge_variant = EXCLUDED.badge_variant,
        sort_order = EXCLUDED.sort_order,
        is_active = TRUE,
        deleted_at = NULL
    `);

    // A student whose referral did not succeed still has an open case.
    await queryRunner.query(`DROP INDEX IF EXISTS uq_cases_active_student_uuid`);
    await queryRunner.query(
      ACTIVE_CASE_INDEX_SQL(`
        'OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND',
        'AWAITING_REFERRAL', 'AWAITING_REFERRAL_OUTCOME', 'REFERRAL_NOT_SUCCEEDED'
      `),
    );

    await queryRunner.query(`
      UPDATE cases c
      SET status = 'REFERRAL_NOT_SUCCEEDED'
      FROM case_referrals failed
      WHERE failed.case_id = c.id
        AND failed.status_code = 'NOT_SUCCEEDED'
        AND c.status = 'PENDING_REVIEW'
        AND c.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM case_referrals newer
          WHERE newer.case_id = c.id
            AND (newer.referred_at, newer.id) > (failed.referred_at, failed.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM tasks later_task
          WHERE later_task.case_id = c.id
            AND later_task.deleted_at IS NULL
            AND later_task.created_at > failed.referred_at
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The old flow kept these cases in รอพิจารณา; put them back before the
    // status they hold disappears.
    await queryRunner.query(`
      UPDATE cases SET status = 'PENDING_REVIEW' WHERE status = 'REFERRAL_NOT_SUCCEEDED'
    `);
    await queryRunner.query(`
      UPDATE notifications SET case_status_code = 'PENDING_REVIEW'
      WHERE case_status_code = 'REFERRAL_NOT_SUCCEEDED'
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_cases_active_student_uuid`);
    await queryRunner.query(
      ACTIVE_CASE_INDEX_SQL(`
        'OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND',
        'AWAITING_REFERRAL', 'AWAITING_REFERRAL_OUTCOME'
      `),
    );
    await queryRunner.query(
      `DELETE FROM case_workflow_statuses WHERE code = 'REFERRAL_NOT_SUCCEEDED'`,
    );
  }
}
