/** Local repair, owner-requested 2026-10-11: referral cases seeded before the
 * referral flow existed jump straight to ส่งต่อ with no follow-up round, and
 * some sit closed although their referral ended ยังไม่สำเร็จ — states no flow can
 * produce. This gives each one the round it is missing (assignment to the
 * student's real homeroom teacher → visit report → the existing ส่งต่อ review)
 * and returns the unsuccessful ones to รอพิจารณา.
 * Dry-run by default; `--apply` writes. Re-running finds nothing left to repair.
 */
const { createHash } = require('node:crypto');
const { generateToken, hashToken } = require('../dist/common/utils/helpers');

// Snapshot of the owner-approved local cohort's immutable identity, read on
// 2026-10-12. Hashes avoid embedding student references in the repair source.
const LEGACY_CASE_FINGERPRINTS = Object.freeze({
  3321: '8a199ab5ce7e97a444230c610789f82894700025ea88cb0add182d2eff9f72fa',
  3322: '4ad19fa79971dacc98adbca4076b3561a7d56b92d35caf0894d966ac3a225e08',
  3323: '959d711407364349a3d1b5709ebd5aa6cdca80124fcdd4363b8a81643df57079',
  3324: 'dbe587df96e4cdac16dfefd5d02c62641247f3b7a3deda53a36c620c828ec6b0',
  3325: '85f15638d81aeab8f451dbc464409524ada6c1f8e90a4e97f73be6a1ed324eae',
  3326: '53206a67b1731cc15383c1699308fa719ab92d913d813b3e9a4e5e4b510c4899',
  3327: '43957a8c1e94c7b3cb2205c66b54a74598be9b65380ff435932efde2c4ed3b41',
  3328: 'fd54ea7f9a6fbb2ae67028627b8f00289faf0b0ded8eadbc3d3c0c571b0c4515',
});
const LEGACY_CASE_IDS = Object.keys(LEGACY_CASE_FINGERPRINTS).map(Number);

function caseFingerprint(row) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        Number(row.id),
        row.student_uuid,
        Number(row.school_id),
        new Date(row.created_at).toISOString(),
        row.referral_id,
        new Date(row.referred_at).toISOString(),
        Number(row.referral_agency_id),
        Number(row.referred_by_user_id),
      ]),
    )
    .digest('hex');
}

const VISIT_FINDING =
  'ลงพื้นที่พบผู้ปกครอง นักเรียนขาดเรียนต่อเนื่องจากปัญหาภายในครอบครัว โรงเรียนช่วยเหลือเองได้จำกัด';
const VISIT_RECOMMENDATION =
  'เสนอส่งต่อหน่วยงานที่เกี่ยวข้องเพื่อช่วยเหลือครอบครัวและติดตามการกลับมาเรียน';
const DAY_MS = 86_400_000;

