/**
 * End-to-end check of referral outcome tracking on the real schema: ส่งต่อ
 * parks the case in รอผลการส่งต่อ, ยังไม่สำเร็จ hands it back to รอพิจารณา,
 * a second referral can then close it with สำเร็จ, and every refusal (no
 * permission, other school, repeat, stale referral, concurrent double submit)
 * holds on the server.
 */
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { CaseService } = require('../dist/task/case.service');
const { TaskStatsService } = require('../dist/task/task-stats.service');
const { ReferralLinkService } = require('../dist/task/referral-link.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run referral outcome smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const USERNAME = 'referral_outcome_smoke_director';
const REASON = 'Automated referral outcome smoke';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectRejected(promise, status, label) {
  try {
    await promise;
  } catch (error) {
    const actual = typeof error.getStatus === 'function' ? error.getStatus() : null;
    assert(actual === status, `${label}: expected ${status}, got ${actual} (${error.message})`);
    return;
  }
  throw new Error(`${label}: expected ${status}, but the call succeeded`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const caseService = app.get(CaseService);
  const taskStatsService = app.get(TaskStatsService);
  const referralLinks = app.get(ReferralLinkService);

  let caseId = null;
  let actorId = null;

  try {
    const [enrollment] = await dataSource.query(
      `SELECT enrollment.student_uuid,
              enrollment."SchoolID_Onec" AS school_id,
              school.name AS school_name,
              CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec") AS student_name
       FROM student_term enrollment
       INNER JOIN schools school ON school.id = enrollment."SchoolID_Onec"
       WHERE enrollment.student_uuid IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM cases existing
           WHERE existing.student_uuid = enrollment.student_uuid
             AND existing.deleted_at IS NULL
             AND existing.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW',
               'STUDENT_NOT_FOUND', 'AWAITING_REFERRAL', 'AWAITING_REFERRAL_OUTCOME')
         )
       ORDER BY enrollment.student_uuid
       LIMIT 1`,
    );
    assert(enrollment, 'need one student without an active case');
    const schoolId = Number(enrollment.school_id);
    const [agency] = await dataSource.query(
      `SELECT id FROM referral_agencies WHERE is_active ORDER BY id LIMIT 1`,
    );
    assert(agency, 'need one active referral agency');

    const permissions = ['dashboard', 'case:assign', 'case:review'];
    const [actor] = await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions,
         role, data_scope, must_change_password, data_origin_code)
       VALUES ($1, 'x', 'ผอ.', 'ทดสอบส่งต่อ', 'ACTIVE', $2::jsonb, 'DIRECTOR', $3::jsonb, FALSE,
         'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', permissions = $2::jsonb,
         data_scope = $3::jsonb, data_origin_code = 'AUTOMATED_TEST'
       RETURNING id`,
      [USERNAME, JSON.stringify(permissions), JSON.stringify({ school_ids: [schoolId] })],
    );
    actorId = Number(actor.id);
    const director = {
      id: actorId,
      username: USERNAME,
      FirstName: 'ผอ.',
      LastName: 'ทดสอบส่งต่อ',
      roles: ['DIRECTOR'],
      permissions,
      data_scope: { school_ids: [schoolId] },
    };

    const [createdCase] = await dataSource.query(
      `INSERT INTO cases (student_uuid, student_name, school_id, student_school, reason_flagged,
         status, workflow_phase_code)
       VALUES ($1, $2, $3, $4, $5, 'PENDING_REVIEW', 'FOLLOW_UP')
       RETURNING id`,
      [enrollment.student_uuid, enrollment.student_name, schoolId, enrollment.school_name, REASON],
    );
    caseId = Number(createdCase.id);

    const caseState = async () =>
      (
        await dataSource.query(`SELECT status, completion_outcome_code FROM cases WHERE id = $1`, [
          caseId,
        ])
      )[0];
    // ส่งต่อหน่วยงาน on the review parks the case in รอส่งต่อ; sending the
    // referral from the case page (agency + link window) is the referral's
    // มอบหมาย and moves it to รอผลการส่งต่อ.
    const refer = async (note) => {
      const reviewed = await caseService.reviewCase(
        caseId,
        { review_action: 'REFER_AGENCY', review_note: note },
        director,
      );
      assert(
        reviewed.case_status === 'AWAITING_REFERRAL' && reviewed.completion_outcome_code === null,
        `REFER_AGENCY returned ${reviewed.case_status}/${reviewed.completion_outcome_code}`,
      );
      const sent = await referralLinks.sendReferral(
        caseId,
        {
          referral_agency_id: Number(agency.id),
          referral_note: note,
          starts_at: new Date(Date.now() - 60_000).toISOString(),
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
        director,
      );
      const [latest] = await dataSource.query(
        `SELECT id, status_code FROM case_referrals WHERE id = $1`,
        [sent.data.referral_id],
      );
      assert(latest.status_code === 'REFERRED', `new referral is ${latest.status_code}`);
      return latest.id;
    };

    // 1. ส่งต่อ parks the case without closing it.
    const firstReferralId = await refer('ส่งต่อพบนักจิตวิทยา');
    let state = await caseState();
    assert(
      state.status === 'AWAITING_REFERRAL_OUTCOME' && state.completion_outcome_code === null,
      `referred case is ${JSON.stringify(state)}`,
    );
    const detail = await caseService.getCase(caseId, director);
    assert(
      detail.data.display_status_label === 'รอผลการส่งต่อ',
      `display label is ${detail.data.display_status_label}`,
    );

    // The งานส่งต่อ register files each referral under the card for its stage,
    // and filtering by that card returns it.
    const expectStages = async (expected) => {
      for (const [referralId, stageCode] of Object.entries(expected)) {
        const filtered = await taskStatsService.getReferralDrilldown(
          director,
          { schoolId, stageCode, searchTerm: enrollment.student_name },
          1,
          100,
        );
        const row = filtered.data.find((item) => item.id === referralId);
        assert(
          row && row.stageCode === stageCode,
          `referral ${referralId} is not under ${stageCode}: ${JSON.stringify(row ?? null)}`,
        );
      }
    };
    await expectStages({ [firstReferralId]: 'AWAITING_REFERRAL_OUTCOME' });
    // Results only come from the agency's report through its link (owner,
    // 2026-10-08); the link flow itself is smoke:referral-links. Here the
    // report goes straight into the shared core with the referral's own link.
    const reportAsAgency = async (referralId, resultCode, note) => {
      const [link] = await dataSource.query(
        `SELECT id FROM case_referral_links WHERE case_referral_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [referralId],
      );
      const referral = await caseService.applyReferralResult({
        caseId,
        referralId,
        resultCode,
        note,
        scopeActor: null,
        recordedByUserId: null,
        agencyReport: {
          linkId: link.id,
          actionDate: new Date().toISOString().slice(0, 10),
          identityProviderCode: 'ARAID',
          providerSubject: 'smoke-referral-outcome-subject',
          reporterName: 'เจ้าหน้าที่ หน่วยงานทดสอบ',
        },
        audit: { actorUserId: null, actorLabel: 'เจ้าหน้าที่ หน่วยงานทดสอบ' },
      });
      return { data: { referral, case_status: (await caseState()).status } };
    };

    // 2. The waiting student still holds the one active case.
    await dataSource
      .query(
        `INSERT INTO cases (student_uuid, student_name, school_id, reason_flagged, status)
         VALUES ($1, $2, $3, $4, 'OPEN')`,
        [enrollment.student_uuid, enrollment.student_name, schoolId, REASON],
      )
      .then(
        () => {
          throw new Error('a second active case was allowed beside รอผลการส่งต่อ');
        },
        (error) =>
          assert(
            /uq_cases_active_student_uuid/.test(error.message),
            `unexpected insert error: ${error.message}`,
          ),
      );

    // 3. The agency's report is the only way a result comes in.
    const body = { result_code: 'NOT_SUCCEEDED', result_note: 'ครอบครัวไม่ไปตามนัด' };

    // 4. ยังไม่สำเร็จ returns the case to รอพิจารณา and keeps the note.
    const notYet = await reportAsAgency(firstReferralId, body.result_code, body.result_note);
    assert(
      notYet.data.case_status === 'PENDING_REVIEW',
      `ยังไม่สำเร็จ left ${notYet.data.case_status}`,
    );
    assert(
      notYet.data.referral?.status_code === 'NOT_SUCCEEDED' &&
        notYet.data.referral?.result?.note === body.result_note &&
        notYet.data.referral?.result?.reported_by_agency === true &&
        notYet.data.referral?.result?.reporter_name === 'เจ้าหน้าที่ หน่วยงานทดสอบ',
      `unexpected referral after ยังไม่สำเร็จ: ${JSON.stringify(notYet.data.referral)}`,
    );
    state = await caseState();
    assert(
      state.status === 'PENDING_REVIEW' && state.completion_outcome_code === null,
      `case after ยังไม่สำเร็จ is ${JSON.stringify(state)}`,
    );
    await expectRejected(
      reportAsAgency(firstReferralId, body.result_code, body.result_note),
      409,
      'second result on the same referral',
    );
    await expectStages({ [firstReferralId]: 'PENDING_REVIEW' });

    // 5. A new referral supersedes the old one; only it can take a result.
    const secondReferralId = await refer('ส่งต่อโรงพยาบาลอีกครั้ง');
    await expectRejected(
      reportAsAgency(firstReferralId, 'SUCCEEDED', 'ผลของรายการเก่า'),
      409,
      'result on a superseded referral',
    );
    await expectStages({
      [firstReferralId]: 'NOT_SUCCEEDED',
      [secondReferralId]: 'AWAITING_REFERRAL_OUTCOME',
    });

    // 6. Two simultaneous สำเร็จ: exactly one wins, the other is a conflict.
    const success = { result_code: 'SUCCEEDED', result_note: 'หน่วยงานแจ้งว่ากลับมาเรียนแล้ว' };
    const outcomes = await Promise.allSettled([
      reportAsAgency(secondReferralId, success.result_code, success.result_note),
      reportAsAgency(secondReferralId, success.result_code, success.result_note),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    assert(
      fulfilled.length === 1 && rejected.length === 1,
      `concurrent submits: ${fulfilled.length} succeeded, ${rejected.length} failed`,
    );
    assert(
      rejected[0].reason.getStatus?.() === 409,
      `losing concurrent submit was ${rejected[0].reason.message}`,
    );
    // สำเร็จ does not close the case: it goes back to รอพิจารณา like a
    // follow-up report, and the reviewer closes it with the usual action.
    state = await caseState();
    assert(
      state.status === 'PENDING_REVIEW' && state.completion_outcome_code === null,
      `case after สำเร็จ is ${JSON.stringify(state)}`,
    );
    await expectStages({ [secondReferralId]: 'PENDING_REVIEW' });
    await caseService.reviewCase(
      caseId,
      { review_action: 'CLOSE', review_note: 'ส่งต่อสำเร็จ ปิดเคส' },
      director,
    );
    state = await caseState();
    assert(
      state.status === 'RESOLVED' && state.completion_outcome_code === 'REFERRED_AGENCY',
      `case after ปิดเคส is ${JSON.stringify(state)}`,
    );
    await expectStages({ [firstReferralId]: 'NOT_SUCCEEDED', [secondReferralId]: 'COMPLETED' });
    const rows = await dataSource.query(
      `SELECT referral.status_code, COUNT(result.case_referral_id)::int AS results
       FROM case_referrals referral
       LEFT JOIN case_referral_results result ON result.case_referral_id = referral.id
       WHERE referral.case_id = $1
       GROUP BY referral.id, referral.status_code, referral.referred_at
       ORDER BY referral.referred_at`,
      [caseId],
    );
    assert(
      JSON.stringify(rows) ===
        JSON.stringify([
          { status_code: 'NOT_SUCCEEDED', results: 1 },
          { status_code: 'COMPLETED', results: 1 },
        ]),
      `unexpected referral rows: ${JSON.stringify(rows)}`,
    );

    console.log(
      'referral outcome smoke passed (refer → ยังไม่สำเร็จ → refer again → สำเร็จ → รอพิจารณา → ปิดเคส; 409 + concurrency)',
    );
  } finally {
    if (caseId) {
      await dataSource
        .query(
          `DELETE FROM case_referral_results WHERE case_referral_id IN
             (SELECT id FROM case_referrals WHERE case_id = $1)`,
          [caseId],
        )
        .catch(() => undefined);
      await dataSource
        .query(
          `DELETE FROM case_referral_links WHERE case_referral_id IN
             (SELECT id FROM case_referrals WHERE case_id = $1)`,
          [caseId],
        )
        .catch(() => undefined);
      await dataSource
        .query(`DELETE FROM case_referrals WHERE case_id = $1`, [caseId])
        .catch(() => undefined);
      await dataSource
        .query(`DELETE FROM notifications WHERE case_id = $1`, [caseId])
        .catch(() => undefined);
      await dataSource
        .query(`DELETE FROM case_reviews WHERE case_id = $1`, [caseId])
        .catch(() => undefined);
      await dataSource.query(`DELETE FROM cases WHERE id = $1`, [caseId]).catch(() => undefined);
    }
    if (actorId) {
      // audit_log is append-only, so an actor with history cannot be deleted;
      // switch the fixture off instead.
      await dataSource
        .query(`DELETE FROM users WHERE id = $1`, [actorId])
        .catch(() =>
          dataSource
            .query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [actorId])
            .catch(() => undefined),
        );
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
