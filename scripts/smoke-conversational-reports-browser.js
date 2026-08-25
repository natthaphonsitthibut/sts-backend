const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { randomUUID } = require('crypto');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { TaskLifecycleService } = require('../dist/task/task-lifecycle.service');
const { TaskRepository } = require('../dist/task/task.repository');
const { assert, openChrome, wait, waitFor } = require('./smoke-case-assistance-browser');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run conversational browser smoke with NODE_ENV=production');
}
process.env.NODE_ENV = 'development';
process.env.GOOGLE_LOGIN_MODE = 'development';
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3002';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const USERNAME = 'conversational_reports_browser_smoke';
const EXECUTIVE_USERNAME = 'conversational_reports_executive_smoke';
const REASON = 'Automated conversational reports browser smoke';

function setSessionCookie(sessionCookieService, userId) {
  let cookie = null;
  sessionCookieService.setSession(
    { cookie: (name, value) => (cookie = { name, value }) },
    userId,
  );
  assert(cookie, 'session cookie was not created');
  return cookie;
}

async function setBrowserSession(client, cookie, user) {
  await client.call('Network.setCookie', {
    name: cookie.name,
    value: cookie.value,
    url: BACKEND_URL,
    httpOnly: true,
    sameSite: 'Lax',
  });
  await client.evaluate(
    `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(user))});
     localStorage.setItem('admin_access', 'true'); true`,
  );
}

async function setInput(client, selector, value) {
  const changed = await client.evaluate(
    `(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      if (!field) return false;
      const prototype = field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  );
  assert(changed, `field ${selector} was not found`);
}

async function visibleStepId(client) {
  return await client.evaluate(
    `document.querySelector('[data-conversational-step]')?.getAttribute('data-conversational-step')`,
  );
}

async function clickNext(client) {
  const labels = await client.evaluate(
    `[...document.querySelectorAll('button')].filter((button) => button.offsetParent !== null)
      .map((button) => button.textContent.trim()).join('|')`,
  );
  const label = labels.split('|').find((value) => value === 'ถัดไป' || value === 'ตรวจทาน');
  assert(label, `Next button was missing: ${labels}`);
  await client.clickText(label);
}

async function createLink(
  dataSource,
  lifecycle,
  repository,
  actor,
  enrollment,
  caseId,
  taskType,
) {
  const assignees = await repository.listVisitAssignees(enrollment.student_uuid);
  const assignee = assignees.find((candidate) => candidate.email);
  assert(assignee, 'no active teacher with email is available for conversational smoke');
  await lifecycle.createTask(
    actor,
    {
      task_type: taskType,
      assigned_teacher_id: Number(assignee.teacher_id),
      assistance_measure_codes: taskType === 'ASSIST' ? ['SCHOLARSHIP'] : undefined,
      existing_case_id: String(caseId),
      student_id: enrollment.student_uuid,
      expires_value: 1,
      expires_unit: 'days',
      target_school_id: enrollment.school_id,
      assignment_note: taskType === 'ASSIST' ? 'ช่วยเหลือตามมาตรการ' : 'ติดตามรอบใหม่',
    },
    BACKEND_URL,
  );
  const [link] = await dataSource.query(
    `SELECT tl.id AS link_id, t.id AS task_id
     FROM task_links tl JOIN tasks t ON t.id = tl.task_id
     WHERE t.case_id = $1 AND t.task_type = $2 AND tl.deleted_at IS NULL
     ORDER BY tl.created_at DESC LIMIT 1`,
    [caseId, taskType],
  );
  assert(link, `${taskType} link was not created`);
  const detail = await repository.findLinkDetailById(link.link_id);
  assert(detail?.magic_link, `${taskType} magic link could not be reconstructed`);
  const url = new URL(detail.magic_link, FRONTEND_URL);
  const publicToken = url.pathname.split('/').filter(Boolean).at(-1);
  assert(publicToken, `${taskType} public token could not be reconstructed`);
  return {
    ...link,
    url: `${FRONTEND_URL}${url.pathname}`,
    publicToken,
    teacherEmail: assignee.email,
  };
}

async function verifyTaskWithDevelopmentGoogle(client, link, { proveDeniedEmail = false } = {}) {
  assert(link.teacherEmail, 'assigned teacher needs an email for development Google smoke');
  await client.call('Page.navigate', { url: link.url });
  await waitFor(
    async () =>
      await client.evaluate(
        `document.body.innerText.includes('ยืนยันตัวตนเพื่อเข้าใช้งาน')`,
      ),
    'task identity gate did not render',
  );
  assert(
    !(await client.evaluate(`Boolean(document.querySelector('[data-development-google-form]'))`)),
    'development email form should stay hidden until Google is selected',
  );
  await client.clickText('Google');
  await waitFor(
    async () =>
      await client.evaluate(`Boolean(document.querySelector('[data-development-google-form]'))`),
    async () =>
      `development Google email form did not render: ${await client.evaluate(
        `location.href + ' — ' + document.body.innerText.slice(0, 500)`,
      )}`,
  );
  assert(
    await client.evaluate(
      `document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
    ),
    'development Google form has mobile horizontal overflow',
  );
  if (proveDeniedEmail) {
    await setInput(client, '#development-google-email', 'not-a-teacher@invalid.example');
    await client.clickText('เข้าใช้งานด้วยอีเมลนี้');
    await waitFor(
      async () =>
        await client.evaluate(
          `document.body.innerText.includes('ยืนยันตัวตนไม่สำเร็จ')
            && Boolean(document.querySelector('[data-development-google-form]'))`,
        ),
      'outside-school development email was not rejected in the identity form',
    );
  }
  await setInput(client, '#development-google-email', link.teacherEmail);
  await client.clickText('เข้าใช้งานด้วยอีเมลนี้');
}

