// Classroom-link student profile browser smoke.
//
// A teacher who opens a classroom link works the room, and the avatar on the
// roster is the way into a student's profile. This drives that path in a real
// browser: sign in through the link, click an avatar, and prove the profile the
// page renders is the student's own — served by the link's namespace, still
// masked, and bounded by the classroom the link belongs to.
//
// Run against the standard smoke stack:
//   backend  PORT=3001 DB_NAME=sts_task3_smoke GOOGLE_LOGIN_MODE=development \
//            CORS_ORIGINS=http://127.0.0.1:5174 pnpm start
//   frontend VITE_API_BASE_URL=http://127.0.0.1:3001 pnpm dev --host 127.0.0.1 --port 5174
//   pnpm smoke:classroom-student-profile-browser
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { ClassroomAttendanceLinksService } = require('../dist/classroom-attendance-links/classroom-attendance-links.service');
const { assert, openChrome, waitFor } = require('./smoke-case-assistance-browser');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run classroom student profile smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const USERNAME = 'classroom_student_profile_smoke';

function errorMessage(error) {
  if (error instanceof AggregateError) {
    return error.errors.map((cause) => cause?.message || String(cause)).join(' | ');
  }
  return error?.message || String(error);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const links = app.get(ClassroomAttendanceLinksService);

  let chrome;
  let actorId;
  let createdLinkId;

  try {
    // A classroom that can actually be worked: active room, active term, and a
    // homeroom teacher with an email to sign in as.
    const [scope] = await dataSource.query(
      `SELECT classroom.id::int AS classroom_id, classroom.school_id::int AS school_id,
              classroom.school_term_id::int AS school_term_id,
              lower(btrim(teacher.email)) AS teacher_email
       FROM school_classrooms classroom
       JOIN schools school ON school.id = classroom.school_id AND school.school_status = 'ACTIVE'
       JOIN school_terms term ON term.id = classroom.school_term_id AND term.status = 'ACTIVE'
       JOIN classroom_homeroom_teachers homeroom
         ON homeroom.classroom_id = classroom.id AND homeroom.school_id = classroom.school_id
       JOIN school_teacher_memberships membership
         ON membership.id = homeroom.teacher_membership_id
        AND membership.membership_status = 'ACTIVE'
        AND membership.deleted_at IS NULL
       JOIN teachers teacher
         ON teacher.id = membership.teacher_id
        AND teacher.teacher_status = 'ACTIVE'
        AND teacher.deleted_at IS NULL
       WHERE classroom.classroom_status = 'ACTIVE'
         AND classroom.deleted_at IS NULL
         AND teacher.email IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM student_term enrollment
           WHERE enrollment.classroom_id = classroom.id AND enrollment.deleted_at IS NULL
         )
       ORDER BY classroom.id
       LIMIT 1`,
    );
    assert(scope, 'need an active classroom with a homeroom teacher, an email and students');

    const [actor] = await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions,
         role, data_scope, must_change_password, data_origin_code)
       VALUES ($1, 'x', 'Classroom', 'Profile Smoke', 'ACTIVE',
         '["home","manage-classroom-links"]'::jsonb, 'ADMIN', $2::jsonb, FALSE, 'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status='ACTIVE',
         permissions='["home","manage-classroom-links"]'::jsonb, data_scope=$2::jsonb,
         data_origin_code='AUTOMATED_TEST', deactivated_at=NULL, deactivation_reason_code=NULL
       RETURNING id`,
      [USERNAME, JSON.stringify({ school_ids: [scope.school_id] })],
    );
    actorId = Number(actor.id);

    const created = await links.bulkCreate(
      {
        schoolId: scope.school_id,
        schoolTermId: scope.school_term_id,
        classroomIds: [scope.classroom_id],
      },
      {
        id: actorId,
        username: USERNAME,
        roles: ['ADMIN'],
        permissions: ['home', 'manage-classroom-links'],
        data_scope: { school_ids: [scope.school_id] },
      },
      FRONTEND_URL,
    );
    const accessUrl = created.data?.[0]?.accessUrl;
    assert(accessUrl, `bulk create did not return an access url: ${JSON.stringify(created).slice(0, 300)}`);
    createdLinkId = created.data[0].id;
    const token = accessUrl.split('#token=')[1];
    assert(token, `access url carried no token: ${accessUrl}`);

    // Sign in the way a teacher does, then hand the browser the session it got.
    const signIn = await fetch(`${BACKEND_URL}/api/classroom/auth/google/development`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-classroom-link-token': token },
      body: JSON.stringify({ email: scope.teacher_email }),
    });
    assert(signIn.status === 201, `link sign-in returned ${signIn.status}`);
    const sessionCookie = (signIn.headers.getSetCookie?.() || [])
      .map((value) => value.split(';')[0])
      .find((value) => value.startsWith('classroom_check_in_session='));
    assert(sessionCookie, 'link sign-in did not set a session cookie');
    const separator = sessionCookie.indexOf('=');

    chrome = await openChrome();
    await chrome.call('Page.enable');
    await chrome.call('Runtime.enable');
    await chrome.call('Network.enable');
    await chrome.call('Network.setCookie', {
      name: sessionCookie.slice(0, separator),
      value: sessionCookie.slice(separator + 1),
      url: `${BACKEND_URL}/api/classroom`,
      path: '/api/classroom',
      httpOnly: true,
      sameSite: 'Lax',
    });

    await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/classroom?tab=roster` });
    await waitFor(
      async () =>
        Boolean(
          await chrome.evaluate(
            `Boolean(document.querySelector('button[aria-label^="เปิดข้อมูลนักเรียน"]'))`,
          ),
        ),
      async () =>
        `signed-in classroom link did not render clickable roster avatars: ${String(
          await chrome.evaluate('document.body.innerText'),
        ).slice(0, 400)}`,
    );

    const studentName = String(
      await chrome.evaluate(
        `document.querySelector('button[aria-label^="เปิดข้อมูลนักเรียน"]')
           .getAttribute('aria-label').replace('เปิดข้อมูลนักเรียน ', '')`,
      ),
    );
    await chrome.evaluate(
      `document.querySelector('button[aria-label^="เปิดข้อมูลนักเรียน"]')?.click() ?? 'no-avatar-button'`,
    );

    const dialogText = async () =>
      String(await chrome.evaluate(`document.body.innerText`));
    await waitFor(
      async () =>
        String(await chrome.evaluate('window.location.pathname')).startsWith(
          '/classroom/students/',
        ) && (await dialogText()).includes(studentName),
      async () =>
        `the avatar did not open the student's profile page: ${String(
          await chrome.evaluate('window.location.pathname'),
        )} ${(await dialogText()).slice(0, 300)}`,
    );
    await waitFor(
      async () => {
        const text = await dialogText();
        return text.includes('ข้อมูลประกอบการดูแล') && text.includes('การมาเรียน');
      },
      async () =>
        `the profile opened from the link is missing its panels: ${(await dialogText()).slice(0, 400)}`,
    );
    // Masked by default — a link shows what the staff screen shows before a
    // reveal is requested, not the raw identity number.
    assert(
      !/\b\d{13}\b/.test(await dialogText()),
      'the profile opened from the link showed an unmasked national id',
    );


    // Asking to see it works the same way it does for staff: a reason, then the
    // value — and the access log names the teacher who asked.
    await chrome.evaluate(
      `document.querySelector('button[aria-label="แสดงเลขบัตร"]').click()`,
    );
    await waitFor(
      async () =>
        Boolean(
          await chrome.evaluate(
            `Boolean([...document.querySelectorAll('h2')].find((node) => node.textContent.trim() === 'แสดงข้อมูลส่วนบุคคล'))`,
          ),
        ),
      'the reveal request dialog did not open',
    );
    // The reason picker is the shared Combobox: a readonly input that opens a
    // list of plain buttons on focus. Its options come from the API, and it
    // stays disabled until they arrive.
    await waitFor(
      async () =>
        Boolean(
          await chrome.evaluate(
            `Boolean(document.querySelector('#pii-reveal-reason:not([disabled])'))`,
          ),
        ),
      'the reveal reason picker never became usable',
    );
    await chrome.evaluate(
      `(() => {
        const trigger = document.querySelector('#pii-reveal-reason');
        trigger.focus();
        trigger.click();
        return true;
      })()`,
    );
    await waitFor(
      async () =>
        Boolean(
          await chrome.evaluate(
            `Boolean(document.querySelector('#pii-reveal-reason')?.parentElement?.querySelector('ul li button'))`,
          ),
        ),
      async () =>
        `the reveal reason list did not open: ${String(
          await chrome.evaluate(
            `document.querySelector('#pii-reveal-reason')?.closest('section')?.innerHTML?.slice(0, 600) ?? 'no dialog'`,
          ),
        )}`,
    );
    const reasonLabel = String(
      await chrome.evaluate(
        `(() => {
          const button = document.querySelector('#pii-reveal-reason').parentElement.querySelector('ul li button');
          const label = button.textContent.trim();
          button.click();
          return label;
        })()`,
      ),
    );
    // Prove the pick landed before submitting: an empty reason fails validation
    // silently as far as the network is concerned.
    await waitFor(
      async () =>
        String(
          await chrome.evaluate(`document.querySelector('#pii-reveal-reason').value`),
        ).trim() === reasonLabel,
      async () =>
        `the reveal reason did not stick (wanted "${reasonLabel}", field shows "${await chrome.evaluate(
          `document.querySelector('#pii-reveal-reason').value`,
        )}")`,
    );
    // Submit by role, not by label: the base Button renders its idle and
    // loading labels side by side, so matching text picks the wrong control.
    await chrome.evaluate(
      `(() => {
        const submit = document.querySelector('#pii-reveal-reason')
          .closest('form')
          .querySelector('button[type="submit"]');
        if (!submit) throw new Error('reveal submit button not found');
        submit.click();
        return true;
      })()`,
    );
    const revealedDigits = async () =>
      await chrome.evaluate(
        `(() => {
          const dialog = document.querySelector('main') ?? document.body;
          if (!dialog) return 0;
          // The revealed value renders in the identity line; it may be grouped
          // with dashes, so compare digit counts rather than a raw 13-run.
          return [...dialog.querySelectorAll('span')]
            .map((node) => (node.textContent || '').replace(/\\D/g, ''))
            .reduce((longest, digits) => Math.max(longest, digits.length), 0);
        })()`,
      );
    await waitFor(
      async () => (await revealedDigits()) >= 13,
      async () =>
        `the national id was not revealed through the link (longest digit run ${await revealedDigits()}); reveal dialog: ${String(
          await chrome.evaluate(
            `[...document.querySelectorAll('section[role="dialog"]')]
               .map((node) => node.innerText)
               .find((text) => text.includes('แสดงข้อมูลส่วนบุคคล')) ?? 'reveal dialog closed'`,
          ),
        ).slice(0, 400)}`,
    );

    const [event] = await dataSource.query(
      `SELECT actor_user_id, actor_teacher_membership_id, purpose_link_id, field_group
       FROM pii_access_events
       WHERE created_at > now() - interval '2 minutes'
       ORDER BY id DESC LIMIT 1`,
    );
    assert(
      event &&
        event.actor_user_id === null &&
        event.actor_teacher_membership_id !== null &&
        event.field_group === 'NATIONAL_ID' &&
        event.purpose_link_id,
      `the reveal was not logged against the link teacher: ${JSON.stringify(event)}`,
    );

    const clickBack = async () => {
      await waitFor(
        async () =>
          Boolean(
            await chrome.evaluate(
              `Boolean([...document.querySelectorAll('a,button')].find((node) => (node.innerText || '').trim() === 'ย้อนกลับ'))`,
            ),
          ),
        async () => 'the profile page never rendered a back button',
      );
      await chrome.evaluate(
        `[...document.querySelectorAll('a,button')].find((node) => (node.innerText || '').trim() === 'ย้อนกลับ').click()`,
      );
    };

    // Back lands on the tab the teacher left, because that is the URL the
    // navigation recorded.
    await clickBack();
    await waitFor(
      async () =>
        String(await chrome.evaluate('window.location.pathname')) === '/classroom' &&
        String(await chrome.evaluate('window.location.search')) === '?tab=roster',
      async () =>
        `back from the profile did not return to the roster tab: ${String(
          await chrome.evaluate('window.location.pathname + window.location.search'),
        )}`,
    );

    // Opening a case needs a student who has none open: one that already has an
    // active case is offered "ดูเคส" instead, and earlier runs leave cases
    // behind in this database.
    const [caseCandidate] = await dataSource.query(
      `SELECT enrollment.student_uuid::text AS id
       FROM student_term enrollment
       LEFT JOIN cases active_case
         ON active_case.student_uuid = enrollment.student_uuid
        AND active_case.deleted_at IS NULL
        AND active_case.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
       WHERE enrollment.classroom_id = $1
         AND enrollment.deleted_at IS NULL
         AND active_case.id IS NULL
       ORDER BY enrollment.student_uuid
       LIMIT 1`,
      [scope.classroom_id],
    );
    assert(
      caseCandidate,
      'need a student in the link classroom without an active case to open one',
    );
    await chrome.call('Page.navigate', {
      url: `${FRONTEND_URL}/classroom/students/${caseCandidate.id}`,
    });
    await waitFor(
      async () =>
        String(await chrome.evaluate('window.location.pathname')) ===
        `/classroom/students/${caseCandidate.id}`,
      async () => 'the student profile page did not open on its own url',
    );
    // Opening a case is offered on the link's profile exactly as it is on the
    // staff one, and it keeps the teacher on the page it was opened from.
    await waitFor(
      async () =>
        Boolean(
          await chrome.evaluate(
            `Boolean([...document.querySelectorAll('button')].find((node) => (node.innerText || '').trim() === 'เปิดเคส'))`,
          ),
        ),
      async () =>
        `the link profile never offered เปิดเคส; buttons: ${String(
          await chrome.evaluate(
            `[...document.querySelectorAll('button')].map((node) => (node.innerText || '').trim()).filter(Boolean).join(' | ')`,
          ),
        ).slice(0, 300)}`,
    );
    // The toolbar pairs a lone action with the back button: same width, the way
    // the staff profile does it. (With a second action next to it the group is
    // what the back button matches, and the action keeps its own size.)
    const toolbarWidths = await chrome.evaluate(
      `(() => {
        const pick = (label) =>
          [...document.querySelectorAll('a,button')].find(
            (node) => (node.innerText || '').trim() === label,
          );
        const back = pick('ย้อนกลับ');
        const openCase = pick('เปิดเคส');
        if (!back || !openCase) return 'missing';
        return JSON.stringify({
          back: Math.round(back.getBoundingClientRect().width),
          openCase: Math.round(openCase.getBoundingClientRect().width),
        });
      })()`,
    );
    assert(
      toolbarWidths !== 'missing',
      'the link profile toolbar did not render both ย้อนกลับ and เปิดเคส',
    );
    const widths = JSON.parse(String(toolbarWidths));
    assert(
      Math.abs(widths.back - widths.openCase) <= 1,
      `a lone action and the back button are different sizes: ${toolbarWidths}`,
    );

    await chrome.evaluate(
      `[...document.querySelectorAll('button')].find((node) => (node.innerText || '').trim() === 'เปิดเคส').click()`,
    );
    await waitFor(
      async () =>
        String(await chrome.evaluate('document.body.innerText')).includes(
          'เปิดเคสติดตามนักเรียน',
        ),
      async () => 'the open-case dialog did not appear on the link profile',
    );
    await chrome.evaluate(
      `(() => {
        const field = document.querySelector('section[role="dialog"] textarea');
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value',
        ).set;
        setter.call(field, 'ขาดเรียนติดต่อกันหลายวัน (smoke)');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );
    await chrome.evaluate(
      `[...document.querySelectorAll('section[role="dialog"] button')].find((node) => (node.innerText || '').trim() === 'เปิดเคส').click()`,
    );
    await waitFor(
      async () => {
        const [row] = await dataSource.query(
          `SELECT created_by, created_by_teacher_id::text AS created_by_teacher_id
           FROM cases
           WHERE reason_flagged = $1
           ORDER BY id DESC LIMIT 1`,
          ['ขาดเรียนติดต่อกันหลายวัน (smoke)'],
        );
        return Boolean(row) && row.created_by === null && row.created_by_teacher_id;
      },
      async () => 'opening a case from the link did not record the link teacher',
    );
    // The case detail page belongs to the app, so the link stays where it was.
    assert(
      String(await chrome.evaluate('window.location.pathname')).startsWith(
        '/classroom/students/',
      ),
      'opening a case from the link navigated away from the link surface',
    );

    await clickBack();
    await waitFor(
      async () =>
        String(await chrome.evaluate('window.location.pathname')) === '/classroom',
      async () => 'back from the case profile did not return to the link page',
    );

    // Marking attendance, opening a profile and coming back must not lose what
    // was already marked — the draft belongs to the tab, not to the component.
    await chrome.evaluate(
      `[...document.querySelectorAll('[role="tab"]')].find((node) => (node.innerText || '').trim() === 'เช็กชื่อ')?.click() ?? 'no-attendance-tab'`,
    );
    await waitFor(
      async () =>
        Number(
          await chrome.evaluate(
            `document.querySelectorAll('button[aria-pressed]').length`,
          ),
        ) > 0,
      async () => 'the เช็กชื่อ tab did not render its status buttons',
    );
    await chrome.evaluate(
      `document.querySelector('button[aria-pressed]')?.click() ?? 'no-status-button'`,
    );
    await waitFor(
      async () =>
        Number(
          await chrome.evaluate(
            `document.querySelectorAll('button[aria-pressed="true"]').length`,
          ),
        ) > 0,
      async () => 'marking a student did not take effect',
    );
    await chrome.evaluate(
      `document.querySelector('button[aria-label^="เปิดข้อมูลนักเรียน"]')?.click() ?? 'no-avatar-button'`,
    );
    await waitFor(
      async () =>
        String(await chrome.evaluate('window.location.pathname')).startsWith(
          '/classroom/students/',
        ),
      async () => 'the avatar on the เช็กชื่อ tab did not open the profile page',
    );
    await clickBack();
    await waitFor(
      async () =>
        String(await chrome.evaluate('window.location.pathname')) === '/classroom' &&
        Number(
          await chrome.evaluate(
            `document.querySelectorAll('button[aria-pressed="true"]').length`,
          ),
        ) > 0,
      async () =>
        `returning from the profile lost the attendance already marked: ${String(
          await chrome.evaluate('window.location.pathname + window.location.search'),
        )}`,
    );

    console.log(
      'classroom student profile browser smoke passed (link sign-in, roster tab, avatar opens the profile page, panels render, identity stays masked until asked for, reveal logged against the link teacher, back returns to the tab it came from with marked attendance intact)',
    );
  } finally {
    if (chrome) chrome.close();
    if (createdLinkId) {
      await dataSource.query(
        `UPDATE classroom_attendance_links SET link_status='INACTIVE' WHERE id=$1`,
        [createdLinkId],
      );
    }
    if (actorId) {
      await dataSource.query(
        `UPDATE users SET status='DISABLED', deactivated_at=now(),
           deactivation_reason_code='OTHER', deactivation_note='Browser smoke fixture'
         WHERE id=$1 AND username=$2`,
        [actorId, USERNAME],
      );
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
