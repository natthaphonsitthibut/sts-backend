const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { CaseService } = require('../dist/task/case.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed a case referral with NODE_ENV=production');
}

const APPLY = process.argv.includes('--apply');
const COUNT = Number(
  (process.argv.find((arg) => arg.startsWith('--count=')) ?? '').split('=')[1] ?? 1,
);
/**
 * Where each seeded referral ends up, spread across the cases in turn so the
 * register shows every state the referral flow can reach:
 *   - `AWAITING`      ส่งต่อ, still รอผลการส่งต่อ
 *   - `NOT_SUCCEEDED` ส่งต่อ → ยังไม่สำเร็จ, back in รอพิจารณา
 *   - `SUCCEEDED`     ส่งต่อ → สำเร็จ → ปิดเคส, closed as ส่งต่อหน่วยงาน
 */
const OUTCOME_SPREAD = ['AWAITING', 'NOT_SUCCEEDED', 'SUCCEEDED'];
const PERMISSIONS = ['dashboard', 'case:assign', 'case:review'];

/**
 * Refers real cases to real agencies, and records what came back, by calling
 * the same `CaseService` methods the review and บันทึกผลการส่งต่อ endpoints
 * call. Every row this writes is one the app itself writes — the review, the
 * referral, its result (FK to the referral and to the reviewer), the case
 * transitions, the audit log and the notifications — so nothing sits in
 * `case_referrals` with a status no flow could have produced.
 *
 * Runs read-only unless `--apply` is passed, so the chosen rows can be checked
 * before anything is written.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dataSource = app.get(DataSource);
  const caseService = app.get(CaseService);

  try {
    // Cases already waiting for review come first — those are referrals the
    // real flow could have produced. Only when there are not enough does the
    // seed move an open case into review itself, which is the step a teacher's
    // submitted report normally performs.
    const caseRecords = await dataSource.query(
      `
      SELECT c.id, c.student_name, c.school_id, c.status,
             school.name AS school_name
      FROM cases c
      LEFT JOIN schools school ON school.id = c.school_id
      WHERE c.status IN ('PENDING_REVIEW', 'OPEN')
        AND c.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM case_referrals existing WHERE existing.case_id = c.id
        )
      ORDER BY (c.status = 'PENDING_REVIEW') DESC, c.updated_at DESC, c.id DESC
      LIMIT $1
      `,
      [COUNT],
    );
    if (caseRecords.length === 0) {
      throw new Error('No case is available to refer');
    }

    const agencies = await dataSource.query(`
      SELECT agency.id, agency.agency_name
      FROM referral_agencies agency
      WHERE agency.is_active = TRUE
      ORDER BY agency.id
    `);
    if (agencies.length === 0) {
      throw new Error('No active referral agency exists to refer the case to');
    }

    // The reviewer is a real account; every review, referral and result below
    // is attributed to it through the service, exactly as a signed-in ผอ.
    const [reviewer] = await dataSource.query(`
      SELECT u.id, u.username, u."FirstName", u."LastName"
      FROM users u
      WHERE u.status = 'ACTIVE'
        AND u.role = 'ADMIN'
      ORDER BY u.id
      LIMIT 1
    `);
    if (!reviewer) {
      throw new Error('No active administrator is available to attribute the review to');
    }

    const planned = caseRecords.map((caseRecord, index) => ({
      caseRecord,
      agency: agencies[index % agencies.length],
      outcome: OUTCOME_SPREAD[index % OUTCOME_SPREAD.length],
    }));
    for (const item of planned) {
      console.log(
        `case ${item.caseRecord.id} ${item.caseRecord.student_name} (${item.caseRecord.school_name ?? 'ไม่ระบุโรงเรียน'})`,
        `→ ${item.agency.agency_name} [${item.outcome}]`,
      );
    }
    console.log('reviewer  :', reviewer.id, reviewer.username);

    if (!APPLY) {
      console.log('\ndry run — pass --apply to write');
      return;
    }

    for (const item of planned) {
      const caseId = Number(item.caseRecord.id);
      // Scoped to the case's own school, the way a school ผอ. would be.
      const actor = {
        id: Number(reviewer.id),
        username: reviewer.username,
        FirstName: reviewer.FirstName,
        LastName: reviewer.LastName,
        roles: ['ADMIN'],
        permissions: PERMISSIONS,
        data_scope: { school_ids: [Number(item.caseRecord.school_id)] },
      };
      if (item.caseRecord.status !== 'PENDING_REVIEW') {
        await dataSource.query(
          `UPDATE cases SET status = 'PENDING_REVIEW' WHERE id = $1 AND deleted_at IS NULL`,
          [caseId],
        );
      }

      const note = `ส่งต่อ ${item.agency.agency_name} เพื่อช่วยเหลือ ${item.caseRecord.student_name}`;
      await caseService.reviewCase(
        caseId,
        {
          review_action: 'REFER_AGENCY',
          review_note: note,
          referral_agency_id: Number(item.agency.id),
        },
        actor,
      );
      if (item.outcome === 'AWAITING') continue;

      const [referral] = await dataSource.query(
        `SELECT id FROM case_referrals WHERE case_id = $1
         ORDER BY referred_at DESC, id DESC LIMIT 1`,
        [caseId],
      );
      const succeeded = item.outcome === 'SUCCEEDED';
      await caseService.recordReferralResult(
        caseId,
        referral.id,
        {
          result_code: succeeded ? 'SUCCEEDED' : 'NOT_SUCCEEDED',
          result_note: succeeded
            ? `${item.agency.agency_name} แจ้งว่าช่วยเหลือเรียบร้อย นักเรียนกลับมาเรียนตามปกติ`
            : `${item.agency.agency_name} แจ้งว่าติดต่อครอบครัวไม่ได้ ยังช่วยเหลือไม่สำเร็จ`,
        },
        actor,
      );
      if (succeeded) {
        await caseService.reviewCase(
          caseId,
          { review_action: 'CLOSE', review_note: 'หน่วยงานช่วยเหลือสำเร็จ ปิดเคส' },
          actor,
        );
      }
    }
    console.log(`\nreferred ${planned.length} case(s)`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