async function cleanupActorFixtures(dataSource, actorId) {
  if (!actorId) return;
  await dataSource.transaction(async (manager) => {
    const caseFilter = `SELECT id FROM cases WHERE created_by = $1`;
    const taskFilter = `SELECT id FROM tasks WHERE case_id IN (${caseFilter})`;
    const linkFilter = `SELECT id FROM task_links WHERE task_id IN (${taskFilter})`;
    const submissionFilter = `SELECT id FROM task_submissions WHERE task_link_id IN (${linkFilter})`;

    await manager.query(
      `DELETE FROM home_visit_disability_observations
       WHERE task_submission_id IN (${submissionFilter})`,
      [actorId],
    );
    await manager.query(
      `DELETE FROM home_visit_disadvantage_observations
       WHERE task_submission_id IN (${submissionFilter})`,
      [actorId],
    );
    await manager.query(
      `DELETE FROM task_submissions WHERE id IN (${submissionFilter})`,
      [actorId],
    );
    await manager.query(
      `DELETE FROM case_referrals WHERE case_id IN (${caseFilter})`,
      [actorId],
    );
    await manager.query(
      `DELETE FROM notifications WHERE case_id IN (${caseFilter})`,
      [actorId],
    );
    await manager.query(`DELETE FROM cases WHERE id IN (${caseFilter})`, [actorId]);
  });
}

