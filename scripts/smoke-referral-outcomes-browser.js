/**
 * Browser proof of referral outcomes on the case page: a sent referral waits in
 * รอผลการส่งต่อ with no result step and nothing for the school to fill in (the
 * result is the agency's report), the งานส่งต่อ register files it under
 * รอผลการส่งต่อ with ดูรายละเอียดเคส + แชร์, an agency report of ยังไม่สำเร็จ
 * brings the case back to รอพิจารณา with the report step and its review
 * buttons, and after a second referral สำเร็จ goes back to รอพิจารณา, where
 * ปิดเคส closes it. Also checks the page fits a phone.
 */
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { CaseService } = require('../dist/task/case.service');
const { ReferralLinkService } = require('../dist/task/referral-link.service');
const { assert, openChrome, wait, waitFor } = require('./smoke-case-assistance-browser');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run referral outcome browser smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://localhost:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5175';
const USERNAME = 'referral_outcome_browser_smoke';
const PERMISSIONS = ['home', 'dashboard', 'students', 'case:assign', 'case:review'];
const REASON = 'Automated referral outcome browser smoke';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  const caseService = app.get(CaseService);
  const referralLinks = app.get(ReferralLinkService);
  let chrome = null;
  let caseId = null;

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
    const scope = { school_ids: [Number(enrollment.school_id)] };
    const [agency] = await dataSource.query(
      `SELECT id, agency_name FROM referral_agencies WHERE is_active ORDER BY id LIMIT 1`,
    );
    assert(agency, 'need one active referral agency');

    const [actor] = await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions,
         role, data_scope, must_change_password, data_origin_code)
       VALUES ($1, 'x', 'ผอ.', 'ทดสอบเบราว์เซอร์', 'ACTIVE', $2::jsonb, 'DIRECTOR', $3::jsonb,
         FALSE, 'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', permissions = $2::jsonb,
         data_scope = $3::jsonb, data_origin_code = 'AUTOMATED_TEST'
       RETURNING id`,
      [USERNAME, JSON.stringify(PERMISSIONS), JSON.stringify(scope)],
    );
    const actorId = Number(actor.id);
    const director = {
      id: actorId,
      username: USERNAME,
      FirstName: 'ผอ.',
      LastName: 'ทดสอบเบราว์เซอร์',
      roles: ['DIRECTOR'],
      permissions: PERMISSIONS,
      data_scope: scope,
    };

    const [createdCase] = await dataSource.query(
      `INSERT INTO cases (student_uuid, student_name, school_id, student_school, reason_flagged,
         status, workflow_phase_code)
       VALUES ($1, $2, $3, $4, $5, 'PENDING_REVIEW', 'FOLLOW_UP')
       RETURNING id`,
      [
        enrollment.student_uuid,
        enrollment.student_name,
        enrollment.school_id,
        enrollment.school_name,
        REASON,
      ],
    );
    caseId = Number(createdCase.id);
    // ส่งต่อหน่วยงาน decides (รอส่งต่อ); sending from the case page issues the
    // agency's link and moves the case to รอผลการส่งต่อ.
    const refer = async (note) => {
      await caseService.reviewCase(
        caseId,
        { review_action: 'REFER_AGENCY', review_note: note },
        director,
      );
      await referralLinks.sendReferral(
        caseId,
        {
          referral_agency_id: Number(agency.id),
          referral_note: note,
          starts_at: new Date(Date.now() - 60_000).toISOString(),
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
        director,
      );
    };
    const caseStatus = async () =>
      (await dataSource.query(`SELECT status FROM cases WHERE id = $1`, [caseId]))[0].status;

    await refer('ส่งต่อพบนักจิตวิทยา');

    chrome = await openChrome();
    await chrome.call('Page.enable');
    await chrome.call('Network.enable');
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1400,
      deviceScaleFactor: 1,
      mobile: false,
    });
    let cookie = null;
    sessionCookieService.setSession(
      { cookie: (name, value) => (cookie = { name, value }) },
      actorId,
    );
    await chrome.call('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/login` });
    await waitFor(
      async () => (await chrome.evaluate('document.readyState')) === 'complete',
      'login page did not load',
    );
    await chrome.evaluate(
      `localStorage.clear(); localStorage.setItem('sts_user', ${JSON.stringify(
        JSON.stringify({
          id: actorId,
          username: USERNAME,
          roles: ['DIRECTOR'],
          permissions: PERMISSIONS,
          data_scope: scope,
        }),
      )}); localStorage.setItem('admin_access', 'true'); true`,
    );

    const visibleButton = (label) => `[...document.querySelectorAll('button')].find((button) =>
      button.offsetParent !== null && button.innerText.trim() === ${JSON.stringify(label)})`;
    // A referral is a ส่งต่อหน่วยงาน step, and once its result is in, a
    // รายงานผลการส่งต่อ step after it, oldest first. Fields are disabled
    // inputs, so read their values too.
    const REPORT_STEP = '[data-referral-result]';
    const referralStepText = (position) => `(() => {
      const steps = [...document.querySelectorAll(${JSON.stringify(REPORT_STEP)})];
      const step = steps.at(${position});
      if (!step) return '';
      const values = [...step.querySelectorAll('input, textarea')].map((field) => field.value);
      return [step.innerText, ...values].join('\\n');
    })()`;
    const referralStepCount = `document.querySelectorAll('[data-referral-step]').length`;
    // Review buttons sit in the newest report step; บันทึกผล in the sent referral's step.
    const buttonInNewestReferral = (label, marker = REPORT_STEP) => `(() => {
      const step = [...document.querySelectorAll('[data-flow-step]')]
        .filter((candidate) => candidate.querySelector(${JSON.stringify(marker)}))
        .at(-1);
      return Boolean(step && [...step.querySelectorAll('button')].some((button) =>
        button.offsetParent !== null && button.innerText.trim() === ${JSON.stringify(label)}));
    })()`;

    async function openCasePage() {
      // A neutral route first, so the probe below cannot read the old page.
      await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/` });
      await wait(500);
      await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/cases/${caseId}` });
      await waitFor(
        async () => (await chrome.evaluate(referralStepCount)) > 0,
        'case page did not render a ส่งต่อหน่วยงาน step',
      );
      await wait(500);
    }

    // Results only come from the agency's report through its link; that flow
    // is smoke:referral-links-browser. Here the report goes into the same core.
    async function reportAsAgency(resultCode, note) {
      const [latest] = await dataSource.query(
        `SELECT referral.id AS referral_id, link.id AS link_id
         FROM case_referrals referral
         JOIN case_referral_links link ON link.case_referral_id = referral.id
         WHERE referral.case_id = $1
         ORDER BY referral.referred_at DESC, link.created_at DESC
         LIMIT 1`,
        [caseId],
      );
      await caseService.applyReferralResult({
        caseId,
        referralId: latest.referral_id,
        resultCode,
        note,
        scopeActor: null,
        recordedByUserId: null,
        agencyReport: {
          linkId: latest.link_id,
          actionDate: new Date().toISOString().slice(0, 10),
          identityProviderCode: 'ARAID',
          providerSubject: 'smoke-outcomes-browser-subject',
          reporterName: 'เจ้าหน้าที่ หน่วยงานทดสอบ',
        },
        audit: { actorUserId: null, actorLabel: 'เจ้าหน้าที่ หน่วยงานทดสอบ' },
      });
      await openCasePage();
    }

    // 1. Waiting: no result step yet, and nothing for the school to fill in.
    await openCasePage();
    assert(
      (await chrome.evaluate(
        `document.querySelectorAll(${JSON.stringify(REPORT_STEP)}).length`,
      )) === 0,
      'a report step shows before any result',
    );
    assert(
      !(await chrome.evaluate(`Boolean(${visibleButton('บันทึกผลการส่งต่อ')})`)),
      'the school is still offered บันทึกผลการส่งต่อ',
    );
    assert(
      await chrome.evaluate(`document.body.innerText.includes('รอผลการส่งต่อ')`),
      'case status รอผลการส่งต่อ is not shown',
    );
    console.log('ok a sent referral waits in รอผลการส่งต่อ with no result step and no บันทึกผล');

    // 1b. The งานส่งต่อ register: cards follow the flow; a row's tools are
    //     ดูรายละเอียดเคส + แชร์, like the กลุ่มเสี่ยง rows.
    await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/student-risk-report/referrals` });
    await waitFor(
      async () =>
        await chrome.evaluate(`Boolean(document.querySelector('[data-referral-register]'))`),
      'the referral register did not render',
    );
    const registerText = await chrome.evaluate(
      `document.querySelector('[data-referral-register]').innerText`,
    );
    for (const label of ['รอผลการส่งต่อ', 'รอพิจารณา', 'ส่งต่อสำเร็จ', 'ยังไม่สำเร็จ']) {
      assert(registerText.includes(label), `register card ${label} is missing`);
    }
    for (const retired of ['หน่วยงานรับแล้ว', 'หน่วยงานปฏิเสธ']) {
      assert(!registerText.includes(retired), `register still shows ${retired}`);
    }
    await chrome.evaluate(`(() => {
      const field = document.querySelector('input[placeholder="ค้นหาชื่อนักเรียนหรือหน่วยงาน"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(field, ${JSON.stringify(enrollment.student_name)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const caseLinkLabel = `ดูรายละเอียดเคสของ ${enrollment.student_name}`;
    const rowTools = `(() => {
      const link = [...document.querySelectorAll('a[aria-label]')].find((anchor) =>
        anchor.offsetParent !== null && anchor.getAttribute('aria-label') === ${JSON.stringify(caseLinkLabel)});
      if (!link) return null;
      return [...link.parentElement.querySelectorAll('button')].map((button) => ({
        label: button.getAttribute('aria-label') || button.innerText.trim(),
        disabled: button.disabled,
      }));
    })()`;
    await waitFor(
      async () => Boolean(await chrome.evaluate(rowTools)),
      'the waiting row did not render',
    );
    const tools = await chrome.evaluate(rowTools);
    assert(
      tools.length === 1 && tools[0].label === 'แชร์ลิงก์' && tools[0].disabled === false,
      `the waiting row's tools are ${JSON.stringify(tools)}`,
    );
    console.log('ok งานส่งต่อ shows the flow cards; the row tools are ดูรายละเอียดเคส + แชร์');
    await openCasePage();

    // 2. Phone width: the card and its button stay inside the screen.
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await wait(500);
    const overflow = await chrome.evaluate(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
    );
    assert(overflow <= 0, `case page scrolls sideways on a phone by ${overflow}px`);
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1400,
      deviceScaleFactor: 1,
      mobile: false,
    });
    console.log('ok no horizontal overflow at 390px');

    // 3. ยังไม่สำเร็จ → รอพิจารณา, the note shows on the card, no button left.
    const notYetNote = 'หน่วยงานแจ้งว่าครอบครัวไม่ไปตามนัด';
    await reportAsAgency('NOT_SUCCEEDED', notYetNote);
    await waitFor(
      async () => (await caseStatus()) === 'PENDING_REVIEW',
      'case did not return to รอพิจารณา',
    );
    await waitFor(
      async () => (await chrome.evaluate(referralStepText(-1))).includes(notYetNote),
      'the recorded note is not on the referral step',
    );
    const afterNotYet = await chrome.evaluate(referralStepText(-1));
    assert(afterNotYet.includes('ยังไม่สำเร็จ'), `step badge after ยังไม่สำเร็จ: ${afterNotYet}`);
    // The reviewer decides the next step right under the referral that failed.
    await waitFor(
      async () => await chrome.evaluate(buttonInNewestReferral('ส่งต่อหน่วยงานอีกครั้ง')),
      'ส่งต่อหน่วยงานอีกครั้ง is not offered on the failed referral step',
    );
    assert(
      !(await chrome.evaluate(`Boolean(${visibleButton('บันทึกผลการส่งต่อ')})`)),
      'the button is still offered after the result was recorded',
    );
    console.log(
      'ok ยังไม่สำเร็จ returned the case to รอพิจารณา, shows the note and offers ส่งต่อหน่วยงานอีกครั้ง there',
    );

    // 4. Refer again; สำเร็จ goes back to รอพิจารณา too, and ปิดเคส closes it.
    await refer('ส่งต่อโรงพยาบาลอีกครั้ง');
    await openCasePage();
    assert(
      (await chrome.evaluate(referralStepCount)) === 2,
      'the second referral did not get its own step',
    );
    assert(
      (await chrome.evaluate(referralStepText(0))).includes(notYetNote),
      'the first referral step lost its recorded result',
    );
    await reportAsAgency('SUCCEEDED', 'นักเรียนกลับมาเรียนตามปกติแล้ว');
    await waitFor(
      async () => (await caseStatus()) === 'PENDING_REVIEW',
      'สำเร็จ did not return the case to รอพิจารณา',
    );
    await waitFor(
      async () => await chrome.evaluate(buttonInNewestReferral('ปิดเคส')),
      'ปิดเคส is not offered on the succeeded referral step',
    );
    await caseService.reviewCase(
      caseId,
      { review_action: 'CLOSE', review_note: 'ส่งต่อสำเร็จ ปิดเคส' },
      director,
    );
    await waitFor(async () => (await caseStatus()) === 'RESOLVED', 'ปิดเคส did not close the case');
    const [final] = await dataSource.query(
      `SELECT status, completion_outcome_code FROM cases WHERE id = $1`,
      [caseId],
    );
    assert(
      final.completion_outcome_code === 'REFERRED_AGENCY',
      `closed case outcome is ${final.completion_outcome_code}`,
    );
    console.log('ok สำเร็จ returned the case to รอพิจารณา and ปิดเคส closed it as ส่งต่อหน่วยงาน');
    console.log('Referral outcome browser smoke passed');
  } finally {
    chrome?.close();
    if (caseId) {
      await dataSource
        .query(
          `DELETE FROM case_referral_results WHERE case_referral_id IN
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
    await dataSource
      .query(`UPDATE users SET status = 'DISABLED' WHERE username = $1`, [USERNAME])
      .catch(() => undefined);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
