const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { CaseService } = require('../dist/task/case.service');
const { AraIdService } = require('../dist/araid/araid.service');
const { AuthActorService } = require('../dist/auth/auth-actor.service');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { ReferralLinkService } = require('../dist/task/referral-link.service');

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
 *   - `AWAITING`      ส่งต่อ with an open agency link, still รอผลการส่งต่อ
 *   - `NOT_SUCCEEDED` ส่งต่อ → ยังไม่สำเร็จ, back in รอพิจารณา
 *   - `SUCCEEDED`     ส่งต่อ → สำเร็จ → ปิดเคส, closed as เสร็จสิ้น
 */
const OUTCOME_SPREAD = ['AWAITING', 'NOT_SUCCEEDED', 'SUCCEEDED'];

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
  const referralLinks = app.get(ReferralLinkService);

  try {
    // Use genuine submitted cases only; never manufacture a teacher submission.
    const caseRecords = await dataSource.query(
      `
      SELECT c.id, c.student_name, c.school_id, c.status,
             school.name AS school_name
      FROM cases c
      LEFT JOIN schools school ON school.id = c.school_id
      WHERE c.status = 'PENDING_REVIEW'
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

    // Existing AraID identity, supplied via stdin so no PIN is stored in code/logs.
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const identity = JSON.parse(raw);
    if (!/^\d{13}$/.test(identity.identityNumber) || !/^\d{8}$/.test(identity.pin)) {
      throw new Error('AraID identity number and PIN are required via stdin');
    }
    const araId = app.get(AraIdService);
    await araId.login(identity.identityNumber, identity.pin);
    let cookie = '';
    app.get(SessionCookieService).setSession(
      {
        cookie: (name, value) => {
          cookie = `${name}=${encodeURIComponent(value)}`;
        },
      },
      Number(reviewer.id),
    );
    const actor = await app.get(AuthActorService).loadRequiredUser({ headers: { cookie } });
    if (!actor) throw new Error('Administrator is unavailable');

    for (const item of planned) {
      const caseId = Number(item.caseRecord.id);
      const note = `ส่งต่อ ${item.agency.agency_name} เพื่อช่วยเหลือ ${item.caseRecord.student_name}`;
      // ส่งต่อหน่วยงาน decides; sending from the case page picks the agency and
      // issues its link, as the school would.
      await caseService.reviewCase(
        caseId,
        { review_action: 'REFER_AGENCY', review_note: note },
        actor,
      );
      const sent = await referralLinks.sendReferral(
        caseId,
        {
          referral_agency_id: Number(item.agency.id),
          referral_note: note,
          starts_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        },
        actor,
      );
      if (item.outcome === 'AWAITING') continue;

      const succeeded = item.outcome === 'SUCCEEDED';
      const token = sent.data.url.split('/referral-report/')[1];
      const challenge = await referralLinks.createAraIdChallenge(
        token,
        { access_code: sent.data.access_code },
        'http://localhost:5173',
      );
      const authorization = await referralLinks.beginAraIdChallenge(challenge.data.challengeToken);
      const profile = await araId.login(identity.identityNumber, identity.pin);
      await referralLinks.approveAraIdChallenge(
        authorization.authorizationToken,
        profile.profileId,
        Date.now(),
      );
      const verified = await referralLinks.pollAraIdChallenge(challenge.data.challengeToken);
      await referralLinks.submitReport(
        token,
        {
          result_code: succeeded ? 'SUCCEEDED' : 'NOT_SUCCEEDED',
          action_at: new Date().toISOString(),
          result_note: succeeded
            ? `${item.agency.agency_name} แจ้งว่าช่วยเหลือเรียบร้อย นักเรียนกลับมาเรียนตามปกติ`
            : `${item.agency.agency_name} แจ้งว่าติดต่อครอบครัวไม่ได้ ยังช่วยเหลือไม่สำเร็จ`,
        },
        verified.data.sessionToken,
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

main().catch(() => {
  console.error(
    'Referral preparation failed; credentials withheld. Check dry-run prerequisites before resuming.',
  );
  process.exitCode = 1;
});