async function main() {
  const backendUrl = new URL(BACKEND_URL);
  assert(
    ['127.0.0.1', 'localhost'].includes(backendUrl.hostname),
    'conversational smoke backend must use a local host',
  );
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  app.enableCors({ origin: new URL(FRONTEND_URL).origin, credentials: true });
  await app.listen(Number(backendUrl.port || 80), backendUrl.hostname);
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  const lifecycle = app.get(TaskLifecycleService);
  const repository = app.get(TaskRepository);
  let caseId = null;
  let actorId = null;
  let executiveId = null;
  let chrome = null;
  let observedStudentUuid = null;
  let observedDisadvantageCode = null;
  let observedDisadvantageWasPresent = true;

  try {
    const [enrollment] = await dataSource.query(
      `SELECT enrollment.student_uuid, enrollment."SchoolID_Onec" AS school_id,
              school.name AS school_name,
              CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec") AS student_name
       FROM student_term enrollment
       JOIN schools school ON school.id = enrollment."SchoolID_Onec"
       JOIN student_current_enrollment_resolution resolution
         ON resolution.selected_student_uuid = enrollment.student_uuid
        AND resolution.resolution_state = 'ACTIVE'
       JOIN classroom_homeroom_teachers assignment
         ON assignment.classroom_id = enrollment.classroom_id
       WHERE NOT EXISTS (
         SELECT 1 FROM cases current_case
         WHERE current_case.student_uuid = enrollment.student_uuid
           AND current_case.deleted_at IS NULL
           AND current_case.status IN ('OPEN','IN_PROGRESS','PENDING_REVIEW','STUDENT_NOT_FOUND')
       )
       ORDER BY enrollment.student_uuid LIMIT 1`,
    );
    assert(enrollment, 'need one canonical student with an assigned classroom teacher');
    const [absenceReason] = await dataSource.query(
      `SELECT reason.code, reason.label_th, category.code AS category_code,
              category.label_th AS category_label
       FROM absence_reasons reason
       JOIN absence_reason_categories category ON category.code = reason.category_code
       WHERE reason.is_active=TRUE AND category.is_active=TRUE
       ORDER BY category.sort_order, reason.sort_order LIMIT 1`,
    );
    assert(absenceReason, 'need one categorized absence reason for conversational smoke');
    const [disadvantage] = await dataSource.query(
      `SELECT code, label_th FROM disadvantage_types
       WHERE is_active=TRUE AND code <> 'NONE'
       ORDER BY sort_order LIMIT 1`,
    );
    assert(disadvantage, 'need one active disadvantage type for conversational smoke');
    const [assistanceMeasure] = await dataSource.query(
      `SELECT code, label_th FROM assistance_measure_options
       WHERE code='SCHOLARSHIP' AND is_active=TRUE LIMIT 1`,
    );
    assert(assistanceMeasure, 'need SCHOLARSHIP assistance measure for conversational smoke');
    observedStudentUuid = enrollment.student_uuid;
    observedDisadvantageCode = disadvantage.code;
    const [existingDisadvantage] = await dataSource.query(
      `SELECT EXISTS(
         SELECT 1 FROM student_term_disadvantages
         WHERE student_uuid=$1 AND disadvantage_type_code=$2
       ) AS present`,
      [observedStudentUuid, observedDisadvantageCode],
    );
    observedDisadvantageWasPresent = existingDisadvantage.present === true;
    const permissions = ['home', 'dashboard', 'students'];
    const [actor] = await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions,
         role, data_scope, must_change_password, data_origin_code)
       VALUES ($1, 'x', 'Conversational', 'Browser', 'ACTIVE', $2::jsonb, 'ADMIN', $3::jsonb,
         FALSE, 'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status='ACTIVE', permissions=$2::jsonb,
         data_scope=$3::jsonb, data_origin_code='AUTOMATED_TEST'
       RETURNING id`,
      [USERNAME, JSON.stringify(permissions), JSON.stringify({ school_ids: [Number(enrollment.school_id)] })],
    );
    actorId = Number(actor.id);
    await cleanupActorFixtures(dataSource, actorId);
    const [executive] = await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions,
         role, data_scope, must_change_password, data_origin_code)
       VALUES ($1, 'x', 'Executive', 'Browser', 'ACTIVE', '["dashboard"]'::jsonb, 'EXECUTIVE',
         $2::jsonb, FALSE, 'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status='ACTIVE', permissions='["dashboard"]'::jsonb,
         data_scope=$2::jsonb, role='EXECUTIVE', data_origin_code='AUTOMATED_TEST'
       RETURNING id`,
      [EXECUTIVE_USERNAME, JSON.stringify({ school_ids: [Number(enrollment.school_id)] })],
    );
    executiveId = Number(executive.id);
    const [createdCase] = await dataSource.query(
      `INSERT INTO cases (student_uuid, student_name, school_id, student_school, reason_flagged,
         status, workflow_phase_code, created_by)
       VALUES ($1,$2,$3,$4,$5,'OPEN','FOLLOW_UP',$6) RETURNING id`,
      [enrollment.student_uuid, enrollment.student_name, enrollment.school_id, enrollment.school_name, REASON, actorId],
    );
    caseId = Number(createdCase.id);
    const actorContext = {
      id: actorId,
      username: USERNAME,
      roles: ['ADMIN'],
      permissions,
      data_scope: { school_ids: [Number(enrollment.school_id)] },
    };

    // Seed one completed prior round with fields on the explicit prefill allowlist.
    const previous = await createLink(
      dataSource,
      lifecycle,
      repository,
      actorContext,
      enrollment,
      caseId,
      'VISIT',
    );
    const [previousSubmission] = await dataSource.query(
      `INSERT INTO task_submissions (
         task_link_id, visited_at, task_execution_outcome_code, home_visit_exception_code,
         parental_status_code, guardian_type_code, contact_person_name, contact_channel_code,
         residence_environment_detail, cause_detail
       ) VALUES ($1, now() - interval '1 day', 'NOT_SUCCEEDED', 'STUDENT_NOT_FOUND',
         (SELECT code FROM parental_status_options WHERE is_active=TRUE AND deleted_at IS NULL ORDER BY sort_order LIMIT 1),
         (SELECT code FROM guardian_type_options WHERE is_active=TRUE AND deleted_at IS NULL ORDER BY sort_order LIMIT 1),
         'ผู้ติดต่อจากรอบก่อน', 'PHONE', 'บริบทจากรอบก่อน', 'ข้อความเหตุการณ์เก่าห้าม prefill')
       RETURNING id`,
      [previous.link_id],
    );
    const [environment] = await dataSource.query(
      `SELECT code FROM residence_environment_options
       WHERE is_active=TRUE AND deleted_at IS NULL ORDER BY sort_order LIMIT 1`,
    );
    if (environment) {
      await dataSource.query(
        `INSERT INTO task_submission_residence_environments
         (task_submission_id, residence_environment_code) VALUES ($1,$2)`,
        [previousSubmission.id, environment.code],
      );
    }
    await dataSource.query(`UPDATE tasks SET status='COMPLETED' WHERE id=$1`, [previous.task_id]);
    await dataSource.query(`UPDATE task_links SET status='COMPLETED' WHERE id=$1`, [previous.link_id]);
    await dataSource.query(`UPDATE cases SET status='OPEN' WHERE id=$1`, [caseId]);

    const visit = await createLink(
      dataSource,
      lifecycle,
      repository,
      actorContext,
      enrollment,
      caseId,
      'VISIT',
    );
    chrome = await openChrome();
    const client = chrome;
    await client.call('Page.enable', {});
    await client.call('Network.enable', {});
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await verifyTaskWithDevelopmentGoogle(client, visit, { proveDeniedEmail: true });
    await waitFor(
      async () => (await visibleStepId(client)) === 'visited-at',
      async () =>
        `VISIT conversational form did not open on the first question: ${await client.evaluate(
          `location.pathname + ' — ' + document.body.innerText.slice(0, 240)`,
        )}`,
    );
    assert(
      await client.evaluate(`document.body.innerText.includes('ข้อ 1 จาก 10')`),
      'VISIT progress did not expose semantic step count',
    );
    assert(
      await client.evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`),
      'VISIT mobile layout has horizontal overflow',
    );
    assert(
      await client.evaluate(
        `[...document.querySelectorAll('[role="list"][aria-label^="ข้อ"] [role="listitem"] button')]
          .slice(1).every((item) => item.disabled)`,
      ),
      'future progress segments must be disabled',
    );
    await clickNext(client);
    await waitFor(async () => (await visibleStepId(client)) === 'visit-outcome', 'VISIT did not advance');
    assert(
      await client.evaluate(
        `document.querySelector('[data-conversational-step] input[name="visit-outcome"]:checked')?.parentElement?.innerText.includes('พบนักเรียน')
         && !document.querySelector('[data-conversational-step] input[name="visit-outcome"]:checked')?.parentElement?.innerText.includes('ไม่พบนักเรียน')`,
      ),
      'previous unsuccessful outcome leaked into the new round',
    );
    await clickNext(client);
    await waitFor(async () => (await visibleStepId(client)) === 'contact', 'VISIT contact step missing');
    assert(
      (await client.evaluate(`document.querySelector('#contact-person-selection')?.value`)) ===
        'บุคคลอื่น',
      'repeat contact did not map to the explicit other-person choice',
    );
    assert(
      (await client.evaluate(`document.querySelector('#contact-person-name')?.value`)) ===
        'ผู้ติดต่อจากรอบก่อน',
      'repeat contact prefill was not hydrated',
    );
    assert(
      !(await client.evaluate(
        `document.querySelector('[data-conversational-step]')?.innerText.includes('ข้อความเหตุการณ์เก่าห้าม prefill')`,
      )),
      'old event summary leaked into prefill UI',
    );
    await setInput(client, '#contact-person-name', 'แก้ไขแล้วในรอบใหม่');
    await clickNext(client);
    await client.clickText('ย้อนกลับ');
    assert(
      (await client.evaluate(`document.querySelector('#contact-person-name')?.value`)) ===
        'แก้ไขแล้วในรอบใหม่',
      'Back did not preserve the local answer',
    );
    await client.evaluate(
      `document.querySelectorAll('[role="list"][aria-label^="ข้อ"] [role="listitem"] button')[0].focus()`,
    );
    await client.evaluate(
      `document.activeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`,
    );
    await waitFor(
      async () => (await visibleStepId(client)) === 'visited-at',
      'keyboard activation did not return to a completed segment',
    );
    await client.evaluate(
      `document.querySelectorAll('[role="list"][aria-label^="ข้อ"] [role="listitem"] button')[2].click()`,
    );
    await waitFor(
      async () => (await visibleStepId(client)) === 'contact',
      'completed contact segment did not remain reachable',
    );
    await client.call('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    assert(
      await client.evaluate(
        `getComputedStyle(document.querySelector('[data-conversational-step]')).transitionProperty === 'none'`,
      ),
      'reduced-motion did not disable step transition',
    );
    await client.call('Emulation.setEmulatedMedia', { features: [] });

    // Finish VISIT with local-only navigation; only the final submit writes.
    await clickNext(client);
    await clickNext(client);
    await waitFor(
      async () => (await visibleStepId(client)) === 'absence-reason',
      'VISIT absence-reason step missing',
    );
    await client.evaluate(`document.querySelector('#absence-reason-category')?.click()`);
    await client.clickText(absenceReason.category_label);
    await client.evaluate(`document.querySelector('#absence-reason')?.click()`);
    await client.clickText(absenceReason.label_th);
    await clickNext(client);
    await waitFor(async () => (await visibleStepId(client)) === 'context', 'VISIT context step missing');
    await clickNext(client);
    await clickNext(client);
    await waitFor(async () => (await visibleStepId(client)) === 'care', 'VISIT care step missing');
    await client.evaluate(`document.querySelector('#observed-disadvantage-types')?.click()`);
    await client.clickText(disadvantage.label_th);
    await clickNext(client);
    await waitFor(async () => (await visibleStepId(client)) === 'evidence', 'VISIT evidence step missing');
    await clickNext(client);
    await waitFor(async () => (await visibleStepId(client)) === 'review', 'VISIT review step missing');
    const beforeVisit = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM task_submissions WHERE task_link_id=$1`,
      [visit.link_id],
    );
    assert(Number(beforeVisit[0].count) === 0, 'VISIT wrote before final submit');
    await client.clickText('ส่งรายงานการติดตาม');
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM task_submissions WHERE task_link_id=$1`,
        [visit.link_id],
      );
      return Number(row.count) === 1;
    }, 'VISIT final submit did not write exactly once');
    const [visitSubmission] = await dataSource.query(
      `SELECT task_execution_outcome_code, contact_person_name,
              absence_reason_category_code, absence_reason_code,
              cause_detail, photo_paths
       FROM task_submissions WHERE task_link_id=$1`,
      [visit.link_id],
    );
    assert(visitSubmission.task_execution_outcome_code === 'SUCCEEDED', 'VISIT derived outcome is wrong');
    assert(visitSubmission.contact_person_name === 'แก้ไขแล้วในรอบใหม่', 'VISIT snapshot is wrong');
    assert(
      visitSubmission.absence_reason_category_code === absenceReason.category_code,
      'VISIT absence category was not persisted independently',
    );
    assert(
      visitSubmission.absence_reason_code === absenceReason.code,
      'VISIT absence category/reason selection was not persisted',
    );
    assert(visitSubmission.cause_detail === null, 'old event detail was copied into new submission');
    assert(visitSubmission.photo_paths === null, 'old photos were copied into new submission');
    const [careObservation] = await dataSource.query(
      `SELECT EXISTS(
         SELECT 1 FROM home_visit_disadvantage_observations observation
         JOIN task_submissions submission ON submission.id=observation.task_submission_id
         WHERE submission.task_link_id=$1 AND observation.disadvantage_type_code=$2
       ) AS observed,
       EXISTS(
         SELECT 1 FROM student_term_disadvantages relation
         WHERE relation.student_uuid=$3 AND relation.disadvantage_type_code=$2
       ) AS canonical`,
      [visit.link_id, disadvantage.code, enrollment.student_uuid],
    );
    assert(careObservation.observed === true, 'VISIT care observation was not snapshotted');
    assert(careObservation.canonical === true, 'VISIT care observation was not applied to student data');

    await setBrowserSession(
      client,
      setSessionCookie(sessionCookieService, actorId),
      { id: actorId, username: USERNAME, roles: ['ADMIN'], permissions },
    );
    // The reviewer reads the case on a desktop, which is the only width where
    // the report's two columns share rows — and the only width a collapsed row
    // can hide answers behind each other.
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.call('Page.navigate', { url: `${FRONTEND_URL}/cases/${caseId}` });
    await waitFor(
      async () => await client.evaluate(
        `[...document.querySelectorAll('button')]
          .some((button) => button.textContent.trim().startsWith('มอบหมายช่วยเหลือ'))`,
      ),
      async () => `VISIT review action was not offered; buttons=${await client.evaluate(
        `[...document.querySelectorAll('button')].map((button) => button.textContent.trim()).join('|')`,
      )}`,
    );
    // A collapsed grid row draws two answers on top of each other and still
    // passes a text assertion, so the read-only report is checked by geometry.
    const overlappingFields = await client.evaluate(
      `(() => {
        const boxes = [...document.querySelectorAll('[data-follow-up-report] label')]
          .map((field) => ({
            label: field.textContent.trim().slice(0, 40),
            rect: field.getBoundingClientRect(),
          }))
          .filter((field) => field.rect.width > 0 && field.rect.height > 0);
        const overlaps = [];
        for (let left = 0; left < boxes.length; left += 1) {
          for (let right = left + 1; right < boxes.length; right += 1) {
            const a = boxes[left].rect;
            const b = boxes[right].rect;
            const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (horizontal > 1 && vertical > 1) {
              overlaps.push(boxes[left].label + ' ↔ ' + boxes[right].label);
            }
          }
        }
        return overlaps.join(' | ');
      })()`,
    );
    assert(
      overlappingFields === '',
      `case reviewer report fields overlap: ${overlappingFields}`,
    );
    // The environment note fills the rows beside it, so the two columns end on
    // the same line instead of leaving a ragged edge mid-report.
    const noteAlignment = await client.evaluate(
      `(() => {
        const find = (text) => [...document.querySelectorAll('[data-follow-up-report] label')]
          .find((field) => field.textContent.trim().startsWith(text));
        const note = find('รายละเอียดสภาพแวดล้อมรอบที่พัก');
        const neighbour = find('ระบุผู้ปกครอง');
        if (!note || !neighbour) return 'missing';
        return String(Math.round(
          note.getBoundingClientRect().bottom - neighbour.getBoundingClientRect().bottom,
        ));
      })()`,
    );
    assert(
      noteAlignment !== 'missing' && Math.abs(Number(noteAlignment)) <= 2,
      `environment note does not end level with the answer beside it: ${noteAlignment}`,
    );
    if (process.env.SMOKE_CASE_REPORT_SCREENSHOT) {
      const shot = await client.call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      });
      require('fs').writeFileSync(
        process.env.SMOKE_CASE_REPORT_SCREENSHOT,
        Buffer.from(shot.result.data, 'base64'),
      );
    }

    for (const expected of [
      'ผลการติดตาม',
      // A follow-up round reports whether the student was found, not whether it
      // "succeeded" — that wording belongs to assistance rounds.
      'พบนักเรียน',
      absenceReason.category_label,
      absenceReason.label_th,
      disadvantage.label_th,
    ]) {
      assert(
        await client.evaluate(
          `[
            document.body.innerText,
            ...[...document.querySelectorAll('input, textarea')].map((field) => field.value),
          ].join(' ').includes(${JSON.stringify(expected)})`,
        ),
        `case reviewer timeline is missing ${expected}`,
      );
    }
    await client.clickText('มอบหมายช่วยเหลือ');
    await waitFor(
      async () => await client.evaluate(
        `document.querySelector('[role="dialog"]')?.innerText.includes('มาตรการช่วยเหลือที่เสนอ')`,
      ),
      'ASSIST review proposal dialog did not render',
    );
    await setInput(client, '#case-note', 'เสนอทุนจากผลการติดตาม');
    await client.evaluate(`document.querySelector('#proposed-assistance-measures')?.click()`);
    await client.clickText(
      assistanceMeasure.label_th,
      `document.querySelector('[role="dialog"]')`,
    );
    await client.evaluate(
      `document.querySelector('#case-note')?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }))`,
    );
    await waitFor(
      async () => await client.evaluate(
        `[...document.querySelectorAll('[role="dialog"] button')]
          .some((button) => button.textContent.trim().startsWith('ให้ความช่วยเหลือ') && !button.disabled)`,
      ),
      async () => `ASSIST review submit did not become enabled: ${await client.evaluate(
        `JSON.stringify({
          note: document.querySelector('#case-note')?.value,
          measure: document.querySelector('#proposed-assistance-measures')?.parentElement?.innerText,
          buttons: [...document.querySelectorAll('[role="dialog"] button')]
            .map((button) => ({ text: button.textContent.trim(), disabled: button.disabled })),
          text: document.querySelector('[role="dialog"]')?.innerText,
        })`,
      )}`,
    );
    await client.clickText(
      'ให้ความช่วยเหลือ',
      `document.querySelector('[role="dialog"]')`,
    );
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT review.review_action, proposal.assistance_measure_code,
                cases.status, cases.workflow_phase_code
         FROM case_reviews review
         JOIN case_review_assistance_measures proposal ON proposal.case_review_id=review.id
         JOIN cases ON cases.id=review.case_id
         WHERE review.case_id=$1
         ORDER BY review.reviewed_at DESC LIMIT 1`,
        [caseId],
      );
      return row?.review_action === 'ASSIST' &&
        row?.assistance_measure_code === assistanceMeasure.code &&
        row?.status === 'OPEN' && row?.workflow_phase_code === 'ASSISTANCE';
    }, 'ASSIST review proposal was not persisted');
    await waitFor(
      async () => await client.evaluate(
        `document.querySelector('#assignment-assistance-measures')
          ?.parentElement?.innerText.includes(${JSON.stringify(assistanceMeasure.label_th)})`,
      ),
      'ASSIST assignment did not prefill the proposed measure',
    );
    const assist = await createLink(
      dataSource,
      lifecycle,
      repository,
      actorContext,
      enrollment,
      caseId,
      'ASSIST',
    );
    await verifyTaskWithDevelopmentGoogle(client, assist);
    await waitFor(async () => (await visibleStepId(client)) === 'assisted-at', 'ASSIST form missing');
    assert(
      await client.evaluate(`document.body.innerText.includes('ข้อ 1 จาก 6')`),
      'ASSIST progress did not expose six steps',
    );
    await clickNext(client);
    await clickNext(client);
    await waitFor(async () => (await visibleStepId(client)) === 'outcome', 'ASSIST outcome missing');
    await client.evaluate(
      `document.querySelector('input[name="assistance-outcome"][value="NOT_SUCCEEDED"]')?.click()`,
    );
    await clickNext(client);
    await waitFor(
      async () => (await visibleStepId(client)) === 'outcome-detail',
      'ASSIST failure detail missing',
    );
    await setInput(client, '#execution-outcome-detail', 'ผู้ปกครองยังไม่พร้อม');
    await clickNext(client);
    await clickNext(client);
    await waitFor(async () => (await visibleStepId(client)) === 'review', 'ASSIST review missing');
    await client.clickText('ส่งรายงานการช่วยเหลือ');
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT task_execution_outcome_code, execution_outcome_detail
         FROM task_submissions WHERE task_link_id=$1`,
        [assist.link_id],
      );
      return row?.task_execution_outcome_code === 'NOT_SUCCEEDED' &&
        row?.execution_outcome_detail === 'ผู้ปกครองยังไม่พร้อม';
    }, 'ASSIST did not persist outcome detail');

    // The same action must remain available after an assistance round.
    await setBrowserSession(
      client,
      setSessionCookie(sessionCookieService, actorId),
      { id: actorId, username: USERNAME, roles: ['ADMIN'], permissions },
    );
    await client.call('Page.navigate', { url: `${FRONTEND_URL}/cases/${caseId}` });
    await waitFor(
      async () => await client.evaluate(`document.body.innerText.includes('มอบหมายช่วยเหลืออีกครั้ง')`),
      'repeat ASSIST action was not offered after the assistance round',
    );

    // Seed one referral for aggregate and drill-down browser proof.
    const reviewId = randomUUID();
    await dataSource.query(
      `INSERT INTO case_reviews (id, case_id, review_action, review_note, reviewed_by, source_actor_user_id)
       VALUES ($1,$2,'REFER_AGENCY','smoke referral','Browser',$3)`,
      [reviewId, caseId, actorId],
    );
    const [agency] = await dataSource.query(
      `SELECT id FROM referral_agencies WHERE is_active=TRUE ORDER BY id LIMIT 1`,
    );
    assert(agency, 'no active referral agency for aggregate smoke');
    await dataSource.query(
      `INSERT INTO case_referrals (case_review_id, case_id, referral_agency_id, referred_by_user_id)
       VALUES ($1,$2,$3,$4)`,
      [reviewId, caseId, agency.id, actorId],
    );
    await client.call('Page.navigate', { url: `${FRONTEND_URL}/student-risk-report/risk` });
    await waitFor(
      async () => await client.evaluate(`document.body.innerText.includes('ผลการติดตามและการส่งต่อ')`),
      'follow-up aggregate panel did not render',
    );
    await client.clickText('ดูรายการส่งต่อ');
    await waitFor(
      async () => await client.evaluate(`document.body.innerText.includes(${JSON.stringify(enrollment.student_name)})`),
      'authorized referral drill-down did not render scoped student row',
    );

    // Executive sees aggregate but never receives or renders PII drill-down.
    await setBrowserSession(
      client,
      setSessionCookie(sessionCookieService, executiveId),
      { id: executiveId, username: EXECUTIVE_USERNAME, roles: ['EXECUTIVE'], permissions: ['dashboard'] },
    );
    await client.call('Page.navigate', { url: `${FRONTEND_URL}/student-risk-report/risk` });
    await waitFor(
      async () => await client.evaluate(`document.body.innerText.includes('แสดงเฉพาะข้อมูลรวม')`),
      'executive aggregate-only dashboard did not render',
    );
    assert(
      !(await client.evaluate(`document.body.innerText.includes('ดูรายการส่งต่อ')`)),
      'executive UI exposed referral drill-down control',
    );
    const drilldownStatus = await client.evaluate(
      `fetch(${JSON.stringify(`${BACKEND_URL}/api/dashboard/referrals`)}, { credentials: 'include' })
        .then((response) => response.status)`,
    );
    assert(drilldownStatus === 403, `executive referral drill-down returned ${drilldownStatus}`);

    console.log(
      'conversational reports browser smoke passed (development Google email allow/deny, VISIT/ASSIST one-question flow, contact choice, split absence type/reason, care provenance, reviewer completeness, ASSIST proposal/prefill, local draft navigation, mobile/keyboard/reduced-motion, single submit, repeat ASSIST, aggregate/drill-down scope)',
    );
  } finally {
    if (chrome) chrome.close();
    await cleanupActorFixtures(dataSource, actorId);
    if (
      observedStudentUuid &&
      observedDisadvantageCode &&
      !observedDisadvantageWasPresent
    ) {
      await dataSource.query(
        `DELETE FROM student_term_disadvantages
         WHERE student_uuid=$1 AND disadvantage_type_code=$2`,
        [observedStudentUuid, observedDisadvantageCode],
      );
    }
    if (actorId) {
      await dataSource.query(`UPDATE users SET status='DISABLED' WHERE id=$1`, [actorId]);
    }
    if (executiveId) {
      await dataSource.query(`UPDATE users SET status='DISABLED' WHERE id=$1`, [executiveId]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
