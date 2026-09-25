/**
 * Browser proof that every assignment round whose link still opens shows the
 * app's แชร์ button beside ยกเลิกการมอบหมาย, and that it shares that round's
 * own link (owner, 2026-09-25: "มอบหมายกี่รอบก็ต้องมี"). A cancelled round no
 * longer hands its link out.
 */
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { CaseService } = require('../dist/task/case.service');
const { TaskLifecycleService } = require('../dist/task/task-lifecycle.service');
const { TaskRepository } = require('../dist/task/task.repository');
const { assert, openChrome, wait, waitFor } = require('./smoke-case-assistance-browser');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run case share smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://localhost:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5175';
const USERNAME = 'case_share_browser_smoke';
const PERMISSIONS = ['home', 'dashboard', 'students'];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  const lifecycle = app.get(TaskLifecycleService);
  const caseService = app.get(CaseService);
  const taskRepository = app.get(TaskRepository);
  let chrome = null;
  let caseId = null;
  const taskIds = [];

  try {
    const [enrollment] = await dataSource.query(
      `SELECT enrollment.student_uuid,
              enrollment."SchoolID_Onec" AS school_id,
              school.name AS school_name,
              CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec") AS student_name
       FROM student_term enrollment
       INNER JOIN schools school ON school.id = enrollment."SchoolID_Onec"
       INNER JOIN student_current_enrollment_resolution resolution
          ON resolution.selected_student_uuid = enrollment.student_uuid
         AND resolution.resolution_state = 'ACTIVE'
       INNER JOIN classroom_homeroom_teachers assignment
          ON assignment.classroom_id = enrollment.classroom_id
       WHERE NOT EXISTS (
         SELECT 1 FROM cases existing
         WHERE existing.student_uuid = enrollment.student_uuid
           AND existing.deleted_at IS NULL
           AND existing.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
       )
       ORDER BY enrollment.student_uuid
       LIMIT 1`,
    );
    assert(enrollment, 'need one canonical student whose classroom has a teacher');
    const scope = { school_ids: [Number(enrollment.school_id)] };

    const [actor] = await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions,
         role, data_scope, must_change_password, data_origin_code)
       VALUES ($1, 'x', 'Share', 'Smoke', 'ACTIVE', $2::jsonb, 'ADMIN', $3::jsonb, FALSE,
         'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', permissions = $2::jsonb,
         data_scope = $3::jsonb, data_origin_code = 'AUTOMATED_TEST'
       RETURNING id`,
      [USERNAME, JSON.stringify(PERMISSIONS), JSON.stringify(scope)],
    );
    const actorId = Number(actor.id);
    const reviewer = {
      id: actorId,
      username: USERNAME,
      roles: ['ADMIN'],
      permissions: PERMISSIONS,
      data_scope: scope,
    };

    const [createdCase] = await dataSource.query(
      `INSERT INTO cases (student_uuid, student_name, school_id, student_school, reason_flagged,
         status, workflow_phase_code)
       VALUES ($1, $2, $3, $4, 'Automated case share smoke', 'OPEN', 'FOLLOW_UP')
       RETURNING id`,
      [
        enrollment.student_uuid,
        enrollment.student_name,
        enrollment.school_id,
        enrollment.school_name,
      ],
    );
    caseId = Number(createdCase.id);

    const assignees = await taskRepository.listVisitAssignees(enrollment.student_uuid);
    assert(assignees.length > 0, 'no teacher available to receive the round');
    const assign = async () => {
      const created = await lifecycle.createTask(
        reviewer,
        {
          task_type: 'VISIT',
          assigned_teacher_id: Number(assignees[0].teacher_id),
          existing_case_id: String(caseId),
          student_id: enrollment.student_uuid,
          expires_value: 1,
          expires_unit: 'days',
          target_school_id: enrollment.school_id,
        },
        FRONTEND_URL,
      );
      const taskId = created.task_id || created.taskId;
      assert(taskId, 'assignment did not return a task id');
      taskIds.push(taskId);
      return taskId;
    };

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
          roles: ['ADMIN'],
          permissions: PERMISSIONS,
          data_scope: scope,
        }),
      )}); localStorage.setItem('admin_access', 'true'); true`,
    );

    /** The link the case page's แชร์ dialog offers, or null when there is no button. */
    async function sharedLink() {
      await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/cases/${caseId}` });
      await waitFor(
        async () => await chrome.evaluate(`document.body.innerText.includes('มอบหมายการติดตาม')`),
        'case page did not render its assignment step',
      );
      await wait(800);
      const clicked = await chrome.evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button[aria-label="แชร์ลิงก์"]')]
          .filter((button) => button.offsetParent !== null);
        if (buttons.length === 0) return false;
        buttons[buttons.length - 1].click();
        return true;
      })()`);
      if (!clicked) return null;
      await waitFor(
        async () =>
          await chrome.evaluate(
            `[...document.querySelectorAll('input')].some((input) => input.value.includes('/task/'))`,
          ),
        'share dialog did not show the round link',
      );
      return await chrome.evaluate(
        `[...document.querySelectorAll('input')].map((input) => input.value).find((value) => value.includes('/task/'))`,
      );
    }

    // Round 1: shared, and it is that round's own link.
    await assign();
    const firstLink = await sharedLink();
    assert(firstLink, 'round 1 has no แชร์ button');
    assert(
      await chrome.evaluate(`['คัดลอกลิงก์', 'แชร์ผ่าน'].every((text) => {
        const label = [...document.querySelectorAll('div')].find((el) => el.innerText.trim() === text);
        return label && getComputedStyle(label).textAlign === 'left';
      })`),
      'share dialog headings are not left-aligned',
    );
    assert(
      (await chrome.evaluate(
        `[...document.querySelectorAll('button')].some((button) => button.innerText.trim() === 'ยกเลิกการมอบหมาย')`,
      )) === true,
      'ยกเลิกการมอบหมาย is gone from beside the แชร์ button',
    );
    console.log('ok round 1 shares its link beside ยกเลิกการมอบหมาย');

    // Cancel round 1 and assign round 2: round 2 shares a different link,
    // round 1 hands out nothing.
    await caseService.cancelCaseAssignment(
      caseId,
      { cancel_reason: 'ครูติดภารกิจ มอบหมายใหม่' },
      reviewer,
    );
    await assign();
    const secondLink = await sharedLink();
    assert(secondLink, 'round 2 has no แชร์ button');
    assert(secondLink !== firstLink, 'round 2 shares round 1 link');
    const buttonCount = await chrome.evaluate(
      `[...document.querySelectorAll('button[aria-label="แชร์ลิงก์"]')].filter((b) => b.offsetParent !== null).length`,
    );
    assert(buttonCount === 1, `expected one แชร์ button (round 2 only), found ${buttonCount}`);
    console.log('ok round 2 shares its own link; the cancelled round shares nothing');
    console.log('Case share browser smoke passed');
  } finally {
    chrome?.close();
    for (const taskId of taskIds) {
      await dataSource
        .query(`DELETE FROM task_links WHERE task_id = $1`, [taskId])
        .catch(() => undefined);
      await dataSource.query(`DELETE FROM tasks WHERE id = $1`, [taskId]).catch(() => undefined);
    }
    if (caseId) {
      await dataSource
        .query(`DELETE FROM notifications WHERE case_id = $1`, [caseId])
        .catch(() => undefined);
      await dataSource
        .query(`DELETE FROM tasks WHERE case_id = $1`, [caseId])
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