// The expected fingerprints may be injected by isolated fixture tests only;
// the CLI always uses the snapshot above and exposes no cohort override.
async function repairLegacyReferralCases(
  db,
  tokenEncryption,
  apply,
  expectedFingerprints = LEGACY_CASE_FINGERPRINTS,
) {
  return db.transaction(async (manager) => {
    // Serialize repeat/concurrent runs before checking whether a round exists.
    const cohort = await manager.query(
      `
      SELECT c.id, c.student_uuid::text AS student_uuid, c.school_id, c.created_at,
        referral.id AS referral_id, referral.referred_at,
        referral.referral_agency_id, referral.referred_by_user_id
      FROM cases c
      JOIN LATERAL (
        SELECT id, referred_at, referral_agency_id, referred_by_user_id
        FROM case_referrals WHERE case_id = c.id ORDER BY referred_at, id LIMIT 1
      ) referral ON true
      WHERE c.id = ANY($1::int[]) AND c.deleted_at IS NULL
      ORDER BY c.id FOR UPDATE OF c`,
      [LEGACY_CASE_IDS],
    );
    if (cohort.length !== LEGACY_CASE_IDS.length) {
      throw new Error('The approved legacy referral cohort is incomplete; refusing repair');
    }
    for (const row of cohort) {
      if (caseFingerprint(row) !== expectedFingerprints[Number(row.id)]) {
        throw new Error(
          `Case ${row.id} does not match the approved seed fingerprint; refusing repair`,
        );
      }
    }

    // Referred with no assignment ever made: the round before the referral is missing.
    const missingRound = await manager.query(
      `
      SELECT c.id, c.student_uuid::text AS student_uuid, c.school_id, c.created_at,
        referral.referred_at, referral.referred_by_user_id,
        teacher.id AS teacher_id,
        concat_ws(' ', teacher.first_name, teacher.last_name) AS teacher_name,
        teacher.email AS teacher_email
      FROM cases c
      JOIN LATERAL (
        SELECT referred_at, referred_by_user_id FROM case_referrals
        WHERE case_id = c.id ORDER BY referred_at, id LIMIT 1
      ) referral ON true
      LEFT JOIN student_term student ON student.student_uuid = c.student_uuid
      LEFT JOIN LATERAL (
        SELECT membership.teacher_id FROM classroom_homeroom_teachers homeroom
        JOIN school_teacher_memberships membership ON membership.id = homeroom.teacher_membership_id
        WHERE homeroom.classroom_id = student.classroom_id
        ORDER BY homeroom.created_at, homeroom.teacher_membership_id LIMIT 1
      ) homeroom ON true
      LEFT JOIN teachers teacher ON teacher.id = homeroom.teacher_id
      WHERE c.deleted_at IS NULL
        AND c.id = ANY($1::int[])
        AND NOT EXISTS (SELECT 1 FROM tasks task WHERE task.case_id = c.id)
      ORDER BY c.id`,
      [LEGACY_CASE_IDS],
    );
    // Closed although the newest referral did not succeed and nobody chose ปิดเคส.
    const wronglyClosed = await manager.query(
      `
      SELECT c.id, c.student_uuid::text AS student_uuid
      FROM cases c
      JOIN LATERAL (
        SELECT status_code FROM case_referrals
        WHERE case_id = c.id ORDER BY referred_at DESC, id DESC LIMIT 1
      ) latest ON true
      WHERE c.deleted_at IS NULL AND c.status = 'RESOLVED' AND latest.status_code = 'NOT_SUCCEEDED'
        AND c.id = ANY($1::int[])
        AND NOT EXISTS (
          SELECT 1 FROM case_reviews review WHERE review.case_id = c.id AND review.review_action = 'CLOSE'
        )
      ORDER BY c.id`,
      [LEGACY_CASE_IDS],
    );
    const withoutTeacher = missingRound.filter((row) => !row.teacher_id);
    console.log(
      JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        missingRound: missingRound.map((row) => Number(row.id)),
        wronglyClosed: wronglyClosed.map((row) => Number(row.id)),
        withoutHomeroomTeacher: withoutTeacher.map((row) => Number(row.id)),
      }),
    );
    if (withoutTeacher.length) {
      throw new Error('Some cases have no homeroom teacher to assign the missing round to');
    }
    if (!apply) return [];

    for (const row of missingRound) {
      const created = new Date(row.created_at).getTime();
      const referred = new Date(row.referred_at).getTime();
      if (referred - created < 2 * DAY_MS) {
        throw new Error(`Case ${row.id} leaves no room for a round before its referral`);
      }
      const assignedAt = new Date(created + DAY_MS);
      const visitedAt = new Date(referred - DAY_MS);
      const submittedAt = new Date(visitedAt.getTime() + 2 * 3_600_000);
      const token = generateToken();
      const [task] = await manager.query(
        `INSERT INTO tasks (case_id, status, task_type, target_school_id,
             created_at, updated_at, created_by, updated_by)
           VALUES ($1, 'COMPLETED', 'VISIT', $2, $3, $4, $5, $5) RETURNING id`,
        [row.id, row.school_id, assignedAt, submittedAt, row.referred_by_user_id],
      );
      const [link] = await manager.query(
        `INSERT INTO task_links (task_id, token_hash, token_encrypted, assigned_to_name,
             assigned_to_email, assigned_teacher_id, status, admin_locked, expires_at,
             created_at, updated_at, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED', 0, $7, $8, $9, $10, $10) RETURNING id`,
        [
          task.id,
          hashToken(token),
          tokenEncryption.encrypt(token),
          row.teacher_name,
          row.teacher_email,
          row.teacher_id,
          new Date(assignedAt.getTime() + 30 * DAY_MS),
          assignedAt,
          submittedAt,
          row.referred_by_user_id,
        ],
      );
      await manager.query(
        `INSERT INTO task_submissions (task_link_id, cause_detail, recommendation,
             submitted_at, address_changed, created_at, updated_at, case_follow_up_decision,
             visited_at, task_execution_outcome_code)
           VALUES ($1, $2, $3, $4, FALSE, $4, $4, 'REQUEST_REVIEW', $5, 'SUCCEEDED')`,
        [link.id, VISIT_FINDING, VISIT_RECOMMENDATION, submittedAt, visitedAt],
      );
      await manager.query(
        `UPDATE cases SET result_summary = COALESCE(result_summary, $2) WHERE id = $1`,
        [row.id, VISIT_FINDING],
      );
      console.log(`case ${row.id}: added the follow-up round before its referral`);
    }
    for (const row of wronglyClosed) {
      await manager.query(
        `UPDATE cases SET status = 'PENDING_REVIEW', completion_outcome_code = NULL,
             updated_at = now() WHERE id = $1 AND status = 'RESOLVED'`,
        [row.id],
      );
      console.log(`case ${row.id}: back to รอพิจารณา (its referral ended ยังไม่สำเร็จ)`);
    }
    return wronglyClosed.map((row) => row.student_uuid).filter(Boolean);
  });
}

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { DataSource } = require('typeorm');
  const { AppModule } = require('../dist/app.module');
  const { TokenEncryptionService } = require('../dist/common/crypto/token-encryption.service');
  const { RiskProfileService } = require('../dist/risk-profile/risk-profile.service');
  if (process.env.NODE_ENV === 'production' || (process.env.DB_NAME || 'sts') !== 'sts') {
    throw new Error('This repair is restricted to the local DB_NAME=sts');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const db = app.get(DataSource);
    if (
      db.options.database !== 'sts' ||
      !['localhost', '127.0.0.1', '::1'].includes(db.options.host)
    ) {
      throw new Error('This repair requires the local sts database');
    }
    const reopened = await repairLegacyReferralCases(
      db,
      app.get(TokenEncryptionService),
      process.argv.includes('--apply'),
    );
    if (reopened.length) {
      await app
        .get(RiskProfileService)
        .requestStudentRecalculation(reopened, 'legacy-referral-case-repair', true);
    }
  } finally {
    await app.close();
  }
}

module.exports = { repairLegacyReferralCases, caseFingerprint, LEGACY_CASE_IDS };
if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
