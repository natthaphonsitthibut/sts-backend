import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives every referral made before outcome tracking a result, so no referral
 * is left floating with a status nobody recorded (owner, 2026-10-08: change
 * the status rather than delete, and tie it to real rows).
 *
 * Before 20261008100000 a referral closed its case on the spot and nothing
 * ever answered it, so those referrals still read `REFERRED` (or a fixture
 * status the old seed spread across them). Each one now gets a
 * `case_referral_results` row — FK to its referral, recorded by the user who
 * sent it (FK to users, NULL only where the referral never had one) at the
 * moment it was sent — and the status the new flow would have produced:
 *   - ส่งต่อแล้ว / หน่วยงานรับแล้ว / เสร็จสิ้น → `COMPLETED`: the case was
 *     closed as referred, which is what สำเร็จ then ปิดเคส ends in.
 *   - หน่วยงานปฏิเสธ / ยกเลิก → `NOT_SUCCEEDED`; when that referral is the
 *     case's last one its closed case reads ปิดเคส rather than ส่งต่อหน่วยงาน.
 * The note says it was filled in by the system and names the old status.
 * A case still waiting on its referral is left alone.
 *
 * `down()` does not undo this: the old statuses only survive in the notes.
 */
export class BackfillLegacyReferralResults20261008110000 implements MigrationInterface {
  name = 'BackfillLegacyReferralResults20261008110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const legacy = `
      FROM case_referrals referral
      JOIN cases c ON c.id = referral.case_id
      WHERE c.status <> 'AWAITING_REFERRAL_OUTCOME'
        AND referral.status_code IN ('REFERRED', 'ACCEPTED', 'COMPLETED', 'DECLINED', 'CANCELLED')
        AND NOT EXISTS (
          SELECT 1 FROM case_referral_results recorded
          WHERE recorded.case_referral_id = referral.id
        )`;

    // Notes first: they quote the status the referral had before this runs.
    await queryRunner.query(`
      INSERT INTO case_referral_results (
        case_referral_id, result_note, recorded_at, recorded_by_user_id
      )
      SELECT referral.id,
        concat(
          'บันทึกย้อนหลังโดยระบบ: ส่งต่อก่อนมีการบันทึกผลการส่งต่อ (สถานะเดิม: ',
          COALESCE(status.label_th, referral.status_code),
          ')'
        ),
        referral.referred_at,
        COALESCE(referral.referred_by_user_id, review.source_actor_user_id)
      FROM case_referrals referral
      JOIN cases c ON c.id = referral.case_id
      LEFT JOIN case_referral_statuses status ON status.code = referral.status_code
      LEFT JOIN case_reviews review ON review.id = referral.case_review_id
      WHERE referral.id IN (SELECT referral.id ${legacy})
    `);

    await queryRunner.query(`
      UPDATE cases c
      SET completion_outcome_code = 'CLOSED'
      WHERE c.status = 'RESOLVED'
        AND c.completion_outcome_code = 'REFERRED_AGENCY'
        AND EXISTS (
          SELECT 1 FROM case_referrals latest
          WHERE latest.case_id = c.id
            AND latest.status_code IN ('DECLINED', 'CANCELLED')
            AND NOT EXISTS (
              SELECT 1 FROM case_referrals newer
              WHERE newer.case_id = latest.case_id
                AND (newer.referred_at, newer.id) > (latest.referred_at, latest.id)
            )
        )
    `);

    await queryRunner.query(`
      UPDATE case_referrals referral
      SET status_code = CASE
        WHEN referral.status_code IN ('DECLINED', 'CANCELLED') THEN 'NOT_SUCCEEDED'
        ELSE 'COMPLETED'
      END
      FROM cases c
      WHERE c.id = referral.case_id
        AND c.status <> 'AWAITING_REFERRAL_OUTCOME'
        AND referral.status_code IN ('REFERRED', 'ACCEPTED', 'DECLINED', 'CANCELLED')
    `);
  }

  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    return Promise.resolve();
  }
}
