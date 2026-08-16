/**
 * Browser smoke for the assistance phase on the case page: the follow-up review
 * offers ให้ความช่วยเหลือ, choosing it moves the case into the assistance phase,
 * step 3 appears with the measures picker, and the assistance review no longer
 * offers ให้ความช่วยเหลือ.
 *
 * Needs a backend and frontend already running (see SMOKE_BACKEND_URL /
 * SMOKE_FRONTEND_URL); both must be on the same host so the session cookie is
 * not treated as cross-site.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { TaskLifecycleService } = require('../dist/task/task-lifecycle.service');
const { TaskRepository } = require('../dist/task/task.repository');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run case assistance browser smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://localhost:3002';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://localhost:5175';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9257);
const USERNAME = 'case_assistance_browser_smoke';
const REASON = 'Automated case assistance browser smoke';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw new Error(lastError ? `${message}: ${lastError.message}` : message);
}

async function openChrome() {
  assert(fs.existsSync(CHROME_PATH), 'Google Chrome executable was not found');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-case-assist-chrome-'));
  const processRef = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    return response.ok;
  }, 'Chrome DevTools endpoint did not start');

  const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((res) => res.json());
  const target = targets.find((item) => item.type === 'page');
  assert(target?.webSocketDebuggerUrl, 'Chrome page target was not available');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  await new Promise((resolve) => socket.addEventListener('open', resolve));

  const call = (method, params) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.result?.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.exception?.description || 'evaluate failed');
    }
    return result.result?.result?.value;
  };
  /** `scope` is a JS expression for the root to search, e.g. a dialog element. */
  const clickText = async (text, scope = 'document') => {
    const box = await evaluate(
      [
        '(() => {',
        `  const root = ${scope} || document;`,
        '  if (!root) return null;',
        `  const buttons = [...root.querySelectorAll('button')];`,
        `  const wanted = ${JSON.stringify(text)};`,
        '  // A Button renders its loading text alongside its label, so an exact',
        '  // match misses the submit button once it has a loadingText.',
        '  const button = buttons.find((candidate) => candidate.textContent.trim() === wanted)',
        '    || buttons.find((candidate) => candidate.textContent.trim().startsWith(wanted));',
        '  if (!button) return null;',
        `  button.scrollIntoView({ block: 'center' });`,
        '  const rect = button.getBoundingClientRect();',
        '  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };',
        '})()',
      ].join('\n'),
    );
    assert(box, `button "${text}" was not on the page`);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    });
    await call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    });
  };

  return {
    call,
    evaluate,
    clickText,
    close: () => {
      socket.close();
      processRef.kill();
      // Chrome unlinks its profile asynchronously, so removing it here races.
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        /* the OS temp sweeper will get it */
      }
    },
  };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  const lifecycle = app.get(TaskLifecycleService);
  const taskRepository = app.get(TaskRepository);

  let caseId = null;
  let actorId = null;
  let client = null;

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
       INNER JOIN classroom_teacher_assignments assignment
          ON assignment.classroom_id = enrollment.classroom_id
         AND assignment.deleted_at IS NULL
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

    const permissions = ['home', 'dashboard', 'students', 'create', 'review-cases', 'close-case'];
    const [actor] = await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions,
         role, data_scope, must_change_password, data_origin_code)
       VALUES ($1, 'x', 'Assistance', 'Browser', 'ACTIVE', $2::jsonb, 'ADMIN', $3::jsonb, FALSE,
         'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', permissions = $2::jsonb,
         data_scope = $3::jsonb, data_origin_code = 'AUTOMATED_TEST'
       RETURNING id`,
      [
        USERNAME,
        JSON.stringify(permissions),
        JSON.stringify({ school_ids: [Number(enrollment.school_id)] }),
      ],
    );
    actorId = Number(actor.id);

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

    let cookie = null;
    sessionCookieService.setSession(
      {
        cookie: (name, value, options) => {
          cookie = { name, value, options };
        },
      },
      actorId,
    );
    assert(cookie, 'session cookie was not created');

    client = await openChrome();
    await client.call('Page.enable', {});
    await client.call('Network.enable', {});
    // The two-column layout the owner asked for is a `lg:` rule, so the desktop
    // width has to be pinned or the columns stack and the check is meaningless.
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.call('Page.navigate', { url: `${FRONTEND_URL}/login` });
    await wait(2000);
    await client.call('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    await client.evaluate(
      `localStorage.setItem('sts_user', ${JSON.stringify(
        JSON.stringify({ id: actorId, username: USERNAME, role: 'ADMIN', permissions }),
      )});
       localStorage.setItem('admin_access', 'true'); true`,
    );

    await client.call('Page.navigate', { url: `${FRONTEND_URL}/cases/${caseId}` });
    await waitFor(
      async () => await client.evaluate(`document.body.innerText.includes('รอพิจารณา')`),
      'case page did not render the pending-review case',
    );

    // The status badge appears while the tracking timeline is still loading, so
    // waiting on it alone leaves the step and button assertions below reading an
    // empty page — and "does not contain สาเหตุ" then passes vacuously.
    await waitFor(
      async () =>
        await client.evaluate(`document.querySelectorAll('[data-flow-step]').length >= 2`),
      'case page did not render the tracking timeline',
    );

    // Step 2 is labelled ติดตาม, not the old สาเหตุ.
    const stepTitles = await client.evaluate(
      `[...document.querySelectorAll('[data-flow-step]')]
        .map((node) => node.getAttribute('data-flow-step-title')).join('|')`,
    );
    assert(
      stepTitles.includes('ติดตาม') && !stepTitles.split('|').includes('สาเหตุ'),
      `step 2 is not labelled ติดตาม: ${stepTitles}`,
    );

    const followUpButtons = await client.evaluate(
      `[...document.querySelectorAll('button')].map((button) => button.textContent.trim()).join('|')`,
    );
    assert(
      followUpButtons.includes('ให้ความช่วยเหลือ'),
      `follow-up review is missing the ให้ความช่วยเหลือ button: ${followUpButtons}`,
    );
    assert(
      followUpButtons.includes('ปิดเคส') && followUpButtons.includes('ส่งต่อหน่วยงาน'),
      'follow-up review lost its existing actions',
    );

    await client.clickText('ให้ความช่วยเหลือ');
    await wait(800);
    // The review dialog asks for a note before it will submit.
    await waitFor(
      async () => await client.evaluate(`!!document.querySelector('[role="dialog"] textarea')`),
      'the review dialog did not open',
    );
    await client.evaluate(
      `(() => {
        const field = document.querySelector('[role="dialog"] textarea');
        if (!field) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(field, 'ควรให้ทุนการศึกษา');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );
    await wait(400);
    await client.clickText('ให้ความช่วยเหลือ', `document.querySelector('[role="dialog"]')`);

    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT status, workflow_phase_code FROM cases WHERE id = $1`,
        [caseId],
      );
      return row?.status === 'OPEN' && row?.workflow_phase_code === 'ASSISTANCE';
    }, 'clicking ให้ความช่วยเหลือ did not move the case into the assistance phase');

    await client.call('Page.navigate', { url: `${FRONTEND_URL}/cases/${caseId}` });
    await waitFor(
      async () =>
        await client.evaluate(`document.body.innerText.includes('มอบหมายการช่วยเหลือ')`),
      'step 3 (มอบหมายการช่วยเหลือ) did not appear after entering the assistance phase',
    );
    assert(
      await client.evaluate(`document.body.innerText.includes('รอมอบหมาย : ให้ความช่วยเหลือ')`),
      'the case header does not show the assistance phase',
    );
    assert(
      await client.evaluate(
        `!!document.querySelector('[aria-label="มาตรการการช่วยเหลือ"]')`,
      ),
      'the assistance assignment form has no measures picker',
    );

    // The assistance link must open the assistance report form, not the
    // "ภารกิจประเภทที่ไม่รองรับ" dead end.
    const assignees = await taskRepository.listVisitAssignees(enrollment.student_uuid);
    assert(assignees.length > 0, 'no teacher available to receive the assistance round');
    await lifecycle.createTask(
      {
        id: actorId,
        username: USERNAME,
        roles: ['ADMIN'],
        permissions,
        data_scope: { school_ids: [Number(enrollment.school_id)] },
      },
      {
        task_type: 'ASSIST',
        assigned_teacher_user_id: Number(assignees[0].teacher_user_id),
        assistance_measure_codes: ['SCHOLARSHIP'],
        existing_case_id: String(caseId),
        student_id: enrollment.student_uuid,
        expires_value: 1,
        expires_unit: 'days',
        target_school_id: enrollment.school_id,
      },
      BACKEND_URL,
    );
    const [assistLink] = await dataSource.query(
      `SELECT tl.id AS link_id
       FROM task_links tl
       JOIN tasks t ON t.id = tl.task_id
       WHERE t.case_id = $1 AND t.task_type = 'ASSIST' AND tl.deleted_at IS NULL
       ORDER BY tl.created_at DESC
       LIMIT 1`,
      [caseId],
    );
    assert(assistLink, 'assistance assignment did not create a link');
    // OTP itself is covered by the home visit smoke; skip the gate so this one
    // stays focused on the assistance form.
    await dataSource.query(`UPDATE task_links SET otp_verified = 1 WHERE id = $1`, [
      assistLink.link_id,
    ]);
    const linkDetail = await taskRepository.findLinkDetailById(assistLink.link_id);
    assert(linkDetail?.magic_link, 'assistance link could not be reconstructed');
    const guestUrl = `${FRONTEND_URL}${new URL(linkDetail.magic_link, FRONTEND_URL).pathname}`;

    // The AraID path must be offered on a task link, and its QR must be scoped
    // to `task-link` so it can never be redeemed through another flow.
    const guestToken = new URL(linkDetail.magic_link, FRONTEND_URL).pathname.split('/').pop();
    const araIdChallenge = await fetch(
      `${BACKEND_URL}/api/tasks/${encodeURIComponent(guestToken)}/araid/challenge`,
      { method: 'POST' },
    ).then((response) => response.json());
    assert(
      araIdChallenge?.data?.qrDataUrl?.startsWith('data:image/png;base64,'),
      `assistance link did not return an AraID QR: ${JSON.stringify(araIdChallenge).slice(0, 200)}`,
    );
    assert(
      /scope=task-link/.test(String(araIdChallenge.data.verificationUrl)),
      `AraID QR is not scoped to the task link: ${araIdChallenge.data.verificationUrl}`,
    );
    assert(
      /^[A-Z0-9]{6}$/.test(String(araIdChallenge.data.referenceCode)),
      'AraID challenge did not carry a reference code',
    );


    await client.call('Page.navigate', { url: guestUrl });
    await waitFor(async () => {
      const text = await client.evaluate('document.body.innerText');
      if (text.includes('ไม่รองรับ')) {
        throw new Error('assistance link was rejected as an unsupported task type');
      }
      return text.includes('แบบฟอร์มบันทึกการให้ความช่วยเหลือ');
    }, 'assistance link did not open the assistance report form');

    assert(
      await client.evaluate(
        `[...document.querySelectorAll('input')].some((input) =>
           input.disabled && input.value.includes('ให้ทุนการศึกษา'))`,
      ),
      'the assistance report form does not show the assigned measure read-only',
    );
    // The card header must reuse one of the five workflow statuses composed with
    // the phase, not invent a status of its own.
    const guestStatus = await client.evaluate(`document.body.innerText`);
    assert(
      guestStatus.includes('รอติดตาม : ให้ความช่วยเหลือ'),
      'the assistance form header does not show the composed workflow status',
    );
    assert(
      guestStatus.includes('มอบหมายการติดตาม') && guestStatus.includes('มอบหมายการช่วยเหลือ'),
      'the assistance form does not show the earlier case steps',
    );

    // Owner order: the description box must end level with the upload box, and
    // the measures must sit in the left column with the upload on the right.
    const layout = await client.evaluate(
      `(() => {
        // Compare the boxes a person actually sees, not the column wrappers:
        // a wrapper can stretch past its last visible child.
        const fields = document.querySelector('[data-assistance-report-fields]');
        const upload = document.querySelector('[data-assistance-report-upload]');
        if (!fields || !upload) return null;
        const description = document
          .querySelector('[data-assistance-report-description]')
          .querySelector('textarea');
        const card = upload.querySelector('.bg-white');
        if (!description || !card) return null;
        const a = description.getBoundingClientRect();
        const b = card.getBoundingClientRect();
        // The first control on the left and the card must start on the same
        // line too — bottom-only alignment still reads as crooked.
        // Measure the control box the user sees, not an inner input that a
        // picker may inset within its own wrapper.
        const firstItem = document
          .querySelector('[data-assistance-report-fields]')
          .firstElementChild;
        // Child 0 is the label, child 1 the control; a collapsed error message
        // may follow it with a zero-size rect.
        const firstControl = firstItem ? firstItem.children[1] : null;
        const firstBox = firstControl ? firstControl.getBoundingClientRect() : null;
        return {
          bottomGap: Math.round(a.bottom - b.bottom),
          topGap: firstBox ? Math.round(firstBox.top - b.top) : null,
          measuresOnLeft: a.left < b.left,
          uploadOnRight: b.left > a.left,
        };
      })()`,
    );
    assert(layout, 'the assistance step did not render its two columns');
    assert(
      layout.measuresOnLeft && layout.uploadOnRight,
      'มาตรการ must stay in the left column with แนบไฟล์ on the right',
    );
    assert(
      Math.abs(layout.bottomGap) <= 1,
      `คำอธิบายเพิ่มเติม ends ${layout.bottomGap}px off แนบไฟล์`,
    );
    assert(
      layout.topGap !== null && Math.abs(layout.topGap) <= 1,
      `แนบไฟล์ starts ${layout.topGap}px off the first field`,
    );
    // Owner order: the vertical rhythm in the left column must be even — the
    // date/time row, มาตรการ and คำอธิบายเพิ่มเติม sit the same distance apart.
    const gaps = await client.evaluate(
      `(() => {
        const box = (selector) => {
          const node = document.querySelector(selector);
          return node ? node.getBoundingClientRect() : null;
        };
        const dates = box('[data-assistance-report-fields]');
        const measures = box('[data-assistance-report-measures]');
        const description = box('[data-assistance-report-description]');
        if (!dates || !measures || !description) return null;
        return [
          Math.round(measures.top - dates.bottom),
          Math.round(description.top - measures.bottom),
        ];
      })()`,
    );
    assert(gaps && gaps.length === 2, 'the assistance fields column did not render its blocks');
    assert(
      Math.abs(gaps[0] - gaps[1]) <= 1,
      `uneven spacing between the assistance fields: ${gaps.join(', ')}px`,
    );
    // Box-to-box gaps alone cannot see a reserved-but-empty error line, which is
    // what made the rhythm look uneven; assert no invisible element takes height.
    const emptySpacers = await client.evaluate(
      `(() => {
        const column = document.querySelector('[data-assistance-report-description]').parentElement;
        if (!column) return null;
        return [...column.querySelectorAll('p, span, div')]
          .filter((node) => node.children.length === 0
            && !node.textContent.trim()
            && node.getBoundingClientRect().height > 0)
          .map((node) => node.tagName + '.' + String(node.getAttribute('class') || ''))
          .slice(0, 3);
      })()`,
    );
    assert(emptySpacers !== null, 'the assistance fields column was not found');
    assert(
      emptySpacers.length === 0,
      `empty elements still reserve height and break the rhythm: ${emptySpacers.join(' | ')}`,
    );

    // The upload dropzone should fill its white card rather than leaving a gap.
    const uploadFill = await client.evaluate(
      `(() => {
        const card = document.querySelector('[data-assistance-report-upload] .bg-white');
        const zone = document.querySelector('[data-visit-upload-dropzone]');
        if (!card || !zone) return null;
        return Math.round(card.getBoundingClientRect().bottom - zone.getBoundingClientRect().bottom);
      })()`,
    );
    assert(uploadFill !== null, 'the upload card did not render');
    assert(
      uploadFill <= 20,
      `the dropzone leaves ${uploadFill}px of empty card below it`,
    );

    // Owner order: in every assignment step the note must line up with the
    // fields beside it on both edges, not just one.
    const summaryAlignment = await client.evaluate(
      `(() => {
        const fields = [...document.querySelectorAll('[data-assignment-summary-fields]')];
        const notes = [...document.querySelectorAll('[data-assignment-summary-note]')];
        if (fields.length === 0 || fields.length !== notes.length) return null;
        return fields.map((field, index) => {
          const a = field.getBoundingClientRect();
          const b = notes[index].getBoundingClientRect();
          return { top: Math.round(a.top - b.top), bottom: Math.round(a.bottom - b.bottom) };
        });
      })()`,
    );
    assert(summaryAlignment, 'no assignment summary rendered on the assistance form');
    for (const [index, edges] of summaryAlignment.entries()) {
      assert(
        Math.abs(edges.top) <= 1 && Math.abs(edges.bottom) <= 1,
        `assignment summary ${index + 1} note is off by top ${edges.top}px / bottom ${edges.bottom}px`,
      );
    }

    // Autosave: what was typed must survive leaving and reopening the link.
    await client.evaluate(
      `(() => {
        const field = document.querySelector(
          'textarea[aria-label="คำอธิบายการให้ความช่วยเหลือ"]');
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(field, 'ร่างที่ยังกรอกไม่เสร็จ');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );
    // Autosave is debounced and writes to IndexedDB, so wait for the record to
    // actually exist rather than guessing a delay.
    await waitFor(
      async () =>
        await client.evaluate(
          `new Promise((resolve) => {
            const open = indexedDB.open('sts-visit-report-drafts', 1);
            open.onsuccess = () => {
              const tx = open.result.transaction('drafts', 'readonly');
              const all = tx.objectStore('drafts').getAll();
              all.onsuccess = () => resolve(all.result.some((row) =>
                row.formValues && row.formValues.assistanceDetail === 'ร่างที่ยังกรอกไม่เสร็จ'));
              all.onerror = () => resolve(false);
            };
            open.onerror = () => resolve(false);
          })`,
        ),
      'the assistance report draft was never written',
    ).catch(async (error) => {
      const dump = await client.evaluate(
        `new Promise((resolve) => {
          const open = indexedDB.open('sts-visit-report-drafts', 1);
          open.onsuccess = () => {
            const tx = open.result.transaction('drafts', 'readonly');
            const all = tx.objectStore('drafts').getAll();
            all.onsuccess = () => resolve(JSON.stringify(all.result.map((row) => ({
              token: row.token, keys: Object.keys(row.formValues || {}),
              detail: row.formValues && row.formValues.assistanceDetail,
            }))));
            all.onerror = () => resolve('getAll failed');
          };
          open.onerror = () => resolve('open failed');
        })`,
      );
      const typed = await client.evaluate(
        `document.querySelector('textarea[aria-label="คำอธิบายการให้ความช่วยเหลือ"]')?.value ?? 'NO FIELD'`,
      );
      throw new Error(`${error.message}; typed=${JSON.stringify(typed)}; drafts=${dump}`);
    });
    await client.call('Page.navigate', { url: `${FRONTEND_URL}/` });
    await wait(1200);
    await client.call('Page.navigate', { url: guestUrl });
    await waitFor(
      async () =>
        (await client.evaluate(
          `(document.querySelector('textarea[aria-label="คำอธิบายการให้ความช่วยเหลือ"]') || {}).value`,
        )) === 'ร่างที่ยังกรอกไม่เสร็จ',
      'the assistance report draft was not restored after reopening the link',
    );

    await client.evaluate(
      `(() => {
        // Earlier steps render read-only textareas, so target the editable one.
        const field = document.querySelector(
          'textarea[aria-label="คำอธิบายการให้ความช่วยเหลือ"]');
        if (!field) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(field, 'มอบทุนการศึกษาให้นักเรียนแล้ว');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );
    await wait(300);
    await client.clickText('บันทึกการให้ความช่วยเหลือ');
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT submission.assisted_at, submission.assistance_detail
         FROM task_submissions submission
         JOIN task_links tl ON tl.id = submission.task_link_id
         WHERE tl.id = $1`,
        [assistLink.link_id],
      );
      return Boolean(row?.assisted_at) && row.assistance_detail === 'มอบทุนการศึกษาให้นักเรียนแล้ว';
    }, 'the assistance report was not persisted');
    await waitFor(async () => {
      const [row] = await dataSource.query(`SELECT status FROM cases WHERE id = $1`, [caseId]);
      return row?.status === 'PENDING_REVIEW';
    }, 'submitting the assistance report did not send the case back to review');

    // Back at review, the assistance phase must not offer ให้ความช่วยเหลือ again.
    await client.call('Page.navigate', { url: `${FRONTEND_URL}/cases/${caseId}` });
    await waitFor(
      async () => await client.evaluate(`document.body.innerText.includes('การช่วยเหลือ')`),
      'assistance review step did not render',
    );
    const assistanceButtons = await client.evaluate(
      `[...document.querySelectorAll('button')].map((button) => button.textContent.trim()).join('|')`,
    );
    assert(
      !assistanceButtons.split('|').includes('ให้ความช่วยเหลือ'),
      `assistance review still offers ให้ความช่วยเหลือ: ${assistanceButtons}`,
    );
    assert(
      assistanceButtons.includes('ปิดเคส') && assistanceButtons.includes('ส่งต่อหน่วยงาน'),
      `assistance review lost ปิดเคส / ส่งต่อหน่วยงาน: ${assistanceButtons}`,
    );

    console.log(
      'case assistance browser smoke passed (ASSIST button → assistance phase → step 3 → guest report → limited review)',
    );
  } finally {
    if (client) client.close();
    if (caseId) {
      await dataSource
        .query(
          `DELETE FROM task_links WHERE task_id IN (SELECT id FROM tasks WHERE case_id = $1)`,
          [caseId],
        )
        .catch(() => undefined);
      await dataSource
        .query(
          `DELETE FROM task_assistance_measures WHERE task_id IN
             (SELECT id FROM tasks WHERE case_id = $1)`,
          [caseId],
        )
        .catch(() => undefined);
      await dataSource.query(`DELETE FROM tasks WHERE case_id = $1`, [caseId]).catch(() => undefined);
      await dataSource
        .query(`DELETE FROM notifications WHERE case_id = $1`, [caseId])
        .catch(() => undefined);
      await dataSource
        .query(`DELETE FROM case_reviews WHERE case_id = $1`, [caseId])
        .catch(() => undefined);
      await dataSource.query(`DELETE FROM cases WHERE id = $1`, [caseId]).catch(() => undefined);
    }
    if (actorId) {
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [actorId]).catch(() => undefined);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
