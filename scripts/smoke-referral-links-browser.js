/**
 * Browser proof of the agency's referral link (tasks/task-agency-referral-report-link.md),
 * against a running backend (3001) and frontend (5175):
 *   - the case page shows the referral as two steps that keep counting
 *     (ส่งต่อหน่วยงาน → รายงานผลการส่งต่อ), scrolls to the waiting one, and
 *     offers the link tools; the issue dialog opens
 *   - the agency opens the link: a wrong code is refused with what is left,
 *     the right one starts AraID, approval opens the same page as the
 *     home-visit link, and the report goes through
 *   - back on the case page the report step names the reporter and carries
 *     the review buttons; the งานส่งต่อ register shares only an open link
 * Also checks the agency page fits a phone screen.
 */
const fs = require('fs');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { AraIdSessionCookieService } = require('../dist/araid/araid-session-cookie.service');
const { CaseService } = require('../dist/task/case.service');
const { ReferralLinkService } = require('../dist/task/referral-link.service');
const { assert, openChrome, wait, waitFor } = require('./smoke-case-assistance-browser');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run referral link browser smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://localhost:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5175';
const USERNAME = 'referral_link_browser_smoke';
const PERMISSIONS = ['home', 'dashboard', 'students', 'case:manage'];
const REASON = 'Automated referral link browser smoke';
const REPORTER = { given: 'สมใจ', family: 'หน่วยงานเบราว์เซอร์' };
const REPORT_NOTE = 'หน่วยงานพบครอบครัวแล้ว นักเรียนกลับมาเรียนตามปกติ';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  const araIdCookies = app.get(AraIdSessionCookieService);
  const caseService = app.get(CaseService);
  const referralLinkService = app.get(ReferralLinkService);
  let chrome = null;
  let caseId = null;
  let actorId = null;
  let recordId = null;
  let profileId = null;

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
               'STUDENT_NOT_FOUND', 'AWAITING_REFERRAL', 'AWAITING_REFERRAL_OUTCOME', 'REFERRAL_NOT_SUCCEEDED')
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
       VALUES ($1, 'x', 'ผอ.', 'ทดสอบลิงก์เบราว์เซอร์', 'ACTIVE', $2::jsonb, 'DIRECTOR', $3::jsonb,
         FALSE, 'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', permissions = $2::jsonb,
         data_scope = $3::jsonb, data_origin_code = 'AUTOMATED_TEST'
       RETURNING id`,
      [USERNAME, JSON.stringify(PERMISSIONS), JSON.stringify(scope)],
    );
    actorId = Number(actor.id);
    const director = {
      id: actorId,
      username: USERNAME,
      FirstName: 'ผอ.',
      LastName: 'ทดสอบลิงก์เบราว์เซอร์',
      roles: ['DIRECTOR'],
      permissions: PERMISSIONS,
      data_scope: scope,
    };

    // The agency officer's AraID: a real record and profile, so the backend's
    // own approval path resolves who they are.
    const citizenId = `96${String(Date.now()).slice(-11)}`;
    const [record] = await dataSource.query(
      `INSERT INTO araid_identity_records (
         identity_number, given_name_th, family_name_th, date_of_birth,
         record_status, created_by_user_id, updated_by_user_id
       ) VALUES ($1, $2, $3, '1985-01-01', 'ACTIVE', $4, $4)
       RETURNING id`,
      [citizenId, REPORTER.given, REPORTER.family, actorId],
    );
    recordId = record.id;
    const [profile] = await dataSource.query(
      `INSERT INTO araid_profiles (identity_record_id, created_by_user_id, pin_hash,
         registration_status, registration_method)
       VALUES ($1, $2, 'x', 'ACTIVE', 'MANAGED') RETURNING id`,
      [recordId, actorId],
    );
    profileId = profile.id;

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
    // ส่งต่อหน่วยงาน on the review only decides; the case waits in รอส่งต่อ.
    await caseService.reviewCase(
      caseId,
      { review_action: 'REFER_AGENCY', review_note: 'ส่งต่อพบนักจิตวิทยา' },
      director,
    );

    chrome = await openChrome();
    await chrome.call('Page.enable');
    await chrome.call('Network.enable');
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
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

    const visibleButton = (
      label,
      root = 'document',
    ) => `[...${root}.querySelectorAll('button')].find((button) =>
      button.offsetParent !== null && (button.innerText.trim() === ${JSON.stringify(label)} || button.getAttribute('aria-label') === ${JSON.stringify(label)}))`;
    const stepTitles = `[...document.querySelectorAll('[data-flow-step]')].map((step) =>
      step.getAttribute('data-flow-step') + ':' + step.getAttribute('data-flow-step-title'))`;
    const openCasePage = async () => {
      await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/` });
      await wait(500);
      await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/cases/${caseId}` });
      await waitFor(
        async () =>
          await chrome.evaluate(
            `Boolean(document.querySelector('[data-referral-step], [data-referral-form]'))`,
          ),
        async () => {
          const state = await chrome.evaluate(`(async () => ({ path: location.pathname,
            apiStatus: await fetch(${JSON.stringify(`${BACKEND_URL}/api/cases/`)} + ${caseId}, { credentials: 'include' }).then(r => r.status).catch(() => null) }))()`);
          return `case page did not render a referral step: ${JSON.stringify(state)}`;
        },
      );
      await wait(1200);
    };
    const activeStep = async () =>
      await chrome.evaluate(`(() => {
        const active = document.querySelector('[data-flow-step-active="true"]');
        if (!active) return null;
        const box = active.getBoundingClientRect();
        return {
          number: active.getAttribute('data-flow-step'),
          title: active.getAttribute('data-flow-step-title'),
          visible: box.bottom > 0 && box.top < window.innerHeight,
        };
      })()`);
    const setField = async (selector, value, prototype = 'HTMLTextAreaElement') =>
      await chrome.evaluate(`(() => {
        const field = document.querySelector(${JSON.stringify(selector)});
        const setter = Object.getOwnPropertyDescriptor(${prototype}.prototype, 'value').set;
        setter.call(field, ${JSON.stringify(value)});
        field.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    const pickDate = async (ariaLabel, isoDate) => {
      await chrome.evaluate(
        `document.querySelector('button[aria-label=${JSON.stringify(ariaLabel)}]').click()`,
      );
      await waitFor(
        async () =>
          await chrome.evaluate(
            `Boolean(document.querySelector('[role="dialog"][aria-label="เลือกวันที่"]'))`,
          ),
        `date picker ${ariaLabel} did not open`,
      );
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(
        new Date(),
      );
      if (today.slice(0, 7) !== isoDate.slice(0, 7)) {
        await chrome.evaluate(
          `document.querySelector('[role="dialog"] button[aria-label="ถัดไป"]').click()`,
        );
      }
      await waitFor(
        async () =>
          await chrome.evaluate(
            `Boolean(document.querySelector('[role="dialog"] button[aria-label=${JSON.stringify(isoDate)}]'))`,
          ),
        `date ${isoDate} is not offered`,
      );
      await chrome.evaluate(
        `document.querySelector('[role="dialog"] button[aria-label=${JSON.stringify(isoDate)}]').click()`,
      );
    };

    // 1. รอส่งต่อ: the form is the active step, like รอมอบหมาย's assignment form.
    await openCasePage();
    let titles = await chrome.evaluate(stepTitles);
    let active = await activeStep();
    assert(
      active?.title === 'ส่งต่อหน่วยงาน' &&
        active.visible &&
        (await chrome.evaluate(`Boolean(document.querySelector('[data-referral-form]'))`)),
      `รอส่งต่อ does not show the referral form as the active step: ${JSON.stringify(active)} ${titles}`,
    );
    assert(
      !titles.some((title) => title.endsWith(':รายงานผลการส่งต่อ')),
      `a report step shows before any result: ${titles}`,
    );
    const formStepNumber = Number(active.number);

    // Fill it like an assignment: the end date, the agency, the reason; ส่งต่อ.
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(
      new Date(Date.now() + 86_400_000),
    );
    await pickDate('วันที่สิ้นสุดส่งต่อ', tomorrow);
    await chrome.evaluate(
      `document.querySelector('input[aria-label="หน่วยงานที่ส่งต่อ"]').click()`,
    );
    await waitFor(
      async () =>
        await chrome.evaluate(
          `[...document.querySelectorAll('ul button')].some((button) => button.innerText.includes(${JSON.stringify(agency.agency_name)}))`,
        ),
      'the agency list did not open',
    );
    await chrome.evaluate(
      `[...document.querySelectorAll('ul button')].find((button) => button.innerText.includes(${JSON.stringify(agency.agency_name)})).click()`,
    );
    await setField('[data-referral-form] textarea', 'ส่งต่อพบนักจิตวิทยาเพื่อประเมินและดูแลต่อ');
    await chrome.evaluate(`${visibleButton('ส่งต่อ')}.click()`);
    await waitFor(
      async () => await chrome.evaluate(`Boolean(${visibleButton('ยืนยัน')})`),
      'ส่งต่อ did not ask to confirm',
    );
    await chrome.evaluate(`${visibleButton('ยืนยัน')}.click()`);
    // The code is revealed in the shared one-time-secret dialog.
    const codeDialog = `[...document.querySelectorAll('[role="dialog"]')].find((dialog) =>
      dialog.innerText.includes('รหัสสำหรับหน่วยงาน'))`;
    await waitFor(
      async () => await chrome.evaluate(`Boolean(${codeDialog})`),
      'sending did not reveal the access code',
    );
    const accessCode = await chrome.evaluate(
      `(${codeDialog}.innerText.match(/\\b\\d{6}\\b/) || [''])[0]`,
    );
    assert(/^\d{6}$/.test(accessCode), `revealed code is ${accessCode}`);
    await chrome.evaluate(`${visibleButton('เสร็จสิ้น')}.click()`);
    // The link stays shareable from the step; read the same URL the page shares.
    const issuedUrl =
      await chrome.evaluate(`fetch(${JSON.stringify(`${BACKEND_URL}/api/cases/${caseId}`)}, { credentials: 'include' })
      .then((response) => response.json())
      .then((payload) => payload.data.referrals[0].link.url)`);
    const linkToken = String(issuedUrl).split('/referral-report/')[1];
    assert(linkToken, `the case does not share the agency link: ${issuedUrl}`);
    console.log('ok รอส่งต่อ shows the form; ส่งต่อ issues the link and reveals its stable code');

    // 2. รอผลการส่งต่อ: the sent referral is the active step, with the round's tools.
    await openCasePage();
    titles = await chrome.evaluate(stepTitles);
    active = await activeStep();
    assert(
      active?.title === 'ส่งต่อหน่วยงาน' &&
        Number(active.number) === formStepNumber &&
        active.visible,
      `the sent referral is not the active step in view: ${JSON.stringify(active)} ${titles}`,
    );
    assert(
      (await chrome.evaluate('document.body.innerText')).includes('รอผลการส่งต่อ'),
      'the case does not read รอผลการส่งต่อ',
    );
    const tools = await chrome.evaluate(
      `[...document.querySelectorAll('[data-referral-link-panel] button')].map((button) => button.getAttribute('aria-label') || button.innerText.trim())`,
    );
    assert(
      JSON.stringify(tools) === JSON.stringify(['แชร์ลิงก์', 'ดูรหัส', 'ยกเลิกการส่งต่อ']),
      `the sent referral's tools are ${tools}`,
    );
    console.log(
      'ok รอผลการส่งต่อ makes the sent referral the active step with แชร์ / ยกเลิกการส่งต่อ',
    );

    await chrome.evaluate(
      `document.querySelector('[data-referral-link-panel] [aria-label="แชร์ลิงก์"]').click()`,
    );
    await waitFor(
      async () => await chrome.evaluate(`Boolean(document.querySelector('[role="dialog"]'))`),
      'share dialog missing',
    );
    const shareCopy = await chrome.evaluate(`document.querySelector('[role="dialog"]').innerText`);
    assert(
      shareCopy.includes('AraID') && shareCopy.includes('แจ้งรหัสแยก'),
      'referral share instructions missing',
    );
    assert(
      !shareCopy.includes('ส่งถึงครู') && !shareCopy.includes('Auto LINE'),
      'agency share offers automatic LINE',
    );
    for (const channel of ['LINE', 'Messenger', 'Gmail', 'Discord'])
      assert(shareCopy.includes(channel), `share channel ${channel} missing`);
    await chrome.call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await chrome.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await wait(300);
    for (let read = 0; read < 2; read++) {
      await chrome.evaluate(`${visibleButton('ดูรหัส')}.click()`);
      await waitFor(
        async () => await chrome.evaluate(`Boolean(${codeDialog})`),
        'view code dialog missing',
      );
      const sameCode = await chrome.evaluate(
        `(${codeDialog}.innerText.match(/\\b\\d{6}\\b/) || [''])[0]`,
      );
      assert(sameCode === accessCode, 'viewing code changed it');
      await chrome.evaluate(`${visibleButton('เสร็จสิ้น')}.click()`);
      await wait(250);
    }
    console.log(
      'ok shared dialog has normal channels, no automatic LINE; repeated code view is stable',
    );

    await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/student-risk-report/referrals` });
    const registerCodeButton = `[...document.querySelectorAll('a[aria-label]')]
      .find(a => a.offsetParent !== null && a.getAttribute('href') === '/cases/${caseId}')
      ?.parentElement.querySelector('button[aria-label="ดูรหัส"]')`;
    await waitFor(
      async () => await chrome.evaluate(`Boolean(${registerCodeButton})`),
      'register code button missing',
    );
    await chrome.evaluate(`${registerCodeButton}.click()`);
    await waitFor(
      async () => await chrome.evaluate(`Boolean(${codeDialog})`),
      'register code dialog missing',
    );
    assert(
      await chrome.evaluate(`${codeDialog}.innerText.includes(${JSON.stringify(accessCode)})`),
      'register showed a different code',
    );
    await chrome.evaluate(`${visibleButton('เสร็จสิ้น')}.click()`);
    console.log('ok the register uses the credential action and reveals the same code');

    // 2. The agency: wrong code, right code, AraID, the home-visit view.
    await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/referral-report/${linkToken}` });
    await waitFor(
      async () => await chrome.evaluate(`Boolean(document.getElementById('referral-access-code'))`),
      'the agency page did not ask for the code',
    );
    const gateText = await chrome.evaluate('document.body.innerText');
    assert(!gateText.includes(enrollment.student_name), 'the gate shows the full student name');
    // axios sends through XHR; keep the challenge header the page sets.
    await chrome.evaluate(`(() => {
      const setHeader = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (String(name).toLowerCase() === 'x-referral-araid-challenge') window.__referralChallenge = value;
        return setHeader.call(this, name, value);
      };
    })()`);
    const typeCode = async (code) => {
      await chrome.evaluate(`(() => {
        const field = document.getElementById('referral-access-code');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(field, ${JSON.stringify(code)});
        field.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await chrome.evaluate(`${visibleButton('ยืนยันตัวตนด้วย AraID')}.click()`);
    };
    await typeCode(String((Number(accessCode) + 1) % 1_000_000).padStart(6, '0'));
    await waitFor(
      async () => (await chrome.evaluate('document.body.innerText')).includes('เหลืออีก 4 ครั้ง'),
      'a wrong code did not say how many tries are left',
    );
    await typeCode(accessCode);
    await waitFor(
      async () => Boolean(await chrome.evaluate('window.__referralChallenge')),
      'the right code did not start the AraID challenge',
    );
    const challengeToken = await chrome.evaluate('window.__referralChallenge');
    const begun = await fetch(`${BACKEND_URL}/api/referral-links/araid/challenge/begin`, {
      method: 'POST',
      headers: { 'x-referral-araid-challenge': challengeToken },
    });
    assert(begun.status === 201, `begin failed: ${begun.status}`);
    const authorizationCookie = (begun.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(';')[0])
      .join('; ');
    const identityCookie = await new Promise((resolve) => {
      araIdCookies.setSession(
        { cookie: (name, value) => resolve(`${name}=${value}`) },
        String(profileId),
      );
    });
    const approved = await fetch(`${BACKEND_URL}/api/referral-links/araid/challenge/approve`, {
      method: 'POST',
      headers: { cookie: `${identityCookie}; ${authorizationCookie}` },
    });
    assert(approved.status === 201, `approve failed: ${approved.status} ${await approved.text()}`);
    await waitFor(
      async () =>
        await chrome.evaluate(`Boolean(document.querySelector('[data-referral-report-form]'))`),
      'approval did not open the report page',
      30_000,
    );
    const pageText = await chrome.evaluate('document.body.innerText');
    assert(pageText.includes(enrollment.student_name), 'the report page hides the student name');
    assert(pageText.includes(`${REPORTER.given} ${REPORTER.family}`), 'the reporter is not named');
    titles = await chrome.evaluate(stepTitles);
    assert(
      JSON.stringify(titles) === JSON.stringify(['1:ส่งต่อหน่วยงาน', '2:รายงานผลการส่งต่อ']),
      `agency page steps are ${titles}`,
    );
    console.log('ok code + AraID open the agency page with the student card and steps 1–2');

    const defaults = await chrome.evaluate(`(() => {
      const form = document.querySelector('[data-referral-report-form]');
      const date = form.querySelector('#referral-report-date').innerText.trim();
      const time = form.querySelector('#referral-report-time').innerText.trim();
      const now = new Date();
      const expectedDate = new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric',
      }).format(now);
      const currentTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(now);
      const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
      const toMinutes = (value) => value.split(':').reduce((h, m) => Number(h) * 60 + Number(m));
      return {
        succeeded: form.querySelector('input[value="SUCCEEDED"]').checked,
        dateIsToday: date === expectedDate,
        timeIsCurrent: /^\\d{2}:\\d{2}$/.test(time) &&
          Math.abs(toMinutes(time) - toMinutes(currentTime)) <= 1,
        actionAt: new Date(dateKey + 'T' + time + ':00+07:00').toISOString(),
      };
    })()`);
    assert(defaults.succeeded && defaults.dateIsToday && defaults.timeIsCurrent,
      `report defaults are incorrect: ${JSON.stringify(defaults)}`);
    await chrome.evaluate(`document.querySelector('[data-referral-report-form]').scrollIntoView({ block: 'center' })`);
    await wait(300);
    fs.writeFileSync('/tmp/sts-referral-form-desktop.png', Buffer.from(
      (await chrome.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64',
    ));

    // 3. Phone width, then file the report.
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await wait(500);
    const overflow = await chrome.evaluate(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    );
    assert(overflow <= 0, `agency page scrolls sideways on a phone by ${overflow}px`);
    await chrome.evaluate(`document.getElementById('referral-report-time').scrollIntoView({ block: 'center' })`);
    await wait(300);
    await chrome.evaluate(`document.getElementById('referral-report-time').click()`);
    await waitFor(async () => await chrome.evaluate(
      `Boolean(document.querySelector('[role="dialog"][aria-label="เลือกเวลา"] select[aria-label="ชั่วโมง"]'))`,
    ), 'the action time picker did not open on a phone');
    const pickerFits = await chrome.evaluate(`(() => {
      const box = document.querySelector('[role="dialog"][aria-label="เลือกเวลา"]').getBoundingClientRect();
      return box.left >= 0 && box.right <= document.documentElement.clientWidth;
    })()`);
    assert(pickerFits, 'the action time picker extends outside the phone viewport');
    fs.writeFileSync('/tmp/sts-referral-form-mobile.png', Buffer.from(
      (await chrome.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64',
    ));
    await chrome.evaluate(`${visibleButton('เสร็จสิ้น', 'document.querySelector(\'[role="dialog"][aria-label="เลือกเวลา"]\')')}.click()`);
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    console.log('ok defaults are สำเร็จ/today/current time; the time picker fits a phone');
    await chrome.evaluate(`(() => {
      const field = document.getElementById('referral-report-note');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(field, ${JSON.stringify(REPORT_NOTE)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(
      async () =>
        await chrome.evaluate(`(() => {
          const button = ${visibleButton('ส่งรายงาน')};
          return Boolean(button) && !button.disabled;
        })()`),
      'ส่งรายงาน did not enable',
    );
    await chrome.evaluate(`${visibleButton('ส่งรายงาน')}.click()`);
    await waitFor(
      async () => (await chrome.evaluate('document.body.innerText')).includes('ส่งรายงานเรียบร้อย'),
      async () => `the report did not reach the thank-you page: ${await chrome.evaluate(
        `JSON.stringify([...document.querySelectorAll('[role="alert"]')].map((alert) => alert.innerText))`,
      )}`,
    );
    const [caseRow] = await dataSource.query(`SELECT status FROM cases WHERE id = $1`, [caseId]);
    assert(
      caseRow.status === 'PENDING_REVIEW',
      `case after the agency report is ${caseRow.status}`,
    );
    const [filedReport] = await dataSource.query(
      `SELECT referral.status_code, result.action_at
       FROM case_referral_results result
       JOIN case_referrals referral ON referral.id = result.case_referral_id
       WHERE referral.case_id = $1`, [caseId],
    );
    assert(filedReport?.status_code === 'COMPLETED' &&
      new Date(filedReport.action_at).toISOString() === defaults.actionAt,
      'the default successful result and action time were not saved');
    console.log(
      'ok no horizontal overflow at 390px; the agency report returns the case to รอพิจารณา',
    );

    // 4. Back on the case page: the reporter, and the review buttons there.
    await openCasePage();
    const reportStep = await chrome.evaluate(`(() => {
      const step = [...document.querySelectorAll('[data-flow-step]')]
        .filter((candidate) => candidate.querySelector('[data-referral-result]'))
        .at(-1);
      if (!step) return null;
      return {
        text: [step.innerText, ...[...step.querySelectorAll('input, textarea')].map((f) => f.value)].join('\\n'),
        buttons: [...step.querySelectorAll('button')].map((button) => button.innerText.trim()),
        active: step.getAttribute('data-flow-step-active') === 'true',
      };
    })()`);
    assert(reportStep, 'no filed report step on the case page');
    assert(
      reportStep.text.includes(`${REPORTER.given} ${REPORTER.family}`) &&
        reportStep.text.includes('AraID') &&
        reportStep.text.includes('สถานะการส่งต่อ : รอพิจารณา') &&
        reportStep.text.includes(REPORT_NOTE),
      `report step reads: ${reportStep.text}`,
    );
    assert(
      reportStep.active && reportStep.buttons.includes('ปิดเคส'),
      `review buttons are not on the report step: ${JSON.stringify(reportStep)}`,
    );
    fs.writeFileSync(
      '/tmp/sts-referral-status-mobile.png',
      Buffer.from(
        (await chrome.call('Page.captureScreenshot', { format: 'png' })).result.data,
        'base64',
      ),
    );
    console.log('ok the case page names the agency reporter and reviews from that step');

    // 5. The register shares only an open link: this one is spent.
    await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/student-risk-report/referrals` });
    await waitFor(
      async () =>
        await chrome.evaluate(`Boolean(document.querySelector('[data-referral-register]'))`),
      'the referral register did not render',
    );
    await chrome.evaluate(`(() => {
      const field = document.querySelector('[data-referral-register] input[placeholder="ค้นหาชื่อนักเรียน"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(field, ${JSON.stringify(enrollment.student_name)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const caseLinkLabel = `ดูรายละเอียดเคสของ ${enrollment.student_name}`;
    const shareState = `(() => {
      const link = [...document.querySelectorAll('a[aria-label]')].find((anchor) =>
        anchor.offsetParent !== null && anchor.getAttribute('aria-label') === ${JSON.stringify(caseLinkLabel)});
      const share = link && [...link.parentElement.querySelectorAll('button')]
        .find((button) => button.getAttribute('aria-label') === 'แชร์ลิงก์');
      return share ? share.disabled : null;
    })()`;
    await waitFor(
      async () => (await chrome.evaluate(shareState)) !== null,
      'the register row did not render',
    );
    const shareDisabled = await chrome.evaluate(shareState);
    assert(shareDisabled === true, `share on a spent link is ${shareDisabled}`);
    console.log('ok the register disables แชร์ once the link is spent');

    // 6. Another referral round: cancel through the real reason dialog.
    await caseService.reviewCase(
      caseId,
      { review_action: 'REFER_AGENCY', review_note: 'ทดสอบยกเลิกการส่งต่อรอบใหม่' },
      director,
    );
    const cancelRound = await referralLinkService.sendReferral(
      caseId,
      {
        referral_agency_id: Number(agency.id),
        referral_note: 'ส่งต่อรอบใหม่สำหรับทดสอบการยกเลิก',
        starts_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
      director,
    );
    await openCasePage();
    await chrome.evaluate(`${visibleButton('ยกเลิกการส่งต่อ')}.click()`);
    const cancelDialog = `[...document.querySelectorAll('[role="dialog"]')]
      .find((dialog) => dialog.innerText.includes('ยกเลิกการส่งต่อ'))`;
    await waitFor(
      async () => await chrome.evaluate(`Boolean(${cancelDialog})`),
      'cancel reason dialog did not open',
    );
    await chrome.evaluate(`${visibleButton('ยืนยัน', cancelDialog)}.click()`);
    assert(
      await chrome.evaluate(`${cancelDialog}.innerText.includes('กรุณาระบุเหตุผลการยกเลิก')`),
      'empty cancellation reason was accepted',
    );
    assert(
      (await dataSource.query('SELECT status FROM cases WHERE id = $1', [caseId]))[0].status ===
        'AWAITING_REFERRAL_OUTCOME',
      'empty reason changed the case',
    );
    await setField('[role="dialog"] textarea', '   ');
    await chrome.evaluate(`${visibleButton('ยืนยัน', cancelDialog)}.click()`);
    assert(
      await chrome.evaluate(`${cancelDialog}.innerText.includes('กรุณาระบุเหตุผลการยกเลิก')`),
      'whitespace cancellation reason was accepted',
    );
    await chrome.evaluate(`${visibleButton('ยกเลิก', cancelDialog)}.click()`);
    await chrome.evaluate(`${visibleButton('ยกเลิกการส่งต่อ')}.click()`);
    assert(
      await chrome.evaluate(`${cancelDialog}.querySelector('textarea').value === ''`),
      'reopening cancel dialog retained the previous reason',
    );
    await wait(350);
    fs.writeFileSync(
      '/tmp/sts-referral-cancel-dialog.png',
      Buffer.from(
        (await chrome.call('Page.captureScreenshot', { format: 'png' })).result.data,
        'base64',
      ),
    );
    const cancelReason = 'หน่วยงานแจ้งให้เปลี่ยนวันนัดหมาย';
    await setField('[role="dialog"] textarea', cancelReason);
    await chrome.evaluate(`${visibleButton('ยืนยัน', cancelDialog)}.click()`);
    await waitFor(
      async () =>
        await chrome.evaluate(`!document.querySelector('[role="dialog"]')
      && Boolean(document.querySelector('[data-referral-form]'))`),
      'confirmed cancellation did not restore the referral form',
    );
    const [cancelled] = await dataSource.query(
      `SELECT c.status AS case_status,
      r.status_code AS referral_status, l.status_code AS link_status, l.cancel_reason,
      l.cancelled_by_user_id, l.cancelled_at
      FROM cases c JOIN case_referrals r ON r.case_id = c.id
      JOIN case_referral_links l ON l.case_referral_id = r.id
      WHERE c.id = $1 AND r.id = $2`,
      [caseId, cancelRound.data.referral_id],
    );
    assert(
      cancelled.case_status === 'AWAITING_REFERRAL' &&
        cancelled.referral_status === 'CANCELLED' &&
        cancelled.link_status === 'REVOKED' &&
        cancelled.cancel_reason === cancelReason &&
        cancelled.cancelled_at &&
        Number(cancelled.cancelled_by_user_id) === actorId,
      'dialog cancellation did not persist status/reason/actor/time',
    );
    const cancelledText = await chrome.evaluate('document.body.innerText');
    assert(
      cancelledText.includes(cancelReason) && cancelledText.includes('รอส่งต่อ'),
      'cancelled round did not show its reason and waiting status',
    );
    const cancelledToken = cancelRound.data.url.split('/referral-report/')[1];
    const revokedStatus = await chrome.evaluate(`fetch(${JSON.stringify(
      `${BACKEND_URL}/api/referral-links/`,
    )} + ${JSON.stringify(cancelledToken)})
      .then((response) => response.status)`);
    assert(revokedStatus === 410, 'cancelled round link still opens');
    console.log(
      'ok cancel dialog rejects blank/whitespace, resets on reopen, persists reason/actor/time, restores form and revokes link',
    );

    console.log('Referral link browser smoke passed');
  } finally {
    chrome?.close();
    if (caseId) {
      const referrals = `(SELECT id FROM case_referrals WHERE case_id = $1)`;
      for (const sql of [
        `DELETE FROM case_referral_results WHERE case_referral_id IN ${referrals}`,
        `DELETE FROM case_referral_links WHERE case_referral_id IN ${referrals}`,
        `DELETE FROM case_referrals WHERE case_id = $1`,
        `DELETE FROM notifications WHERE case_id = $1`,
        `DELETE FROM case_reviews WHERE case_id = $1`,
        `DELETE FROM cases WHERE id = $1`,
      ]) {
        await dataSource.query(sql, [caseId]).catch(() => undefined);
      }
    }
    if (profileId) {
      await dataSource
        .query(`DELETE FROM araid_profiles WHERE id = $1`, [profileId])
        .catch(() => undefined);
    }
    if (recordId) {
      await dataSource
        .query(`DELETE FROM araid_identity_records WHERE id = $1`, [recordId])
        .catch(() => undefined);
    }
    if (actorId) {
      await dataSource
        .query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [actorId])
        .catch(() => undefined);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
